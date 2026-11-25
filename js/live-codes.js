/*
 * Private live-game codes (kid-safe social layer).
 *
 * No friends graph, no chat, no notifications: a host publishes an 8-character
 * code, shares it in person or in an existing moderated chat, and a guest joins
 * with it. Private lobbies are omitted from the public dashboard list.
 *
 * Cost: one small RTDB write when the host taps Invite, one read when a guest
 * joins. No Cloud Functions, no listeners.
 */
(function () {
    'use strict';

    var ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    var CODE_LENGTH = 8;
    var TTL_MS = 2 * 60 * 60 * 1000;
    var GAME_PAGES = {
        uno: 'liveuno',
        chess: 'livechess',
        checkers: 'livecheckers',
        connect4: 'liveconnect4',
        dotsandboxes: 'livedotsandboxes',
        tictactoe: 'livetictactoe',
        yahtzee: 'liveyahtzee',
        pictionary: 'livepictionary'
    };
    var GAME_NAMES = {
        uno: 'UNO',
        chess: 'Chess',
        checkers: 'Checkers',
        connect4: 'Connect 4',
        dotsandboxes: 'Dots & Boxes',
        tictactoe: 'Tic-Tac-Toe',
        yahtzee: 'Yahtzee',
        pictionary: 'Pictionary'
    };

    function normalise(code) {
        return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    }

    function isValidCode(code) {
        var clean = normalise(code);
        if (clean.length !== CODE_LENGTH) return false;
        for (var i = 0; i < clean.length; i++) {
            if (ALPHABET.indexOf(clean.charAt(i)) === -1) return false;
        }
        return true;
    }

    function group(code) {
        var clean = normalise(code);
        return clean.slice(0, 4) + '-' + clean.slice(4);
    }

    function makeCode() {
        var out = '';
        var bytes = new Uint8Array(CODE_LENGTH);
        if (window.crypto && window.crypto.getRandomValues) {
            window.crypto.getRandomValues(bytes);
        } else {
            for (var b = 0; b < CODE_LENGTH; b++) bytes[b] = Math.floor(Math.random() * 256);
        }
        for (var i = 0; i < CODE_LENGTH; i++) {
            out += ALPHABET.charAt(bytes[i] % ALPHABET.length);
        }
        return out;
    }

    function ensureStyles() {
        if (document.getElementById('rk-live-code-styles')) return;
        var style = document.createElement('style');
        style.id = 'rk-live-code-styles';
        style.textContent = [
            '#rk-live-code-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.45);',
            'z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;}',
            '#rk-live-code-overlay .rk-lc-box{background:#fff;border:2px solid #000;box-shadow:6px 6px 0 #000;',
            'width:100%;max-width:360px;box-sizing:border-box;padding:0;text-align:center;}',
            '#rk-live-code-overlay .rk-lc-title{background:#fff;border-bottom:2px solid #000;font-weight:bold;',
            'padding:9px 10px;font-size:1rem;}',
            '#rk-live-code-overlay .rk-lc-body{padding:16px 14px;}',
            '#rk-live-code-overlay p{margin:0 0 12px;font-size:.9rem;line-height:1.4;}',
            '#rk-live-code-overlay .rk-lc-code{font-family:"Courier New",monospace;font-size:1.6rem;',
            'font-weight:bold;letter-spacing:2px;border:2px dashed #000;padding:10px;margin:0 0 12px;word-break:break-all;}',
            '#rk-live-code-overlay button{display:block;width:100%;min-height:48px;margin:0 0 8px;border:2px solid #000;',
            'background:#fff;color:#000;box-shadow:2px 2px 0 #000;font-family:inherit;font-size:.92rem;font-weight:bold;cursor:pointer;}',
            '#rk-live-code-overlay button:active{background:#000;color:#fff;box-shadow:none;transform:translate(2px,2px);}',
            '.rk-invite-bar{width:100%;max-width:400px;margin:8px auto;text-align:center;}',
            '.rk-invite-bar button{min-height:48px;width:100%;border:2px solid #000;background:#fff;box-shadow:2px 2px 0 #000;',
            'font-family:inherit;font-size:.92rem;font-weight:bold;cursor:pointer;}',
            '.rk-invite-bar button:active{background:#000;color:#fff;box-shadow:none;transform:translate(2px,2px);}'
        ].join('');
        (document.head || document.documentElement).appendChild(style);
    }

    function showCodeModal(code, onClose) {
        ensureStyles();
        var old = document.getElementById('rk-live-code-overlay');
        if (old && old.parentNode) old.parentNode.removeChild(old);

        var overlay = document.createElement('div');
        overlay.id = 'rk-live-code-overlay';
        overlay.innerHTML = '<div class="rk-lc-box" role="dialog" aria-modal="true">' +
            '<div class="rk-lc-title">Invite a friend</div>' +
            '<div class="rk-lc-body">' +
            '<p>Share this code with someone you know. They can enter it under Live Games on the home screen.</p>' +
            '<div class="rk-lc-code" id="rk-live-code-value"></div>' +
            '<p style="font-size:.8rem;">Only share this with people you know. The code expires in 2 hours and the lobby is hidden from the public list.</p>' +
            '<button type="button" id="rk-live-code-copy">Copy code</button>' +
            '<button type="button" id="rk-live-code-close">Close</button>' +
            '<p id="rk-live-code-status" style="font-size:.8rem;min-height:1.2em;margin-bottom:0;"></p>' +
            '</div></div>';
        document.body.appendChild(overlay);
        document.getElementById('rk-live-code-value').textContent = group(code);
        document.getElementById('rk-live-code-copy').onclick = function () {
            var text = group(code);
            var done = false;
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text);
                    done = true;
                }
            } catch (e) { done = false; }
            if (!done) {
                try {
                    var area = document.createElement('textarea');
                    area.value = text;
                    document.body.appendChild(area);
                    area.select();
                    done = document.execCommand('copy');
                    document.body.removeChild(area);
                } catch (e2) { done = false; }
            }
            document.getElementById('rk-live-code-status').textContent = done
                ? 'Copied.' : 'Select the code and copy it manually.';
        };
        document.getElementById('rk-live-code-close').onclick = function () {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            if (typeof onClose === 'function') onClose();
        };
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                if (typeof onClose === 'function') onClose();
            }
        });
    }

    function publish(rtdb, opts) {
        return new Promise(function (resolve, reject) {
            if (!rtdb || !opts || !opts.game || !opts.matchId || !opts.hostUid) {
                reject(new Error('Missing game details.'));
                return;
            }
            if (!GAME_PAGES[opts.game]) {
                reject(new Error('Unknown game.'));
                return;
            }

            var attempts = 0;
            function tryCode() {
                attempts++;
                if (attempts > 6) { reject(new Error('Could not create a code.')); return; }
                var code = makeCode();
                var ref = rtdb.ref('game_codes/' + code);
                ref.transaction(function (current) {
                    if (current) return; // occupied, retry with another code
                    return {
                        game: opts.game,
                        matchId: String(opts.matchId),
                        hostUid: opts.hostUid,
                        createdAt: Date.now(),
                        expiresAt: Date.now() + TTL_MS
                    };
                }).then(function (result) {
                    if (!result || !result.committed) { tryCode(); return; }
                    // Hide the lobby from the public dashboard list. Best-effort:
                    // the code still works if this write races the host leaving.
                    rtdb.ref('matchmaking/' + opts.game + '/' + opts.matchId)
                        .update({ private: true, code: code })
                        .catch(function () { });
                    resolve(code);
                }).catch(function () { tryCode(); });
            }
            tryCode();
        });
    }

    function join(rtdb, code) {
        return new Promise(function (resolve, reject) {
            if (!rtdb) { reject(new Error('Not signed in.')); return; }
            var clean = normalise(code);
            if (!isValidCode(clean)) { reject(new Error('That code is not valid.')); return; }

            rtdb.ref('game_codes/' + clean).once('value').then(function (snap) {
                var value = snap.val();
                if (!value || !value.game || !value.matchId) {
                    reject(new Error('That code has expired. Ask your friend for a new one.'));
                    return;
                }
                if (Number(value.expiresAt) && Number(value.expiresAt) < Date.now()) {
                    reject(new Error('That code has expired. Ask your friend for a new one.'));
                    return;
                }
                if (!GAME_PAGES[value.game]) {
                    reject(new Error('That code is not for a game.'));
                    return;
                }
                rtdb.ref('games/' + value.game + '/' + value.matchId + '/status').once('value').then(function (stateSnap) {
                    var status = stateSnap.val();
                    if (status !== 'lobby') {
                        reject(new Error('That game has already started or finished.'));
                        return;
                    }
                    resolve({
                        game: value.game,
                        matchId: value.matchId,
                        code: clean,
                        url: GAME_PAGES[value.game] + '.html?matchId=' + encodeURIComponent(value.matchId)
                    });
                }).catch(function () {
                    reject(new Error('Could not check that game. Try again.'));
                });
            }).catch(function () {
                reject(new Error('Could not check that code. Try again.'));
            });
        });
    }

    function attach(opts) {
        ensureStyles();
        var bar = document.createElement('div');
        bar.className = 'rk-invite-bar';
        bar.style.display = 'none';
        var button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Invite a friend';
        bar.appendChild(button);

        var mount = document.getElementById('screen-lobby') ||
            document.querySelector('.window-content') || document.querySelector('.window') || document.body;
        mount.appendChild(bar);

        var code = null;
        var busy = false;
        button.onclick = function () {
            if (busy) return;
            if (code) { showCodeModal(code); return; }
            busy = true;
            button.disabled = true;
            button.textContent = 'Creating code...';
            publish(opts.rtdb, {
                game: opts.game,
                matchId: opts.matchId,
                hostUid: opts.hostUid
            }).then(function (created) {
                code = created;
                busy = false;
                button.disabled = false;
                button.textContent = 'Invite a friend';
                showCodeModal(code);
            }).catch(function (e) {
                busy = false;
                button.disabled = false;
                button.textContent = 'Invite a friend';
                button.title = e && e.message ? e.message : 'Could not create a code.';
            });
        };

        return {
            show: function () { bar.style.display = 'block'; },
            hide: function () { bar.style.display = 'none'; },
            destroy: function () { if (bar.parentNode) bar.parentNode.removeChild(bar); }
        };
    }

    window.RekindleLiveCodes = {
        normalise: normalise,
        isValidCode: isValidCode,
        group: group,
        makeCode: makeCode,
        publish: publish,
        join: join,
        attach: attach,
        GAME_PAGES: GAME_PAGES,
        GAME_NAMES: GAME_NAMES
    };
})();
