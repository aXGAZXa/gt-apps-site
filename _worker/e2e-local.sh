#!/usr/bin/env bash
# Temporarily let a local preview (http://localhost:8000) use the real Turnstile
# widget and the live Worker, for an end-to-end test before publishing a form
# change; then put both back. See ../_docs/contact-form-worker.md.
# Usage: bash _worker/e2e-local.sh open|close
# Needs: op (1Password CLI, GT-Apps vault), npm install done in _worker.
set -euo pipefail
cd "$(dirname "$0")"
ACCOUNT=63fa8644513f5df90ba0a30df1de92cc
SITEKEY=0x4AAAAAAFuPnLl-wGleRh63
export CLOUDFLARE_API_TOKEN="$(op read "op://GT-Apps/nvo3bpjebfaynf2pl5mbjfpjoa/credential")"
export WRANGLER_SEND_METRICS=false

widget() { # $1 = JSON array of domains
  curl -s -X PUT -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
    "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/challenges/widgets/$SITEKEY" \
    --data "{\"name\":\"gt-apps.co.uk contact form\",\"mode\":\"managed\",\"domains\":$1}" \
    | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));if(!j.success){console.error(JSON.stringify(j.errors));process.exit(1)}console.log("widget domains:",j.result.domains.join(", "))'
}

case "${1:-}" in
  open)
    widget '["gt-apps.co.uk","www.gt-apps.co.uk","localhost"]'
    npx wrangler deploy \
      --var "ALLOWED_ORIGINS:https://gt-apps.co.uk,https://www.gt-apps.co.uk,http://localhost:8000" \
      --var "TURNSTILE_HOSTNAMES:gt-apps.co.uk,www.gt-apps.co.uk,localhost" | grep -E "Version|rror" || true
    echo "Open. Serve the site: (cd .. && python -m http.server 8000), test at http://localhost:8000/#contact, then: bash _worker/e2e-local.sh close"
    ;;
  close)
    widget '["gt-apps.co.uk","www.gt-apps.co.uk"]'
    npx wrangler deploy | grep -E "Version|rror" || true
    echo "Closed: widget and Worker back to the live site only."
    ;;
  *) echo "usage: bash _worker/e2e-local.sh open|close" >&2; exit 2 ;;
esac
