#!/usr/bin/env bash
# Frontend on Cloudflare (Workers static assets, free): Vite build + the tender.js widget, SPA routing, API URL baked in.
# Needs: `npx wrangler login` once (or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID), and the API's
# public URL (from deploy-aws.sh) in VITE_API_URL.
#   VITE_API_URL=https://xxx.awsapprunner.com bash scripts/deploy-cloudflare.sh   -> prints the workers.dev URL
set -euo pipefail
cd "$(dirname "$0")/.."
[ -n "${VITE_API_URL:-}" ] || { echo "set VITE_API_URL to the API https URL (before the backend is up, any placeholder works: the landing page renders without it)"; exit 1; }

(cd app && VITE_API_URL="$VITE_API_URL" npx vite build)
# wrangler must run inside the app package (not the npm-workspace root); app/wrangler.jsonc serves dist/
# as static assets with SPA fallback. The API is called directly at VITE_API_URL (the server sends CORS).
cd app
npx --yes wrangler@4 deploy
