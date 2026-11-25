/*
 * Account recovery kit.
 *
 * A 20-character code is generated in the browser and shown once. Only a
 * salted SHA-256 hash is stored in the user's private Firestore settings, so
 * the server never learns the code. The reset callable verifies the hash and
 * sets a new password while signed out.
 *
 * This is deliberately NOT an email feature: ReKindle accounts have synthetic
 * usernames and no transactional sender, so a code gives self-serve recovery
 * without collecting children's email addresses.
 */
(function () {
    'use strict';

    // Unambiguous alphabet: no 0/1/I/L/O/U.
    var ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
    var CODE_LENGTH = 20;

    function normaliseCode(value) {
        return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    }

    function isSupported() {
        return !!(window.crypto && window.crypto.getRandomValues);
    }

    function randomBytes(count) {
        var bytes = new Uint8Array(count);
        if (window.crypto && window.crypto.getRandomValues) {
            window.crypto.getRandomValues(bytes);
        } else {
            throw new Error('Secure random numbers are not available in this browser.');
        }
        return bytes;
    }

    function toHex(bytes) {
        var out = '';
        for (var i = 0; i < bytes.length; i++) {
            out += ('0' + bytes[i].toString(16)).slice(-2);
        }
        return out;
    }

    function generateCode() {
        var bytes = randomBytes(CODE_LENGTH);
        var out = '';
        for (var i = 0; i < CODE_LENGTH; i++) out += ALPHABET.charAt(bytes[i] % ALPHABET.length);
        return out;
    }

    function generateSalt() {
        return toHex(randomBytes(16));
    }

    function isValidCode(value) {
        var clean = normaliseCode(value);
        if (clean.length !== CODE_LENGTH) return false;
        for (var i = 0; i < clean.length; i++) {
            if (ALPHABET.indexOf(clean.charAt(i)) === -1) return false;
        }
        return true;
    }

    function group(value) {
        var clean = normaliseCode(value);
        var parts = [];
        for (var i = 0; i < clean.length; i += 4) parts.push(clean.slice(i, i + 4));
        return parts.join('-');
    }

    // Compact SHA-256 for ASCII input. The recovery code, salt and uid contain
    // only ASCII, and this keeps the feature working on older WebKit where
    // crypto.subtle/TextEncoder are missing. It is not a password KDF: the code
    // itself has ~99 bits of entropy.
    var SHA_K = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];

    function sha256Hex(text) {
        var bytes = [];
        var i;
        for (i = 0; i < text.length; i++) {
            var code = text.charCodeAt(i);
            if (code < 0x80) bytes.push(code);
            else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
            else bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
        }
        var bitLen = bytes.length * 8;
        bytes.push(0x80);
        while (bytes.length % 64 !== 56) bytes.push(0);
        var hi = Math.floor(bitLen / 0x100000000);
        var lo = bitLen >>> 0;
        bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255);
        bytes.push((lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);

        var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
        var w = new Array(64);
        for (var off = 0; off < bytes.length; off += 64) {
            for (i = 0; i < 16; i++) {
                w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) |
                    (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
            }
            for (i = 16; i < 64; i++) {
                var s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
                var s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
                w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
            }
            var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
            for (i = 0; i < 64; i++) {
                var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
                var ch = (e & f) ^ (~e & g);
                var t1 = (hh + S1 + ch + SHA_K[i] + w[i]) | 0;
                var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
                var maj = (a & b) ^ (a & c) ^ (b & c);
                var t2 = (S0 + maj) | 0;
                hh = g; g = f; f = e; e = (d + t1) | 0;
                d = c; c = b; b = a; a = (t1 + t2) | 0;
            }
            h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
            h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
        }
        var out = '';
        for (i = 0; i < 8; i++) {
            out += ('00000000' + (h[i] >>> 0).toString(16)).slice(-8);
        }
        return out;
    }

    function hashCode(uid, salt, code) {
        if (!isSupported()) {
            return Promise.reject(new Error('Secure random numbers are not available in this browser.'));
        }
        var input = String(uid) + ':' + String(salt) + ':' + normaliseCode(code);
        return Promise.resolve(sha256Hex(input));
    }

    function recoveryKitText(username, code) {
        return [
            'ReKindle recovery kit',
            '',
            'Username: ' + username,
            'Recovery code: ' + group(code),
            '',
            'Keep this somewhere safe. Anyone with this code can reset the password.',
            'Use it at https://rekindle.ink/recover',
            '',
            'If you lose the code, the ReKindle team may be able to help from the account console.'
        ].join('\n');
    }

    function downloadKit(username, code) {
        var text = recoveryKitText(username, code);
        var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'rekindle-recovery-' + String(username || 'account').replace(/[^A-Za-z0-9_-]/g, '') + '.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    window.RekindleRecovery = {
        ALPHABET: ALPHABET,
        CODE_LENGTH: CODE_LENGTH,
        normaliseCode: normaliseCode,
        isValidCode: isValidCode,
        group: group,
        generateCode: generateCode,
        generateSalt: generateSalt,
        hashCode: hashCode,
        recoveryKitText: recoveryKitText,
        downloadKit: downloadKit,
        isSupported: isSupported
    };
})();
