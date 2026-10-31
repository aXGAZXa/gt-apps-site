#!/usr/bin/env bash
# Copy the Graph sender credentials from 1Password (GT-Apps vault) into the
# Worker's encrypted secrets. Values go straight from op to wrangler on stdin;
# nothing is printed or written to disk. Run after creating or rotating the
# client secret. See ../_docs/contact-form-worker.md.
# Usage: bash _worker/set-graph-secrets.sh
#
# Uses the 1Password desktop sign-in (the GT-Apps vault is not shared with the
# service account), so OP_SERVICE_ACCOUNT_TOKEN is ignored here. Field labels
# are matched case-insensitively in any section ("Client ID", "client id" ...).
set -euo pipefail
cd "$(dirname "$0")"
unset OP_SERVICE_ACCOUNT_TOKEN
ITEM="Microsoft Graph sender for website contact form"
VAULT="GT-Apps"
export CLOUDFLARE_API_TOKEN="$(op read "op://GT-Apps/nvo3bpjebfaynf2pl5mbjfpjoa/credential")"
export WRANGLER_SEND_METRICS=false

ITEM_JSON="$(op item get "$ITEM" --vault "$VAULT" --format json --reveal)"

# field <label>: first non-empty field whose label matches, ignoring case,
# surrounding spaces and which section it sits in.
field() {
  ITEM_JSON="$ITEM_JSON" node -e '
    const want = process.argv[1].trim().toLowerCase();
    const f = (JSON.parse(process.env.ITEM_JSON).fields || [])
      .find(f => (f.label || "").trim().toLowerCase() === want && f.value);
    process.stdout.write(f ? String(f.value).trim() : "");' "$1"
}

for pair in "GRAPH_TENANT_ID:tenant id" "GRAPH_CLIENT_ID:client id" "GRAPH_CLIENT_SECRET:credential"; do
  name="${pair%%:*}"; label="${pair#*:}"
  value="$(field "$label")"
  [[ -n "$value" ]] || { echo "!! '$label' is empty or missing in 1Password item '$ITEM'" >&2; exit 1; }
  printf '%s' "$value" | npx wrangler secret put "$name" >/dev/null
  echo "set $name"
done
unset ITEM_JSON
curl -s https://forms.gt-apps.co.uk/health; echo "   (expect \"mail\":true)"
