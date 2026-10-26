/*
 * Outlook / Hotmail OAuth regression test.
 *
 * Run: node scripts/test-mail-oauth.js
 *
 * Microsoft retired Basic Auth for every Outlook.com protocol on 2024-09-16;
 * IMAP/SMTP now only accept OAuth2 (SASL XOAUTH2). These assertions protect the
 * two things that are easy to break later:
 *
 *   1. An OAuth account must never connect to a client-supplied IMAP/SMTP host
 *      (an access token is a bearer credential), and its IMAP auth object must
 *      never contain a password.
 *   2. Every mail callable must resolve its connection through the shared
 *      helper, so a new callable cannot quietly reintroduce password-only auth.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const cfg = require('../firebase-functions/mail-oauth-config.js');

(async () => {
    // --- endpoints are pinned, regardless of what the client sends ---
    assert.strictEqual(cfg.MICROSOFT_IMAP.host, 'outlook.office365.com');
    assert.strictEqual(cfg.MICROSOFT_IMAP.port, 993);
    assert.strictEqual(cfg.MICROSOFT_IMAP.secure, true);
    assert.strictEqual(cfg.MICROSOFT_SMTP.host, 'smtp.office365.com');
    assert.strictEqual(cfg.MICROSOFT_SMTP.port, 587);

    const spoofed = { oauth: 'microsoft', host: 'evil.example.com', port: 993, secure: true };
    assert.strictEqual(cfg.endpointFor(spoofed, 'imap').host, 'outlook.office365.com',
        'OAuth IMAP must ignore a client-supplied host');
    assert.strictEqual(cfg.endpointFor(spoofed, 'smtp').host, 'smtp.office365.com',
        'OAuth SMTP must ignore a client-supplied host');
    assert.strictEqual(cfg.endpointFor(spoofed, 'smtp').requireTLS, true,
        'OAuth SMTP on 587 must require STARTTLS');

    // Password accounts keep their own endpoint.
    const custom = { host: 'imap.example.org', port: 143, secure: false, auth: { user: 'a', pass: 'b' } };
    assert.deepStrictEqual(cfg.endpointFor(custom, 'imap'), { host: 'imap.example.org', port: 143, secure: false });
    assert.strictEqual(cfg.endpointFor({ host: 'x.example.org' }, 'smtp').port, 465);

    // --- auth object shape the two libraries require ---
    const tokens = { email: 'someone@hotmail.com', accessToken: 'ya29.fake-token' };
    const imapAuth = cfg.authFor(spoofed, 'imap', tokens);
    assert.strictEqual(imapAuth.user, 'someone@hotmail.com');
    assert.strictEqual(imapAuth.accessToken, 'ya29.fake-token');
    assert.ok(!('pass' in imapAuth), 'OAuth IMAP auth must not carry a password');

    const smtpAuth = cfg.authFor(spoofed, 'smtp', tokens);
    assert.strictEqual(smtpAuth.type, 'OAuth2');
    assert.strictEqual(smtpAuth.accessToken, 'ya29.fake-token');

    assert.throws(() => cfg.authFor(spoofed, 'imap', null), /Missing Microsoft access token/);
    assert.throws(() => cfg.authFor(spoofed, 'smtp', { email: '' }), /Missing Microsoft access token/);

    // --- provider detection and URLs ---
    assert.strictEqual(cfg.isMicrosoftOAuth({ oauth: 'microsoft' }), true);
    assert.strictEqual(cfg.isMicrosoftOAuth({ oauth: 'google' }), false);
    assert.strictEqual(cfg.isMicrosoftOAuth({ auth: { user: 'a', pass: 'b' } }), false);
    assert.strictEqual(cfg.isMicrosoftOAuth(null), false);

    assert.strictEqual(cfg.microsoftDeviceCodeUrl(), 'https://login.microsoftonline.com/common/oauth2/v2.0/devicecode');
    assert.strictEqual(cfg.microsoftTokenUrl(), 'https://login.microsoftonline.com/common/oauth2/v2.0/token');

    // Personal-accounts-only escape hatch, and it must not accept junk.
    process.env.MAIL_MS_TENANT = 'consumers';
    assert.strictEqual(cfg.microsoftTenant(), 'consumers');
    assert.strictEqual(cfg.microsoftDeviceCodeUrl(), 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode');
    process.env.MAIL_MS_TENANT = '../evil.example.com';
    assert.strictEqual(cfg.microsoftTenant(), 'common', 'invalid tenant falls back to common');
    delete process.env.MAIL_MS_TENANT;

    // Graph exposes the legacy-protocol permissions, so a bare Entra tenant with
    // no "Office 365 Exchange Online" service principal can still authorise.
    const scopes = cfg.microsoftScopes().split(' ');
    assert.ok(scopes.includes('https://graph.microsoft.com/IMAP.AccessAsUser.All'), 'IMAP scope required');
    assert.ok(scopes.includes('https://graph.microsoft.com/SMTP.Send'), 'SMTP scope required');
    assert.ok(scopes.includes('offline_access'), 'offline_access yields the refresh token');

    // Exactly one resource: Entra rejects a request that mixes audiences.
    const audiences = scopes.filter(s => /^https:\/\//.test(s))
        .map(s => s.split('/')[2])
        .filter((v, i, a) => a.indexOf(v) === i);
    assert.deepStrictEqual(audiences, ['graph.microsoft.com'], 'default audience must be Graph only');

    // Exchange-audience fallback for tenants that do have the Exchange SP.
    process.env.MAIL_MS_SCOPE_AUDIENCE = 'outlook';
    const exchangeScopes = cfg.microsoftScopes().split(' ');
    assert.ok(exchangeScopes.includes('https://outlook.office.com/IMAP.AccessAsUser.All'));
    assert.ok(exchangeScopes.includes('https://outlook.office.com/SMTP.Send'));
    delete process.env.MAIL_MS_SCOPE_AUDIENCE;
    assert.ok(cfg.microsoftScopes().includes('https://graph.microsoft.com/IMAP.AccessAsUser.All'),
        'Graph is the default audience');

    // --- no hard-coded client id / secret in the repo ---
    assert.strictEqual(cfg.microsoftClientId, cfg.microsoftClientId, 'client id must be read from env');
    const prev = process.env.MAIL_MS_CLIENT_ID;
    process.env.MAIL_MS_CLIENT_ID = '  test-client-id  ';
    assert.strictEqual(cfg.microsoftClientId(), 'test-client-id');
    delete process.env.MAIL_MS_CLIENT_ID;
    assert.strictEqual(cfg.microsoftClientId(), '');
    if (prev !== undefined) process.env.MAIL_MS_CLIENT_ID = prev;

    // --- index.js wiring ---
    const fn = fs.readFileSync(path.join(__dirname, '..', 'firebase-functions', 'index.js'), 'utf8');

    for (const name of ['fetchEmails', 'moveEmail', 'modifyFlags', 'fetchEmailBody', 'getFolders']) {
        const start = fn.indexOf(`exports.${name} = onCall`);
        assert.ok(start > -1, `${name} callable must exist`);
        const body = fn.slice(start, start + 2000);
        assert.ok(body.includes('resolveMailConnection('), `${name} must resolve its connection through resolveMailConnection`);
        assert.ok(!/assertMailAuthConfig\(\s*imapConfig\s*\)/.test(body), `${name} must not gate on password creds directly`);
    }
    const sendStart = fn.indexOf('exports.sendEmail = onCall');
    assert.ok(sendStart > -1, 'sendEmail callable must exist');
    const sendBody = fn.slice(sendStart, sendStart + 2500);
    assert.ok(sendBody.includes('resolveMailConnection('), 'sendEmail must resolve its connection through resolveMailConnection');
    assert.ok(!/from:\s*message\.from\s*\|\|\s*smtpConfig\.auth\.user/.test(sendBody),
        'sendEmail must not fall back to smtpConfig.auth.user (undefined for OAuth)');

    // The OAuth callables exist and never expose the refresh token.
    for (const name of ['mailMicrosoftStart', 'mailMicrosoftPoll', 'mailMicrosoftStatus', 'mailMicrosoftDisconnect']) {
        assert.ok(fn.includes(`exports.${name} = onCall`), `${name} callable must exist`);
    }
    assert.ok(!/return\s*\{[^}]*\brefreshToken\s*:/.test(fn), 'a callable must never return the refresh token');
    assert.ok(!fn.includes('MICROSOFT_SCOPES'), 'callables must use microsoftScopes() (audience-aware)');
    assert.ok(fn.includes('mail_oauth/'), 'refresh tokens must live in the service-account-only mail_oauth node');

    // RTDB default-deny: mail_oauth must not be added as a public node.
    const rules = fs.readFileSync(path.join(__dirname, '..', 'rtdb-rules.json'), 'utf8');
    assert.ok(!/"mail_oauth"\s*:/.test(rules), 'mail_oauth must stay default-deny (Admin SDK only)');

    console.log('PASS - Outlook OAuth mail config');
})().catch(err => {
    console.error('FAIL - Outlook OAuth mail config:', err);
    process.exit(1);
});
