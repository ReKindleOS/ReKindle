/*
 * Link detection for social apps (URL ban).
 * ---------------------------------------------------------------------------
 * KindleChat, Neighbourhood and Topics reject posts that contain a link. A
 * plain "word.tld" regex is not enough: the KindleHub owner advertises new
 * competing sites with the dots replaced, because a domain written with
 * commas or spaces is not clickable but is still perfectly readable. Seen in
 * the wild (2026-10-26):
 *
 *     "nexora-chat-v12,netlify,app/ NEW WEBSITE v12"
 *     "nexora-chat-v12 netlify app"
 *     "nexora-chat-v12[.]netlify[.]app"
 *     "nexora-chat-v12 dot netlify dot app"
 *
 * The text is normalised first (full-width characters, unicode dots,
 * zero-width characters, "[.]", "(dot)", uppercase DOT), then runs of
 * hostname labels separated by dot-like separators are walked. A run is a
 * link when its last label is a TLD and the run looks like a hostname rather
 * than a sentence: comma/space-split runs need a host signal (a label with a
 * digit or hyphen, "www", a known hosting suffix such as netlify.app, or a
 * trailing slash), so ordinary chat ("hello, me and you", "I love this
 * online", "this is a great app") is not rejected. Plain dotted domains,
 * protocols (including hxxp) and IPs keep the original checks.
 *
 * The moderation worker mirrors this (containsUrl in
 * workers/rekindle-moderate/worker.js) - KEEP THEM IN SYNC.
 * scripts/test-link-guard.js runs one corpus through both implementations.
 */
