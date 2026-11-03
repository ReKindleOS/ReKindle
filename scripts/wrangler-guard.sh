#!/bin/sh
# Shell guard for hand-typed Cloudflare Pages deploys.
#
# Source this from your shell profile (zsh):
#   source "/Users/timothyarnott/Dropbox/Dropbox Sync/Documents/ReKindle/scripts/wrangler-guard.sh"
#
# It blocks `wrangler pages deploy .` / no-target deploys of the repo root,
# which is how service-account.json, service-account-social.json and
# firebase-functions/.env were published on 2026-10-19.
#
# Note: `npx wrangler ...` bypasses a shell function. Use `npm run deploy:prod`
# (which runs scripts/deploy-guard.js) or plain `wrangler` with this sourced.

wrangler() {
    if [ "$1" = "pages" ] && [ "$2" = "deploy" ]; then
        case "${3:-}" in
            ""|"."|"./"|"$(pwd)")
                echo "wrangler-guard: refusing to deploy the repo root — it contains .env and service-account*.json." >&2
                echo "Use: npm run deploy:prod   (builds and checks _deploy/main)" >&2
                return 1
                ;;
        esac
    fi
    command wrangler "$@"
}
