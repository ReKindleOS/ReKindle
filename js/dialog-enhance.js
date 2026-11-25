/*
 * Give existing page dialogs the shared System 7 title bar without rewriting
 * 136 modal boxes by hand.
 *
 * Loaded after the page script and before </body>. The heading element is
 * MOVED (not cloned), so ids, data-i18n and any JS that updates the heading
 * keep working. Remaining children are wrapped in .rk-dialog-body, which is
 * why every page-level selector should target descendants (.modal-box p),
 * not direct children (.modal-box > p).
 *
 * Deliberate skips:
 *   - boxes already using rk-dialog
 *   - .window-style modals (calendar builds its own title bar)
 *   - computed display:flex boxes (mastodon/doom/weather/bluesky), where
 *     wrapping children would change the layout
 *   - boxes with no heading; there is no title text to move
 */
(function () {
    'use strict';

    function isHeading(el) {
        if (!el || el.nodeType !== 1) return false;
        var tag = el.tagName ? el.tagName.toUpperCase() : '';
        var cls = el.className ? String(el.className) : '';
        return tag === 'H2' || tag === 'H3' ||
            (tag === 'DIV' && cls.indexOf('modal-title') !== -1 && cls.indexOf('modal-buttons') === -1);
    }

    function headingFor(box) {
        var first = box.firstElementChild;
        if (isHeading(first)) return first;
        var kids = box.children || [];
        for (var i = 0; i < kids.length; i++) {
            if (isHeading(kids[i])) return kids[i];
        }
        return null;
    }

    function enhance(box) {
        if (!box || box.nodeType !== 1) return;
        if (box.classList.contains('rk-dialog')) return;
        if (box.classList.contains('window-style')) return;
        // Some pages already build a System 7 title bar inside the box.
        if (box.querySelector('.title-bar')) return;

        var computed = null;
        try {
            computed = window.getComputedStyle ? window.getComputedStyle(box) : null;
        } catch (e) {
            computed = null;
        }
        if (computed && computed.display === 'flex') return;

        var closeBtn = box.querySelector('.modal-close, .close-box, .rk-dialog-close');
        var heading = headingFor(box);

        if (!heading) {
            // A page can label a heading-less dialog explicitly.
            var explicit = box.getAttribute('data-dialog-title');
            if (explicit) {
                heading = document.createElement('span');
                heading.className = 'rk-dialog-title';
                heading.textContent = explicit;
            } else {
                // Generic alert/confirm boxes have a message node but no heading.
                var hasMessage = box.querySelector('#modal-message, .modal-text, #modal-msg, #alert-message');
                if (!hasMessage) return;
                heading = document.createElement('span');
                heading.className = 'rk-dialog-title';
                heading.textContent = window.t ? window.t('common.message', 'Message') : 'Message';
            }
        }

        var bar = document.createElement('div');
        bar.className = 'rk-dialog-bar';
        var stripes = document.createElement('div');
        stripes.className = 'rk-dialog-stripes';
        bar.appendChild(stripes);

        if (closeBtn) {
            // Reuse the page's existing close handler, but let the shared
            // title-bar style place and size it.
            closeBtn.className = 'rk-dialog-close';
            closeBtn.removeAttribute('style');
            closeBtn.setAttribute('aria-label', 'Close');
            bar.appendChild(closeBtn);
        }

        if (heading.classList) heading.classList.add('rk-dialog-title');
        bar.appendChild(heading);
        box.insertBefore(bar, box.firstChild);

        var body = document.createElement('div');
        body.className = 'rk-dialog-body';
        var node = bar.nextSibling;
        while (node) {
            var next = node.nextSibling;
            body.appendChild(node);
            node = next;
        }
        box.appendChild(body);
        box.classList.add('rk-dialog');
    }

    function enhanceAll() {
        var boxes;
        try {
            boxes = document.querySelectorAll('.modal-box');
        } catch (e) {
            return;
        }
        for (var i = 0; i < boxes.length; i++) enhance(boxes[i]);
    }

    window.rekindleEnhanceDialogs = enhanceAll;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', enhanceAll);
    } else {
        enhanceAll();
    }
})();
