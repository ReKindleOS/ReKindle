(function () {
    'use strict';

    function getRtdb() {
        if (window.rtdb) return window.rtdb;
        if (typeof firebase !== 'undefined' && firebase.database) {
            return firebase.database();
        }
        return null;
    }

    window.RekindleIpBan = {
        async fetchAndCheckIP() {
            const rtdb = getRtdb();
            try {
                const res = await fetch('https://api.ipify.org?format=json');
                const data = await res.json();
                const ip = data.ip;
                const safeIp = ip.replace(/\./g, '-').replace(/:/g, '_');

                if (rtdb) {
                    const snap = await rtdb.ref('banned_ips/' + safeIp).once('value');
                    if (snap.exists()) {
                        return { banned: true, ip: safeIp, rawIp: ip };
                    }
                }
                return { banned: false, ip: safeIp, rawIp: ip };
            } catch (e) {
                console.error("IP Check Failed", e);
                return { banned: false, ip: 'unknown', rawIp: 'unknown' };
            }
        },

        async enforceOnAuthStateChanged(user) {
            if (!user) return;
            const rtdb = getRtdb();
            const ipData = await this.fetchAndCheckIP();
            if (ipData.banned) {
                if (rtdb) {
                    await rtdb.ref('users_private/' + user.uid + '/ipAddress').set(ipData.rawIp).catch(function () { });
                }
                if (window.auth) {
                    await auth.signOut();
                }
                this.showBanMessage("Network Banned", "Your IP address is permanently banned from this network.");
            } else if (ipData.rawIp !== 'unknown' && rtdb) {
                await rtdb.ref('users_private/' + user.uid + '/ipAddress').set(ipData.rawIp).catch(function () { });
            }
        },

        async checkOnLogin() {
            if (typeof firebase === 'undefined' || !firebase.functions) {
                console.warn('Firebase Functions not available, skipping server-side IP check');
                return { banned: false };
            }
            const checkIP = firebase.functions().httpsCallable('checkIPOnLogin');
            const result = await checkIP({});
            return result.data;
        },

        showBanMessage(title, message) {
            if (typeof showGenericModal === 'function') {
                showGenericModal(title, message);
            } else if (typeof showAlertModal === 'function') {
                showAlertModal(message, title);
            } else if (typeof alert === 'function') {
                alert(title + '\n\n' + message);
            } else {
                console.error(title + ': ' + message);
            }
        }
    };
})();
