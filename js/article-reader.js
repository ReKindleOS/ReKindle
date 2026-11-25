/*
 * ReKindle shared article reader.
 *
 * Used by rssreader.html, newspaper.html, substack.html and readwise.html so
 * the four apps share one reader design:
 *
 *   [X Home] [Back] [A- A+]        Title        [right actions]
 *   ------------------------------------------------------------
 *   iframe article (rss/newspaper, with page prev/next footer)
 *   or DOM article  (substack/readwise, Back returns to the feed/list)
 *
 * The module owns:
 *   - the reader chrome markup and Home/Back semantics (X is always index,
 *     Back is the page's onBack callback);
 *   - A-/A+ font sizing, persistence and application to both iframe documents
 *     and DOM content;
 *   - iframe column pagination (page counting, prev/next, tap halves, arrow
 *     keys) and article link interception.
 *
 * The page owns the app-specific fetching/rendering (Readability worker,
 * Substack body HTML, Readwise documents, read status, open-external).
 *
 * Kindle / Chromium 75: no optional chaining, no nullish coalescing, no
 * flexbox gap, no animations. Keep it ES2019-safe.
 */
(function (window, document) {
    'use strict';

    var STORAGE_KEY = 'rekindle_reader_font_size';
    // Older rssreader/newspaper builds used this key. Read it once so existing
    // users keep their setting, and keep writing it so a cached old page that
    // is still in a user's browser does not diverge during rollout.
    var LEGACY_STORAGE_KEY = 'rss_reader_font_size';
    var MIN_FONT = 10;
    var MAX_FONT = 32;
    var FONT_STEP = 2;
    var DEFAULT_FONT = 16;

    var currentFontSize = null;
    var readers = [];
    var activeReader = null;

    function clampFontSize(size) {
        if (size < MIN_FONT) return MIN_FONT;
        if (size > MAX_FONT) return MAX_FONT;
        return size;
    }

    function readFontSize() {
        var raw = null;
        var fromLegacy = false;
        try {
            raw = window.localStorage.getItem(STORAGE_KEY);
            if (raw === null || raw === '') {
                raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
                fromLegacy = raw !== null && raw !== '';
            }
        } catch (e) {
            raw = null;
        }
        var size = parseInt(raw, 10);
        if (isNaN(size) || size < MIN_FONT || size > MAX_FONT) size = DEFAULT_FONT;
        if (fromLegacy) {
            try {
                window.localStorage.setItem(STORAGE_KEY, String(size));
            } catch (e) { /* localStorage can be unavailable in private mode */ }
        }
        return size;
    }

    function getFontSize() {
        if (currentFontSize === null) currentFontSize = readFontSize();
        return currentFontSize;
    }

    function storeFontSize(size) {
        currentFontSize = clampFontSize(size);
        try {
            window.localStorage.setItem(STORAGE_KEY, String(currentFontSize));
            window.localStorage.setItem(LEGACY_STORAGE_KEY, String(currentFontSize));
        } catch (e) { /* ignore storage failures */ }
        return currentFontSize;
    }

    function setFontSize(size) {
        var parsed = parseInt(size, 10);
        if (isNaN(parsed)) parsed = getFontSize();
        var next = clampFontSize(parsed);
        storeFontSize(next);
        for (var i = 0; i < readers.length; i++) {
            readers[i].applyFontSize();
        }
        return next;
    }

    function translate(key, fallback) {
        if (typeof window.t === 'function') {
            try {
                return window.t(key, fallback);
            } catch (e) { /* fall through to English */ }
        }
        return fallback;
    }

    function makeElement(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

    function makeButton(className, text, title) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.textContent = text;
        if (title) {
            button.title = title;
            button.setAttribute('aria-label', title);
        }
        return button;
    }

    function create(config) {
        config = config || {};
        var mount = typeof config.mount === 'string'
            ? document.getElementById(config.mount)
            : config.mount;
        if (!mount) {
            console.error('RekindleReader: mount element not found');
            return null;
        }

        var mode = config.mode === 'dom' ? 'dom' : 'iframe';
        var showPagination = mode === 'iframe' && config.pagination !== false;
        var root = mount;

        root.innerHTML = '';
        if (root.classList) root.classList.add('rk-reader-modal');
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');
        root.setAttribute('aria-hidden', 'true');

        var windowEl = makeElement('div', 'rk-reader-window');
        var bar = makeElement('div', 'rk-reader-bar');
        var stripes = makeElement('div', 'rk-reader-stripes');
        stripes.setAttribute('aria-hidden', 'true');

        var left = makeElement('div', 'rk-reader-left');
        var homeButton = makeButton('rk-reader-home', 'X', 'Home');
        var backLabel = translate(config.backKey || 'rss.btn.back', config.backLabel || 'Back');
        var backButton = makeButton('rk-reader-btn rk-reader-back', backLabel, config.backTitle || 'Back to feed');

        var fonts = makeElement('div', 'rk-reader-fonts');
        var fontDown = makeButton('rk-reader-btn rk-reader-btn-small', 'A-', translate('help.font.smaller', 'Smaller text'));
        var fontUp = makeButton('rk-reader-btn rk-reader-btn-small', 'A+', translate('help.font.larger', 'Larger text'));
        fonts.appendChild(fontDown);
        fonts.appendChild(fontUp);

        left.appendChild(homeButton);
        left.appendChild(backButton);
        left.appendChild(fonts);

        var titleEl = makeElement('span', 'rk-reader-title');
        titleEl.id = config.titleId || 'reader-title';

        var actionsEl = makeElement('div', 'rk-reader-actions');
        var actionRefs = {};
        var actionDefs = [];

        var actionConfig = config.actions || [];
        actionConfig.forEach(function (action) {
            if (!action) return;
            if (!action.label && !action.labelKey) return;
            var label = action.labelKey
                ? translate(action.labelKey, action.label || action.labelKey)
                : action.label;
            var className = 'rk-reader-btn rk-reader-btn-small';
            if (action.className) className += ' ' + action.className;
            var button = makeButton(className, label, action.title);
            if (action.id) button.id = action.id;
            if (typeof action.onClick === 'function') {
                button.addEventListener('click', action.onClick);
            }
            actionsEl.appendChild(button);
            var def = {
                el: button,
                label: action.label || label,
                labelKey: action.labelKey || null,
                custom: false
            };
            if (action.id) actionRefs[action.id] = def;
            actionDefs.push(def);
        });

        bar.appendChild(stripes);
        bar.appendChild(left);
        bar.appendChild(titleEl);
        bar.appendChild(actionsEl);
        windowEl.appendChild(bar);

        var frame = null;
        var content = null;
        var footer = null;
        var indicator = null;
        var prevButton = null;
        var nextButton = null;

        if (mode === 'iframe') {
            frame = document.createElement('iframe');
            frame.className = 'rk-reader-frame';
            frame.id = config.frameId || 'article-frame';
            frame.setAttribute('sandbox', config.frameSandbox || 'allow-same-origin');
            frame.setAttribute('title', config.frameTitle || 'Article');
            windowEl.appendChild(frame);

            if (showPagination) {
                footer = makeElement('div', 'rk-reader-footer');
                prevButton = makeButton('rk-reader-btn', 'Previous');
                prevButton.id = 'btn-prev';
                prevButton.disabled = true;
                indicator = makeElement('span', 'rk-reader-page', 'Page 1 of 1');
                indicator.id = 'page-indicator';
                nextButton = makeButton('rk-reader-btn', 'Next');
                nextButton.id = 'btn-next';
                nextButton.disabled = true;
                footer.appendChild(prevButton);
                footer.appendChild(indicator);
                footer.appendChild(nextButton);
                windowEl.appendChild(footer);
            }
        } else {
            content = makeElement('div', 'rk-reader-content');
            content.id = config.contentId || 'reader-content';
            windowEl.appendChild(content);
        }

        root.appendChild(windowEl);

        var currentPage = 1;
        var totalPages = 1;
        var customTitle = false;

        function defaultTitle() {
            if (config.titleKey) {
                return translate(config.titleKey, config.title || config.titleKey);
            }
            return config.title || 'Reader';
        }

        function backText() {
            return translate(config.backKey || 'rss.btn.back', config.backLabel || 'Back');
        }

        function updateFontButtons() {
            var size = getFontSize();
            fontDown.disabled = size <= MIN_FONT;
            fontUp.disabled = size >= MAX_FONT;
        }

        function getScroller() {
            if (!frame) return null;
            var doc = null;
            try {
                doc = frame.contentDocument;
            } catch (e) {
                return null;
            }
            if (!doc) return null;
            return doc.scrollingElement || doc.body || null;
        }

        function updatePaginationUI() {
            if (!showPagination || !frame) return;
            var scroller = getScroller();
            if (!scroller) return;
            var clientWidth = scroller.clientWidth;
            if (!clientWidth) return;

            var pages = Math.ceil(scroller.scrollWidth / clientWidth);
            if (pages < 1) pages = 1;
            totalPages = pages;
            currentPage = Math.round(scroller.scrollLeft / clientWidth) + 1;
            if (currentPage < 1) currentPage = 1;
            if (currentPage > totalPages) currentPage = totalPages;

            if (indicator) indicator.textContent = 'Page ' + currentPage + ' of ' + totalPages;
            if (prevButton) prevButton.disabled = currentPage <= 1;
            if (nextButton) nextButton.disabled = currentPage >= totalPages;
        }

        function applyFontSize() {
            var size = getFontSize();
            if (mode === 'iframe' && frame) {
                var doc = null;
                try {
                    doc = frame.contentDocument;
                } catch (e) {
                    doc = null;
                }
                if (doc) {
                    if (doc.documentElement) doc.documentElement.style.fontSize = size + 'px';
                    if (doc.body) doc.body.style.fontSize = size + 'px';
                }
                if (showPagination) schedulePagination();
            } else if (content) {
                content.style.fontSize = size + 'px';
            }
            updateFontButtons();
        }

        function schedulePagination() {
            if (!showPagination) return;
            if (typeof window.requestAnimationFrame === 'function') {
                window.requestAnimationFrame(function () {
                    window.requestAnimationFrame(updatePaginationUI);
                });
            } else {
                window.setTimeout(updatePaginationUI, 0);
            }
        }

        function goPrev() {
            if (!showPagination) return;
            var scroller = getScroller();
            if (!scroller) return;
            var clientWidth = scroller.clientWidth;
            if (currentPage > 1) {
                currentPage--;
                scroller.scrollTo({ left: (currentPage - 1) * clientWidth, behavior: 'auto' });
                updatePaginationUI();
            }
        }

        function goNext() {
            if (!showPagination) return;
            var scroller = getScroller();
            if (!scroller) return;
            var clientWidth = scroller.clientWidth;
            if (currentPage < totalPages) {
                currentPage++;
                scroller.scrollTo({ left: (currentPage - 1) * clientWidth, behavior: 'auto' });
                updatePaginationUI();
            }
        }

        function bindFrameInteractions() {
            if (!frame) return;
            var doc = null;
            var win = null;
            try {
                doc = frame.contentDocument;
                win = frame.contentWindow;
            } catch (e) {
                return;
            }
            if (!doc || !win) return;

            doc.addEventListener('click', function (event) {
                var target = event.target;
                var link = target && target.closest ? target.closest('a') : null;
                if (link) {
                    event.preventDefault();
                    var href = link.href;
                    var safe = false;
                    try {
                        var resolved = new URL(href, doc.baseURI || window.location.href);
                        safe = resolved.protocol === 'http:' || resolved.protocol === 'https:';
                        if (safe) href = resolved.href;
                    } catch (e) {
                        safe = false;
                    }
                    if (safe) {
                        window.location.href = 'browser.html?url=' + encodeURIComponent(href);
                    }
                    return;
                }

                var selection = win.getSelection ? win.getSelection() : null;
                if (selection && selection.toString().length > 0) return;

                var width = win.innerWidth;
                if (event.clientX < width / 2) {
                    goPrev();
                } else {
                    goNext();
                }
            });
        }

        function handleFrameLoad() {
            currentPage = 1;
            applyFontSize();
            if (showPagination) updatePaginationUI();
            bindFrameInteractions();
            if (typeof config.onFrameLoad === 'function') {
                try {
                    config.onFrameLoad(frame.contentWindow, frame.contentDocument);
                } catch (e) {
                    console.error('RekindleReader onFrameLoad:', e);
                }
            }
        }

        function open() {
            if (root.classList) root.classList.add('is-open');
            root.setAttribute('aria-hidden', 'false');
            activeReader = instance;
            applyFontSize();
            if (showPagination) updatePaginationUI();
        }

        function close() {
            if (root.classList) root.classList.remove('is-open');
            root.setAttribute('aria-hidden', 'true');
            if (activeReader === instance) activeReader = null;
        }

        function isOpen() {
            return !!(root.classList && root.classList.contains('is-open'));
        }

        function setTitle(text) {
            customTitle = true;
            titleEl.textContent = text === null || text === undefined ? '' : String(text);
        }

        function setActionLabel(id, text) {
            var def = actionRefs[id];
            if (!def) return;
            def.custom = true;
            def.el.textContent = text === null || text === undefined ? '' : String(text);
        }

        function getAction(id) {
            var def = actionRefs[id];
            return def ? def.el : null;
        }

        function relabel() {
            if (!customTitle) titleEl.textContent = defaultTitle();
            backButton.textContent = backText();
            var smaller = translate('help.font.smaller', 'Smaller text');
            var larger = translate('help.font.larger', 'Larger text');
            fontDown.title = smaller;
            fontDown.setAttribute('aria-label', smaller);
            fontUp.title = larger;
            fontUp.setAttribute('aria-label', larger);
            actionDefs.forEach(function (def) {
                if (def.custom) return;
                def.el.textContent = def.labelKey ? translate(def.labelKey, def.label) : def.label;
            });
        }

        homeButton.addEventListener('click', function () {
            window.location.href = 'index';
        });

        backButton.addEventListener('click', function () {
            if (typeof config.onBack === 'function') {
                config.onBack();
            } else {
                close();
            }
        });

        fontDown.addEventListener('click', function () {
            setFontSize(getFontSize() - FONT_STEP);
        });

        fontUp.addEventListener('click', function () {
            setFontSize(getFontSize() + FONT_STEP);
        });

        if (prevButton) prevButton.addEventListener('click', goPrev);
        if (nextButton) nextButton.addEventListener('click', goNext);
        if (frame) frame.addEventListener('load', handleFrameLoad);

        titleEl.textContent = defaultTitle();

        var instance = {
            open: open,
            close: close,
            isOpen: isOpen,
            setTitle: setTitle,
            setActionLabel: setActionLabel,
            getAction: getAction,
            getFrame: function () { return frame; },
            getContentEl: function () { return content; },
            applyFontSize: applyFontSize,
            getFontSize: getFontSize,
            setFontSize: function (size) { return setFontSize(size); },
            increaseFontSize: function () { return setFontSize(getFontSize() + FONT_STEP); },
            decreaseFontSize: function () { return setFontSize(getFontSize() - FONT_STEP); },
            updatePaginationUI: updatePaginationUI,
            prevPage: goPrev,
            nextPage: goNext,
            hasPagination: function () { return showPagination; }
        };

        readers.push(instance);
        document.addEventListener('rekindle:i18n:ready', relabel);
        updateFontButtons();

        return instance;
    }

    document.addEventListener('keydown', function (event) {
        if (!activeReader || !activeReader.isOpen() || !activeReader.hasPagination()) return;
        if (event.key === 'ArrowLeft') {
            activeReader.prevPage();
        } else if (event.key === 'ArrowRight') {
            activeReader.nextPage();
        }
    });

    window.RekindleReader = {
        MIN_FONT_SIZE: MIN_FONT,
        MAX_FONT_SIZE: MAX_FONT,
        DEFAULT_FONT_SIZE: DEFAULT_FONT,
        FONT_STEP: FONT_STEP,
        getFontSize: getFontSize,
        setFontSize: setFontSize,
        increaseFontSize: function () { return setFontSize(getFontSize() + FONT_STEP); },
        decreaseFontSize: function () { return setFontSize(getFontSize() - FONT_STEP); },
        create: create
    };
})(window, document);
