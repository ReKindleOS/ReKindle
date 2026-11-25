/*
 * KindleChat reply-prefix helper.
 *
 * The composer used to be mutated before length/URL/promo validation, so a
 * rejected send left "@user " in the box and kept replyTarget armed. This
 * helper only builds the string; the caller validates it first and writes the
 * prefix into the composer only after every check passes.
 */
(function () {
    'use strict';

    function buildReplyText(text, replyTarget, censorUsername) {
        var body = typeof text === 'string' ? text : '';
        var target = replyTarget && replyTarget.username ? replyTarget : null;
        if (!target) return { text: body, prefix: '' };

        var name = target.username;
        if (typeof censorUsername === 'function') {
            try { name = censorUsername(name); } catch (e) { /* keep raw username */ }
        }
        var prefix = '@' + String(name) + ' ';
        if (body.indexOf(prefix) === 0) return { text: body, prefix: '' };
        return { text: prefix + body, prefix: prefix };
    }

    window.rekindleBuildReplyText = buildReplyText;
})();
