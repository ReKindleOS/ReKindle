/*
 * Deleted-user presentation helpers (social pages).
 *
 * Account deletion removes the social `users_public` and `user_cards` records.
 * A social page that looks up one of those uids gets `null`; it must render the
 * neutral person outline (the same art as the signed-out guest badge) and the
 * name "Deleted User" instead of a uid prefix, a procedural avatar or a blank
 * white square.
 *
 * White is a legitimate avatar choice again (customAvatar 'blank' or a complete
 * all-zero grid), so a white canvas can no longer stand for "deleted". Use
 * window.rekindleDrawDeletedAvatar() for missing profiles and drawAvatar(seed)
 * for real ones.
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

    function resolveCanvas(canvasOrId) {
        return (canvasOrId && canvasOrId.nodeType === 1)
            ? canvasOrId
            : document.getElementById(canvasOrId);
    }

    // 16x16 guest portrait (guest16.png): an outlined frame around a person.
    // '#' is ink, '.' is white. KEEP IN SYNC with drawGuestAvatar() in
    // js/home.js; scripts/test-avatars.js compares both renders.
    var GUEST_ICON = [
        '................',
        '.....######.....',
        '...##......##...',
        '..#...####...#..',
        '..#..#....#..#..',
        '.#...#....#...#.',
        '.#...#....#...#.',
        '.#....####....#.',
        '.#............#.',
        '.#...######...#.',
        '.#..#......#..#.',
        '..##........##..',
        '..##........##..',
        '...##......##...',
        '.....######.....',
        '................'
    ];

    // Scaled from the 16x16 grid to any square canvas. Black ink on white so
    // it reads on e-ink and survives dark mode (theme.js re-inverts canvases).
    function drawGuestAvatar(canvasOrId) {
        var canvas = resolveCanvas(canvasOrId);
        if (!canvas || !canvas.getContext) return;
        var ctx = canvas.getContext('2d');
        var u = canvas.width / 16;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#000';
        for (var y = 0; y < 16; y++) {
            var row = GUEST_ICON[y];
            var x = 0;
            while (x < 16) {
                if (row.charAt(x) === '.') { x++; continue; }
                var start = x;
                while (x < 16 && row.charAt(x) === '#') x++;
                // One rect per ink run: the icon costs 37 fillRects, not 66.
                ctx.fillRect(start * u, y * u, (x - start) * u, u);
            }
        }
    }

    window.rekindleDrawGuestAvatar = drawGuestAvatar;
    window.rekindleDrawDeletedAvatar = drawGuestAvatar;

    // Blank white canvas, kept for loading placeholders and legacy callers.
    // Deleted accounts must use rekindleDrawDeletedAvatar instead so they can
    // never be confused with a deliberately white profile picture.
    window.rekindleClearAvatar = function (canvasOrId) {
        var canvas = resolveCanvas(canvasOrId);
        if (!canvas || !canvas.getContext) return;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    };
})();
