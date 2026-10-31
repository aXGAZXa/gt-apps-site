#!/usr/bin/env bash
# Copy the Graph sender credentials from 1Password (GT-Apps vault) into the
# Worker's encrypted secrets. Values go straight from op to wrangler on stdin;
# nothing is printed or written to disk. Run after creating or rotating the
# client secret. See ../_docs/contact-form-worker.md.
# Usage: bash _worker/set-graph-secrets.sh
set -euo pipefail
cd "$(dirname "$0")"
ITEM="Microsoft Graph sender for website contact form"
VAULT="GT-Apps"
export CLOUDFLARE_API_TOKEN="$(op read "op://GT-Apps/nvo3bpjebfaynf2pl5mbjfpjoa/credential")"
export WRANGLER_SEND_METRICS=false

field() { op item get "$ITEM" --vault "$VAULT" --fields "label=$1" --reveal; }

for pair in "GRAPH_TENANT_ID:tenant id" "GRAPH_CLIENT_ID:client id" "GRAPH_CLIENT_SECRET:credential"; do
  name="${pair%%:*}"; label="${pair#*:}"
  value="$(field "$label")"
  [[ -n "$value" ]] || { echo "!! '$label' is empty in 1Password item '$ITEM'" >&2; exit 1; }
  printf '%s' "$value" | npx wrangler secret put "$name" >/dev/null
  echo "set $name"
done
curl -s https://forms.gt-apps.co.uk/health; echo "   (expect \"mail\":true)"
