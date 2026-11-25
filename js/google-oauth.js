/*
 * Shared Google OAuth redirect/query handling.
 *
 * Google requires an exact registered redirect URI. Sending the current URL
 * (including ?date=… or other app state) makes Google return
 * "Error 400: redirect_uri_mismatch". We always send the clean path and carry
 * the original query in OAuth `state`, then restore it before the app's
 * deep-link code runs.
 */
(function () {
    'use strict';

    window.rekindleGoogleRedirectUri = function () {
        return window.location.origin + window.location.pathname;
    };

    try {
        var raw = window.location.hash ? window.location.hash.substring(1) : '';
        if (!raw) return;
        var params = new URLSearchParams(raw);
        if (!params.get('access_token') && !params.get('error')) return;
        var state = params.get('state');
        // Only restore a query string, never a full URL or another fragment.
        if (!state || state.charAt(0) !== '?' || state.length > 2000 || state.indexOf('#') !== -1) return;
        window.history.replaceState({}, document.title || '', window.location.pathname + state + window.location.hash);
    } catch (e) { /* malformed OAuth response */ }
})();