(function () {
    'use strict';

    // Identical to the original domain regex so the dotted-domain behaviour
    // does not change; the chain checks reuse the same TLD set.
    var TLD_SRC = 'com|net|org|io|co|ai|app|dev|edu|gov|mil|int|biz|info|name|pro|museum|aero|coop|jobs|mobi|travel|arpa|asia|cat|tel|xxx|post|geo|mail|onion|bit|crypto|eth|us|uk|au|ca|de|fr|jp|cn|kr|ru|br|mx|es|it|nl|se|no|fi|dk|pl|cz|at|ch|be|pt|ie|nz|za|in|sg|hk|tw|id|th|vn|ph|my|xyz|club|online|site|top|ink|cc|tv|ws|me|nu|gg|to|vc|link|ly|sh';

    var DOTTED_RE = new RegExp('\\b[a-z0-9-]+\\s*\\.\\s*(?:' + TLD_SRC + ')\\b');
    var TLD_RE = new RegExp('^(?:' + TLD_SRC + ')$');
    var IP_RE = /\b\d{1,3}\s*\.\s*\d{1,3}\s*\.\s*\d{1,3}\s*\.\s*\d{1,3}\b/;
    var PROTOCOL_RE = /\bh\s*[xt]\s*[xt]\s*p\s*s?\s*[:/]{1,4}/;

    // TLDs that are also ordinary English words. A comma/space-split run that
    // ends in one of these needs an extra host signal before it counts as a
    // link ("hello, me" / "yes, to me" are conversations, not domains).
    var WORD_TLDS = {
        me: 1, to: 1, it: 1, in: 1, at: 1, us: 1, my: 1, be: 1,
        no: 1, is: 1, id: 1, do: 1, so: 1, am: 1, an: 1, as: 1,
        on: 1, or: 1, link: 1, online: 1, site: 1, top: 1, club: 1,
        info: 1, name: 1, pro: 1, ink: 1, mail: 1, travel: 1, jobs: 1,
        post: 1, cat: 1, bit: 1, tv: 1
    };

    // Hosting platforms used for throwaway competing sites. A pair of labels
    // matching one of these is a host even when every separator is a space
    // ("netlify app", "discord gg").
    var HOST_SUFFIXES = {
        'netlify.app': 1, 'netlify.com': 1, 'vercel.app': 1, 'now.sh': 1,
        'github.io': 1, 'githubusercontent.com': 1, 'gitlab.io': 1,
        'pages.dev': 1, 'workers.dev': 1, 'web.app': 1, 'firebaseapp.com': 1,
        'blogspot.com': 1, 'wordpress.com': 1, 'wixsite.com': 1, 'weebly.com': 1,
        'squarespace.com': 1, 'godaddysites.com': 1, 'myshopify.com': 1,
        'carrd.co': 1, 'notion.site': 1, 'notionso.com': 1, 'linktr.ee': 1,
        'bit.ly': 1, 'tinyurl.com': 1, 't.me': 1, 'discord.gg': 1,
        'glitch.me': 1, 'replit.app': 1, 'replit.dev': 1, 'repl.co': 1,
        'herokuapp.com': 1, 'onrender.com': 1, 'render.com': 1, 'fly.dev': 1,
        'surge.sh': 1, 'neocities.org': 1, '000webhostapp.com': 1,
        'infinityfreeapp.com': 1, 'forms.gle': 1, 'sites.google.com': 1
    };

    // Placeholder for a spelled-out "dot". Never a dot itself, so the legacy
    // dotted-domain regex cannot see "red dot app" as "red.app".
    var GAP_MARK = '\u0001';

    function normalize(text) {
        var s = String(text || '');
        try { s = s.normalize('NFKC'); } catch (e) { /* ES2019 fallback below */ }
        // Unicode full stops / bullet separators used in place of a dot.
        s = s.replace(/[\u3002\uFF0E\uFF61\u2024\uFE52\u00B7\u2022\u22C5\u30FB\uFF65]/g, '.');
        // "[.]", "(dot)", "{DOT}", "<dot>".
        s = s.replace(/[\[\(\{<]\s*(?:\.|d[o0]t)\s*[\]\)\}>]/gi, '.');
        // Glued uppercase DOT ("netlifyDOTapp", "NETLIFYDOTAPP").
        s = s.replace(/([A-Za-z0-9])\s*DOT\s*(?=[A-Za-z0-9])/g, '$1' + GAP_MARK);
        // Spaced "dot" ("netlify dot app"), but not "dotnet"/"using dotnet".
        s = s.replace(/\s+dot\s+/gi, GAP_MARK);
        // Zero-width / soft-hyphen characters used to split words.
        s = s.replace(/[\u200B-\u200D\u2060\uFEFF\u00AD\u180E]/g, '');
        return s.toLowerCase();
    }

    // How two consecutive labels are separated.
    //   break   - a path/query starts here, so the hostname ends before it
    //   dot     - a real dot (possibly padded with spaces)
    //   dotword - a spelled-out "dot"
    //   space   - whitespace only
    //   obf     - commas, brackets, colons, pipes, ... (URL obfuscation)
    function gapKind(gap) {
        if (!gap) return 'glued';
        if (/[\/\\?&#=]/.test(gap)) return 'break';
        if (gap.indexOf(GAP_MARK) !== -1) {
            return /^[\s\u0001.]*$/.test(gap) ? 'dotword' : 'obf';
        }
        if (/^[\s.]*$/.test(gap)) return gap.indexOf('.') !== -1 ? 'dot' : 'space';
        return 'obf';
    }

    // Splits the normalised text into runs of labels joined by dot-like
    // separators. A slash/query closes the run (and is remembered, because a
    // trailing slash is a strong "this is a link" signal).
    function collectRuns(t) {
        var atomRe = /[a-z0-9]+(?:-[a-z0-9]+)*/g;
        var atoms = [];
        var m;
        while ((m = atomRe.exec(t)) !== null) {
            atoms.push({ text: m[0], start: m.index, end: m.index + m[0].length });
        }

        var runs = [];
        var run = { labels: [], gaps: [], end: 0, slash: false };
        for (var i = 0; i < atoms.length; i++) {
            if (!run.labels.length) {
                run.labels.push(atoms[i].text);
                run.end = atoms[i].end;
                continue;
            }
            var gap = t.slice(run.end, atoms[i].start);
            var kind = gapKind(gap);
            if (kind === 'break') {
                run.slash = /[\/\\]/.test(gap);
                runs.push(run);
                run = { labels: [atoms[i].text], gaps: [], end: atoms[i].end, slash: false };
                continue;
            }
            run.labels.push(atoms[i].text);
            run.gaps.push(kind);
            run.end = atoms[i].end;
        }
        if (run.labels.length) {
            if (t.charAt(run.end) === '/') run.slash = true;
            runs.push(run);
        }
        return runs;
    }

    // Extra evidence that a run is a hostname rather than prose.
    function hostSignal(labels, tailSlash) {
        for (var i = 0; i < labels.length - 1; i++) {
            if (/[0-9]/.test(labels[i]) || labels[i].indexOf('-') !== -1) return true;
        }
        if (labels[0] === 'www') return true;
        if (tailSlash) return true;
        for (var j = 0; j < labels.length - 1; j++) {
            if (HOST_SUFFIXES[labels[j] + '.' + labels[j + 1]]) return true;
        }
        return false;
    }

    function windowIsLink(labels, kinds, tailSlash) {
        var n = labels.length;
        var last = labels[n - 1];
        if (!TLD_RE.test(last)) return false;

        var allSpace = true;
        var allDot = true;
        for (var i = 0; i < kinds.length; i++) {
            if (kinds[i] !== 'space') allSpace = false;
            if (kinds[i] !== 'dot') allDot = false;
        }
        // Real dots are covered by the legacy dotted-domain check, which also
        // keeps its historical sentence-boundary behaviour.
        if (allDot) return false;

        var signal = hostSignal(labels, tailSlash);

        if (allSpace) {
            if (signal) return true;
            // "example com" (but not "the app" / "great net").
            return n === 2 && /^(?:com|net|org)$/.test(last) &&
                labels[0].length >= 5 && !WORD_TLDS[last];
        }

        // Comma / bracket / "dot" split.
        if (n === 2) {
            if (signal) return true;
            if (WORD_TLDS[last]) return false;
            var left = labels[0];
            return /[0-9]/.test(left) || left.indexOf('-') !== -1 || left.length >= 5;
        }
        if (WORD_TLDS[last] && !signal) return false;
        return true;
    }

    function runIsLink(run) {
        var n = run.labels.length;
        // Only windows of 2-4 labels: a link in a sentence is short, and this
        // keeps "a. b. c. d" style prose from matching.
        for (var len = 2; len <= 4; len++) {
            for (var start = 0; start + len <= n; start++) {
                var end = start + len - 1;
                if (windowIsLink(
                    run.labels.slice(start, end + 1),
                    run.gaps.slice(start, end),
                    run.slash && end === n - 1
                )) {
                    return true;
                }
            }
        }
        return false;
    }

    function containsLink(text) {
        if (!text) return false;
        var t = normalize(text);
        if (PROTOCOL_RE.test(t)) return true;
        if (/\bwww\s*\./.test(t)) return true;
        if (DOTTED_RE.test(t)) return true;
        if (IP_RE.test(t)) return true;

        var runs = collectRuns(t);
        for (var i = 0; i < runs.length; i++) {
            if (runIsLink(runs[i])) return true;
        }
        return false;
    }

    window.rekindleContainsLink = containsLink;
})();
