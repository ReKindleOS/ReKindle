/*
 * Deleted-user presentation helpers (social pages).
 *
 * Account deletion removes the social `users_public` and `user_cards` records.
 * A social page that looks up one of those uids gets `null`; it must render a
 * blank white avatar and the name "Deleted User" instead of a uid prefix or a
 * procedural avatar.
 *
 * Loaded by kindlechat.html, topics.html and neighbourhood.html after theme.js.
 * Keep the label behind window.t so it can be translated; locales/en.json has
 * common.deleted_user.
 */
(function () {
    'use strict';

    function label() {
        if (typeof window.t === 'function') {
            return window.t('common.deleted_user', 'Deleted User');
        }
        return 'Deleted User';
    }

    window.rekindleDeletedUserName = label;

    // A profile lookup that returned no card means the account/profile is gone.
    window.rekindleIsDeletedUser = function (card) {
        return !card || typeof card !== 'object' || card.deleted === true;
    };

    window.rekindleClearAvatar = function (canvasOrId) {
        var canvas = (canvasOrId && canvasOrId.nodeType === 1)
            ? canvasOrId
            : document.getElementById(canvasOrId);
        if (!canvas || !canvas.getContext) return;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    };
})();
