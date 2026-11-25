/*
 * Shared leaderboard dialog chrome.
 *
 * Every game has its own #leaderboard-modal markup. This normaliser gives all
 * of them the same System 7 title bar: X on the left, the word "Leaderboard"
 * only, and any former heading/subtitle text moved below the bar.
 *
 * Include this after the modal markup (before </body>) on game pages.
 */
(function () {
    'use strict';

    var TITLE = (window.t && window.t('leaderboard.title', 'Leaderboard')) || 'Leaderboard';

    function installStyles() {
        if (document.getElementById('rk-leaderboard-dialog-style')) return;
        var style = document.createElement('style');
        style.id = 'rk-leaderboard-dialog-style';
        style.textContent =
            '.rk-lb-box{position:relative!important;padding:0!important;background:#fff!important;' +
            'border:2px solid #000!important;box-shadow:6px 6px 0 #000!important;overflow:hidden!important;' +
            'max-width:92vw!important;box-sizing:border-box!important;}' +
            '.rk-lb-bar{position:relative;min-height:34px;border-bottom:2px solid #000;display:flex;' +
            'align-items:center;justify-content:center;background:#fff;box-sizing:border-box;padding:3px 0;}' +
            '.rk-lb-stripes{position:absolute;top:4px;bottom:4px;left:4px;right:4px;z-index:0;' +
            'background-image:repeating-linear-gradient(0deg,transparent,transparent 2px,#000 3px,#000 4px);}' +
            '.rk-lb-title{position:relative;z-index:1;background:#fff;padding:3px 10px;font-weight:bold;' +
            'font-size:1rem;line-height:1.2;text-align:center;max-width:88%;overflow-wrap:break-word;}' +
            '.rk-lb-close{position:absolute;left:7px;top:7px;width:18px;height:18px;z-index:3;' +
            'border:2px solid #000;background:#fff;color:#000;box-shadow:2px 2px 0 #000;cursor:pointer;' +
            'padding:0;font-family:inherit;font-size:0.7rem;font-weight:bold;line-height:1;' +
            'display:flex;align-items:center;justify-content:center;box-sizing:border-box;}' +
            '.rk-lb-close:active{background:#000;color:#fff;box-shadow:none;transform:translate(1px,1px);}' +
            '.rk-lb-body{padding:10px 12px 12px;max-height:70vh;overflow-y:auto;text-align:left;box-sizing:border-box;}' +
            '.rk-lb-sub{font-size:0.75rem;color:#555;font-style:italic;border-bottom:1px solid #ccc;' +
            'padding-bottom:6px;margin-bottom:8px;text-align:center;}' +
            '.rk-lb-box .rk-dialog-body{padding:10px 12px 12px!important;text-align:left!important;}';
        document.head.appendChild(style);
    }

    function textOf(node) {
        return node ? String(node.textContent || '').replace(/\s+/g, ' ').trim() : '';
    }

    function makeCloseButton(action) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'rk-lb-close';
        btn.setAttribute('aria-label', 'Close');
        btn.textContent = 'X';
        btn.onclick = function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof action === 'function') action.call(btn, e);
            else {
                var modal = btn.closest('#leaderboard-modal') || btn.closest('.modal-overlay');
                if (modal) modal.style.display = 'none';
            }
        };
        return btn;
    }

    function enhance(modal) {
        if (!modal || modal.dataset.rkLeaderboardReady) return;
        var box = modal.querySelector('.modal-box') || modal;
        if (!box) return;

        var heading = box.querySelector('h1,h2,h3,h4,.modal-title,.rk-dialog-title');
        var headingText = textOf(heading);
        if (!headingText) headingText = 'Leaderboard';

        var extra = '';
        if (/leaderboard/i.test(headingText)) {
            extra = headingText.replace(/leaderboard/i, '').replace(/^[\s:()\-–—]+|[\s:()\-–—]+$/g, '');
        } else if (!/^leaderboard$/i.test(headingText)) {
            extra = headingText;
        }

        // Capture the existing close action before removing its button.
        var closeAction = null;
        var candidates = box.querySelectorAll('button,a');
        for (var i = 0; i < candidates.length; i++) {
            var el = candidates[i];
            var label = textOf(el).toLowerCase();
            var onclick = el.getAttribute('onclick') || '';
            if (label === 'close' || label === 'x' || label === '×' ||
                /leaderboard-modal/.test(onclick) || /closeLeaderboard/.test(onclick)) {
                if (typeof el.onclick === 'function') closeAction = el.onclick;
                if (el.parentNode) el.parentNode.removeChild(el);
            }
        }

        var bar = box.querySelector('.rk-dialog-bar');
        var body = box.querySelector('.rk-dialog-body');

        if (!bar) {
            box.classList.add('rk-lb-box');

            // Remove the old heading; its text becomes the subtitle.
            if (heading && heading.parentNode) heading.parentNode.removeChild(heading);

            bar = document.createElement('div');
            bar.className = 'rk-lb-bar';
            var stripes = document.createElement('div');
            stripes.className = 'rk-lb-stripes';
            bar.appendChild(stripes);
            var title = document.createElement('span');
            title.className = 'rk-lb-title';
            title.textContent = TITLE;
            bar.appendChild(title);

            body = document.createElement('div');
            body.className = 'rk-lb-body';
            while (box.firstChild) body.appendChild(box.firstChild);
            box.appendChild(bar);
            box.appendChild(body);
        } else {
            var barTitle = bar.querySelector('.rk-dialog-title,.rk-lb-title');
            if (barTitle) {
                barTitle.textContent = TITLE;
                barTitle.removeAttribute('data-i18n');
            }
            if (!body) {
                body = document.createElement('div');
                body.className = 'rk-dialog-body';
                while (box.lastChild && box.lastChild !== bar) body.appendChild(box.lastChild);
                box.appendChild(body);
            }
        }

        if (extra) {
            var sub = document.createElement('div');
            sub.className = 'rk-lb-sub';
            sub.textContent = extra;
            body.insertBefore(sub, body.firstChild);
        }

        var close = makeCloseButton(closeAction);
        bar.appendChild(close);
        modal.dataset.rkLeaderboardReady = '1';
    }

    function run() {
        installStyles();
        var modals = document.querySelectorAll('#leaderboard-modal, #scores-overlay');
        for (var i = 0; i < modals.length; i++) enhance(modals[i]);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run);
    } else {
        setTimeout(run, 0);
    }
})();
