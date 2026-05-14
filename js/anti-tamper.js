/**
 * ReKindle Anti-Tamper
 * Detects and neutralizes common userscript bypass techniques.
 * Include this as the FIRST script in <head> for best protection.
 */
(function () {
    'use strict';

    const maliciousPatterns = [
        /#paywall-overlay\s*\{[^}]*display\s*:\s*none/i,
        /\.pro-locked\s*\{[^}]*display\s*:\s*none/i,
        /\.plus-label\s*\{[^}]*display\s*:\s*none/i
    ];

    const nativeRemove = Element.prototype.remove;
    const nativeDefineProperty = Object.defineProperty;

    function isMaliciousStyle(el) {
        if (el.tagName !== 'STYLE') return false;
        const text = el.textContent || el.innerText || '';
        return maliciousPatterns.some(p => p.test(text));
    }

    function removeMaliciousStyle(el) {
        try {
            console.warn('[ReKindle Anti-Tamper] Neutralizing malicious style injection.');
            nativeRemove.call(el);
        } catch (e) {
            // Fallback
            el.textContent = '';
        }
    }

    // 1. Scan existing styles
    document.querySelectorAll('style').forEach(el => {
        if (isMaliciousStyle(el)) removeMaliciousStyle(el);
    });

    // 2. Watch for new style injections
    if (window.MutationObserver) {
        const observer = new MutationObserver(mutations => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType === 1 && isMaliciousStyle(node)) {
                        removeMaliciousStyle(node);
                    }
                }
            }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    // 3. Detect global isPro locking (userscript pattern)
    setInterval(() => {
        const desc = Object.getOwnPropertyDescriptor(window, 'isPro');
        if (desc && (desc.get || desc.set) && !desc.configurable) {
            console.warn('[ReKindle Anti-Tamper] Global isPro locked by external script.');
        }
    }, 2000);
})();
