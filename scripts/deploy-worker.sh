#!/usr/bin/env bash
#
# Deploy one Worker using the account pinned in its wrangler.toml.
#
#   npm run deploy:worker -- rekindle-moderate
#   npm run deploy:worker -- rekindle-moderate --dry-run
#
# Why: a plain `npx wrangler deploy` uses whichever Cloudflare account the
# local OAuth login happens to belong to. On 2026-11-24 that silently deployed
# the moderation Worker to the main account instead of "ReKindle Social".
# account_id is now pinned in every wrangler.toml; this wrapper also refuses to
# run when the pinned account is unknown and reads the social token from its
# documented location instead of relying on the shell's login.
set -euo pipefail

worker="${1:-}"
if [ -z "$worker" ]; then
    echo "usage: scripts/deploy-worker.sh <worker-dir> [wrangler args]" >&2
    echo "example: scripts/deploy-worker.sh rekindle-moderate" >&2
    exit 2
fi
shift

root="$(cd "$(dirname "$0")/.." && pwd)"
cfg="$root/workers/$worker/wrangler.toml"
if [ ! -f "$cfg" ]; then
    echo "error: $cfg not found" >&2
    exit 2
fi

account="$(sed -n 's/^[[:space:]]*account_id[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$cfg" | head -1)"
social_account="8d69e380e0c4e0580c47f21d9757c71c"
main_account="264c1185a9930ff6d69502c0c9c6bfd7"

case "$account" in
    "$social_account")
        token_file="${CLOUDFLARE_SOCIAL_TOKEN_FILE:-$HOME/.cloudflare-social-token}"
        if [ ! -r "$token_file" ]; then
            echo "error: missing $token_file (the ReKindle Social API token)" >&2
            exit 2
        fi
        export CLOUDFLARE_API_TOKEN="$(cat "$token_file")"
        ;;
    "$main_account")
        # Main-account Workers use the normal wrangler login (or CI token).
        ;;
    *)
        echo "error: $worker has no known pinned account_id in $cfg" >&2
        exit 2
        ;;
esac

# The TOML pin must win over any stale shell variable.
unset CLOUDFLARE_ACCOUNT_ID

cd "$root/workers/$worker"
exec npx wrangler deploy "$@"
