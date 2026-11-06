#!/usr/bin/env bash
# Frontend on Cloudflare Pages: static Vite build + the tender.js widget, SPA routing, API URL baked in.
# Needs: CLOUDFLARE_API_TOKEN (Pages:Edit) and CLOUDFLARE_ACCOUNT_ID in the environment, and the API's
# public URL (from deploy-aws.sh) in VITE_API_URL.
#   VITE_API_URL=https://xxx.awsapprunner.com bash scripts/deploy-cloudflare.sh   -> prints the pages.dev URL
set -euo pipefail
cd "$(dirname "$0")/.."
: "${VITE_API_URL:?set VITE_API_URL to the Tender API's https URL (any placeholder before the backend is up: the landing page works without it)}"
PROJECT=${CF_PAGES_PROJECT:-tender}

(cd app && VITE_API_URL="$VITE_API_URL" npx vite build)
# SPA fallback. The API is called directly at VITE_API_URL (the server sends CORS headers); Pages can't proxy
# to another domain.
printf '/*  /index.html  200\n' > app/dist/_redirects

npx --yes wrangler@4 pages project list 2>/dev/null | grep -q "^│ $PROJECT " || npx --yes wrangler@4 pages project create "$PROJECT" --production-branch main >/dev/null
npx --yes wrangler@4 pages deploy app/dist --project-name "$PROJECT" --branch main --commit-dirty=true 2>&1 | grep -E "https://" | tail -1
