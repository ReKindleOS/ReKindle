#!/bin/bash
# Deploy current folder to Cloudflare Pages 'beta' branch
# Ensure 'wrangler' is installed and authenticated

echo "Deploying to Cloudflare Pages (Beta Preview)..."
npx wrangler pages deploy . --branch beta --project-name "$1"