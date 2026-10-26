'use strict';

/**
 * Microsoft (Outlook.com / Hotmail / Microsoft 365) OAuth constants for the
 * ReKindle mail callables.
 *
 * Why this exists: Microsoft retired Basic Authentication for every
 * Outlook.com protocol on 2024-09-16, so IMAP/SMTP now only accept OAuth2 via
 * SASL XOAUTH2. `imapflow` switches to XOAUTH2 when the auth object carries
 * `accessToken`; `nodemailer` needs `auth.type === 'OAuth2'`.
 *
 * This module is deliberately dependency-free (no firebase-admin) so
 * `scripts/test-mail-oauth.js` can assert the security-relevant invariants
 * without a Firebase runtime:
 *
 *   1. OAuth connections always go to Microsoft's hosts, never to a host the
 *      client supplied — an access token is a bearer credential and must not
 *      be sendable to an arbitrary IMAP server.
 *   2. The IMAP auth object never carries a password.
 *   3. The device-code and token URLs point at Microsoft's login endpoint for
 *      the configured tenant, so a typo cannot ship codes elsewhere.
 *   4. Scopes are built from one audience (Graph by default, Exchange via
 *      MAIL_MS_SCOPE_AUDIENCE=outlook) — mixing two resources in one token
 *      request is rejected by Entra.
 *
 * Docs: https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth
 */

const MICROSOFT_PROVIDER = 'microsoft';

// "common" covers work/school + personal (hotmail/outlook/live) accounts.
// `MAIL_MS_TENANT=consumers` narrows it to personal accounts only, which is the
// escape hatch if the multitenant publisher-verification policy ever blocks
// consent (see docs/agent/integrations.md).
function microsoftTenant() {
    const tenant = String(process.env.MAIL_MS_TENANT || 'common').trim().toLowerCase();
    return /^[a-z0-9.-]{2,64}$/.test(tenant) ? tenant : 'common';
}

function microsoftLoginBase() {
    return 'https://login.microsoftonline.com/' + microsoftTenant() + '/oauth2/v2.0';
}

function microsoftDeviceCodeUrl() {
    return microsoftLoginBase() + '/devicecode';
}

function microsoftTokenUrl() {
    return microsoftLoginBase() + '/token';
}

// Microsoft Graph exposes the legacy-protocol permissions itself:
//   IMAP.AccessAsUser.All  (652390e4-393a-48de-9484-05f9b1212954, delegated)
//   SMTP.Send              (258f6531-6087-4cc4-bb90-092c5fb3ed3f, delegated)
// Both are consentable by personal Microsoft accounts and need no admin
// consent, so a tenant WITHOUT an "Office 365 Exchange Online" service
// principal (a bare Entra directory) can still authorise ReKindle.
//
// The Exchange resource (https://outlook.office.com/...) is the audience
// Thunderbird uses, but it only appears in "APIs my organization uses" once
// that service principal exists. Exchange accepts either audience, so Graph is
// the default; set MAIL_MS_SCOPE_AUDIENCE=outlook to switch back.
const MICROSOFT_SCOPE_AUDIENCE = () => {
    const mode = String(process.env.MAIL_MS_SCOPE_AUDIENCE || 'graph').trim().toLowerCase();
    return mode === 'outlook' ? 'https://outlook.office.com' : 'https://graph.microsoft.com';
};

// `offline_access` is what yields a refresh token; `openid profile email` adds
// an id_token so the connected mailbox address can be confirmed server-side.
function microsoftScopes() {
    const audience = MICROSOFT_SCOPE_AUDIENCE();
    return [
        'openid',
        'profile',
        'email',
        'offline_access',
        audience + '/IMAP.AccessAsUser.All',
        audience + '/SMTP.Send'
    ].join(' ');
}

// Server-side only. The client never chooses these for an OAuth account.
const MICROSOFT_IMAP = { host: 'outlook.office365.com', port: 993, secure: true };
const MICROSOFT_SMTP = { host: 'smtp.office365.com', port: 587, secure: false, requireTLS: true };

// Public-client identifier from the Azure app registration. Read lazily so a
// missing value produces a clean "not configured" error instead of a crash on
// cold start (and so `firebase functions:config` era deploys keep working).
function microsoftClientId() {
    return String(process.env.MAIL_MS_CLIENT_ID || '').trim();
}

function isMicrosoftOAuth(config) {
    return !!config && config.oauth === MICROSOFT_PROVIDER;
}

/**
 * Connection endpoint for a mail callable.
 *
 * For OAuth accounts the endpoint is pinned to Microsoft's servers and any
 * host/port in the client payload is ignored. For password accounts the
 * caller-supplied endpoint is returned unchanged (index.js still runs
 * assertMailEndpoint on it).
 */
function endpointFor(config, kind) {
    if (!config) return null;
    if (isMicrosoftOAuth(config)) {
        return kind === 'smtp'
            ? { host: MICROSOFT_SMTP.host, port: MICROSOFT_SMTP.port, secure: MICROSOFT_SMTP.secure, requireTLS: true }
            : { host: MICROSOFT_IMAP.host, port: MICROSOFT_IMAP.port, secure: MICROSOFT_IMAP.secure };
    }
    const fallbackPort = kind === 'smtp' ? 465 : 993;
    return {
        host: config.host,
        port: Number(config.port) || fallbackPort,
        secure: config.secure !== false
    };
}

/**
 * Auth object for ImapFlow / Nodemailer.
 *
 * `tokens` is only used for OAuth accounts: { email, accessToken }.
 * ImapFlow turns `{ user, accessToken }` into `AUTHENTICATE XOAUTH2`;
 * Nodemailer needs the explicit `type: 'OAuth2'`.
 */
function authFor(config, kind, tokens) {
    if (isMicrosoftOAuth(config)) {
        if (!tokens || !tokens.email || !tokens.accessToken) {
            throw new Error('Missing Microsoft access token.');
        }
        return kind === 'smtp'
            ? { type: 'OAuth2', user: tokens.email, accessToken: tokens.accessToken }
            : { user: tokens.email, accessToken: tokens.accessToken };
    }
    return config && config.auth;
}

module.exports = {
    MICROSOFT_PROVIDER,
    microsoftTenant,
    microsoftLoginBase,
    microsoftDeviceCodeUrl,
    microsoftTokenUrl,
    microsoftScopes,
    MICROSOFT_IMAP,
    MICROSOFT_SMTP,
    microsoftClientId,
    isMicrosoftOAuth,
    endpointFor,
    authFor
};
