#!/usr/bin/env bash
# Automated end-to-end tests on LOCAL copies of Unichain Sepolia and Whitechain Sepolia. Nothing touches
# the real testnets. Unichain: invoice -> ranking -> swap payment -> basket -> refund -> CSV.
# Whitechain: USDT invoice -> approve+pay -> permit (one-signature) pay -> refund -> CSV -> shop confirms.
#   bash scripts/e2e-fork.sh
set -euo pipefail
cd "$(dirname "$0")/.."
stop_forks() { for f in .fork/anvil.pid .fork/anvil-wc.pid; do [ -f $f ] && kill "$(cat $f)" 2>/dev/null; rm -f $f; done; }
trap stop_forks EXIT

bash scripts/fork-up.sh
set -a; source .env.fork; set +a
npx tsx e2e/fork.e2e.ts
npx tsx e2e/whitechain.e2e.ts
