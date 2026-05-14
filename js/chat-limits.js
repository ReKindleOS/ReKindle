/**
 * Shared general-chat rate-limiting utility.
 * All message types (text, pixel art, flipbook) share the same quota.
 *
 * Limit: 10 posts per 5-minute sliding window.
 * Reads/writes a single small RTDB node per check.
 */

var CHAT_LIMITS = {
    WINDOW_MS: 5 * 60 * 1000, // 5 minutes
    MAX_POSTS: 10
};

/**
 * Check whether the user is allowed to post right now.
 *
 * @param {string}   username  The user's short name (email prefix).
 * @param {Function} callback  Called with callback(true) if allowed, callback(false) if blocked.
 */
function canUserSend(username, callback) {
    if (!username) {
        callback(false);
        return;
    }

    var limitRef = firebase.database().ref('kindlechat/user_limits/' + username);
    limitRef.once('value')
        .then(function (snapshot) {
            var data = snapshot.val();
            var now = Date.now();

            if (!data || !data.windowStart) {
                callback(true);
                return;
            }

            if (now - data.windowStart > CHAT_LIMITS.WINDOW_MS) {
                callback(true);
                return;
            }

            if (data.count >= CHAT_LIMITS.MAX_POSTS) {
                callback(false);
                return;
            }

            callback(true);
        })
        .catch(function (err) {
            console.error('Error reading chat limit:', err);
            // Fail-open so a transient error doesn't lock the user out
            callback(true);
        });
}

/**
 * Record a successful post so it counts against the shared quota.
 *
 * @param {string} username  The user's short name (email prefix).
 */
function recordUserSend(username) {
    if (!username) return;

    var limitRef = firebase.database().ref('kindlechat/user_limits/' + username);
    limitRef.once('value')
        .then(function (snapshot) {
            var data = snapshot.val();
            var now = Date.now();

            if (!data || !data.windowStart || (now - data.windowStart > CHAT_LIMITS.WINDOW_MS)) {
                return limitRef.set({
                    windowStart: now,
                    count: 1
                });
            }

            return limitRef.update({
                count: (data.count || 0) + 1
            });
        })
        .catch(function (err) {
            console.error('Error updating chat limit:', err);
        });
}
