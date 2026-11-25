/*
 * Display name vs login handle guard.
 *
 * Run: node scripts/test-display-names.js
 *
 * Firebase lowercases the Auth email, and the handle used by sign-in, lookups
 * and moderation checks is derived from it. Capitals therefore live in a
 * separate displayName. This test pins the split so a future edit cannot:
 *   - create accounts without a case-preserving displayName;
 *   - print a display name where a lookup/role check needs the handle;
 *   - rebuild user_cards.username from the lowercase email on a profile save;
 *   - ship rules that leave displayName unvalidated.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

// --- Registration stores both names -----------------------------------------
const functions = read('firebase-functions/index.js');
const register = functions.slice(functions.indexOf('exports.registerUser'), functions.indexOf('exports.getUserAuthStatus'));
assert.ok(
    /createUser\(\{\s*email,\s*password,\s*displayName:\s*username\s*\}\)/.test(register),
    'registerUser must set Auth displayName to the typed username'
);
assert.ok(
    /users_public[\s\S]{0,200}displayName:\s*username/.test(register),
    'registration must store displayName on users_public'
);
assert.ok(
    /user_cards[\s\S]{0,200}displayName:\s*username/.test(register),
    'registration must store displayName on user_cards'
);
assert.ok(
    /user_cards[\s\S]{0,200}username:\s*username/.test(register),
    'registration must keep the username handle on user_cards'
);

// --- Case-only rename callable ----------------------------------------------
const rename = functions.slice(functions.indexOf('function isCaseOnlyVariant'), functions.indexOf('exports.getUserAuthStatus'));
assert.ok(rename.indexOf('updateUser(uid, { displayName: raw })') !== -1,
    'setDisplayName must write the Auth displayName');
assert.ok(rename.indexOf('user_cards/${uid}/displayName') !== -1,
    'setDisplayName must write the primary user card');
assert.ok(rename.indexOf('isCaseOnlyVariant(raw, handle)') !== -1,
    'setDisplayName must reject anything but a case-only change');
assert.ok(rename.indexOf('b === a + 32') !== -1 && rename.indexOf('b === a - 32') !== -1,
    'the server check must only allow ASCII letter case swaps');

// Run the server's pure check: case swaps pass, anything else fails.
const vm = require('vm');
const serverCheckSrc = functions.slice(functions.indexOf('function isCaseOnlyVariant'), functions.indexOf('exports.setDisplayName'));
const serverSandbox = {};
vm.createContext(serverSandbox);
vm.runInContext(serverCheckSrc, serverSandbox);
const caseOnly = serverSandbox.isCaseOnlyVariant;
assert.strictEqual(typeof caseOnly, 'function', 'isCaseOnlyVariant must be a function');
assert.strictEqual(caseOnly('Ukiyo', 'ukiyo'), true, 'initial capital is allowed');
assert.strictEqual(caseOnly('UKIYO', 'ukiyo'), true, 'all caps is allowed');
assert.strictEqual(caseOnly('ukiyo', 'ukiyo'), true, 'same case is allowed');
assert.strictEqual(caseOnly('John+Tag', 'john+tag'), true, 'non-letters must match exactly but may stay');
assert.strictEqual(caseOnly('Ukiy0', 'ukiyo'), false, 'changed letters are rejected');
assert.strictEqual(caseOnly('ukiyoo', 'ukiyo'), false, 'added characters are rejected');
assert.strictEqual(caseOnly('Ukiy\u043e', 'ukiyo'), false, 'Unicode look-alikes are rejected');
assert.strictEqual(caseOnly('uki yo', 'ukiyo'), false, 'whitespace additions are rejected');
assert.ok(rename.indexOf('socialAdminApp') !== -1,
    'setDisplayName must keep the social profile in sync');

// --- Both RTDB rule sets validate displayName -------------------------------
for (const file of ['rtdb-rules.json', 'rtdb-social-rules.json']) {
    const rules = JSON.parse(read(file)).rules;
    for (const [node, label] of [[rules.users_public && rules.users_public.$userId, 'users_public'],
                                 [rules.user_cards && rules.user_cards.$uid, 'user_cards']]) {
        assert.ok(node && node.displayName && typeof node.displayName['.validate'] === 'string',
            file + ': ' + label + ' must validate displayName');
        assert.ok(node.displayName['.validate'].indexOf('a-zA-Z0-9') !== -1,
            file + ': ' + label + ' displayName must stay alphanumeric-only');
        assert.ok(node.displayName['.validate'].indexOf('ukiyo') !== -1,
            file + ': ' + label + ' displayName must keep the impersonation block');
    }
}

// --- Dashboard prints the name but keeps the handle for login ---------------
const home = read('js/home.js');
assert.ok(home.indexOf('user.displayName') !== -1, 'dashboard greeting must prefer Auth displayName');
assert.ok(home.indexOf("localStorage.setItem('rekindle_last_username', authHandle)") !== -1,
    'the login prefill must keep the lowercase handle');

const settings = read('settings.html');
assert.ok(settings.indexOf('user.displayName') !== -1, 'settings must prefer the display name');
assert.ok(settings.indexOf('nameEl.textContent = shown') !== -1,
    'settings must render the name with textContent, not innerHTML');
assert.ok(settings.indexOf('isCaseOnlyNameVariant(named, handle)') !== -1,
    'settings must ignore display names that are not a case variant');

const indexOld = read('index_old.html');
assert.ok(indexOld.indexOf('isCaseOnlyNameVariant(namedUser, authHandle)') !== -1,
    'the classic dashboard must ignore display names that are not a case variant');

assert.ok(home.indexOf('isCaseOnlyNameVariant(namedUser, authHandle)') !== -1,
    'the dashboard must ignore display names that are not a case variant');

// --- KindleChat prints displayName, identity checks stay on the handle ------
const chat = read('kindlechat.html');
const author = chat.slice(chat.indexOf('function resolveMessageAuthor'), chat.indexOf('function fetchProfileByUsername'));
assert.ok(author.indexOf('cardShownName(card) || username') !== -1,
    'message authors must print cardShownName(card) || card.username');
assert.ok(author.indexOf("var isDev = (username === 'ukiyo')") !== -1,
    'the DEV role check must stay on the lowercase handle');
assert.ok(author.indexOf('>Ukiyo</span>') === -1, 'the owner name must not be hard-coded');
assert.ok(chat.indexOf('function cardShownName') !== -1, 'chat must guard cards with cardShownName');
assert.ok(chat.indexOf('card.displayName ||') === -1 && chat.indexOf('card.displayName||') === -1,
    'chat must never print an unguarded card display name');

// --- Neighbourhood prefers the name, saves stop flattening the handle -------
const neighbourhood = read('neighbourhood.html');
const kindleName = neighbourhood.slice(neighbourhood.indexOf('function getKindleName'), neighbourhood.indexOf('function censorUsername'));
assert.ok(kindleName.indexOf('displayName') !== -1, 'getKindleName must prefer the display name');
assert.ok(kindleName.indexOf('isCaseOnlyUsernameChange(named, nameHandle)') !== -1,
    'getKindleName must ignore legacy display names that are not a case variant');
assert.ok(neighbourhood.indexOf('isCaseOnlyUsernameChange(legacyName, handle)') !== -1,
    'the profile modal must ignore legacy display names');

const saveProfile = neighbourhood.slice(neighbourhood.indexOf('async function saveProfile'), neighbourhood.indexOf('// LOAD MY PROFILE'));
assert.ok(saveProfile.indexOf('profileData.displayName') === -1 && saveProfile.indexOf('cardUpdate.displayName') === -1,
    'the setDisplayName callable must be the only writer on save');
assert.ok(saveProfile.indexOf('username: username') === -1,
    'profile save must not rebuild user_cards.username from the lowercase email');
assert.ok(saveProfile.indexOf("httpsCallable('setDisplayName')") !== -1,
    'profile save must go through the case-only callable');
assert.ok(saveProfile.indexOf('isCaseOnlyUsernameChange(requestedDisplayName, handle)') !== -1,
    'the edit form must enforce a case-only change before saving');
assert.ok(neighbourhood.indexOf('function isCaseOnlyUsernameChange') !== -1,
    'the client must implement the same ASCII case-pair check');
assert.ok(neighbourhood.indexOf('b === a + 32') !== -1 && neighbourhood.indexOf('b === a - 32') !== -1,
    'the client check must only allow ASCII letter case swaps');
const clientCheckSrc = neighbourhood.slice(neighbourhood.indexOf('function isCaseOnlyUsernameChange'), neighbourhood.indexOf('function usernameHandle'));
const clientSandbox = {};
vm.createContext(clientSandbox);
vm.runInContext(clientCheckSrc, clientSandbox);
const clientCaseOnly = clientSandbox.isCaseOnlyUsernameChange;
assert.strictEqual(typeof clientCaseOnly, 'function');
assert.strictEqual(clientCaseOnly('Ukiyo', 'ukiyo'), true);
assert.strictEqual(clientCaseOnly('Ukiy0', 'ukiyo'), false);
assert.strictEqual(clientCaseOnly('Ukiy\u043e', 'ukiyo'), false);
assert.strictEqual(clientCaseOnly('John+Tag', 'john+tag'), true);
const editModeAt = neighbourhood.indexOf('id="profile-edit-mode"');
const displayFieldAt = neighbourhood.indexOf('id="input-display-name"');
const editColumnsAt = neighbourhood.indexOf('<div class="dual-column">', editModeAt);
assert.ok(displayFieldAt !== -1, 'the display name field must exist in the edit-profile form');
assert.ok(displayFieldAt > editModeAt && displayFieldAt < editColumnsAt,
    'the display name field must sit in the edit-profile form, not elsewhere');

const loadProfile = neighbourhood.slice(neighbourhood.indexOf('function loadMyProfile'), neighbourhood.indexOf('function loadOtherUserProfile'));
assert.ok(loadProfile.indexOf('if (!card) cardUpdate.username = fallbackName;') !== -1,
    'the handle is only written when the mirror is missing');

console.log('PASS - display names (handle stays lowercase)');
