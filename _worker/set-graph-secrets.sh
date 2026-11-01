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
EXPECTED_TENANT="46fe1449-f713-404c-b0bc-50d7d14677f6"   # GT Apps (gt-apps.co.uk)
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

for label in "tenant id" "client id" "credential"; do
  [[ -n "$(field "$label")" ]] || { echo "!! '$label' is empty or missing in 1Password item '$ITEM'" >&2; exit 1; }
done

# Check before writing anything: on 31 Oct 2026 the item's Tenant ID held the client id, the Worker could get no
# token, and every send answered 502. The tenant must be GT Apps', and a real token must come back. Asking for a
# token sends no mail; the secret stays in this process and is never printed.
GUID='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
tenant="$(field "tenant id")"; client="$(field "client id")"
[[ "$tenant" =~ $GUID && "$client" =~ $GUID ]] || { echo "!! tenant id and client id must both be GUIDs" >&2; exit 1; }
if [[ "${tenant,,}" != "$EXPECTED_TENANT" ]]; then
  echo "!! 'Tenant ID' in 1Password is $tenant, but GT Apps' tenant is $EXPECTED_TENANT." >&2
  [[ "${tenant,,}" == "${client,,}" ]] && echo "   (it holds the client id by mistake)" >&2
  echo "   Fix the item, then run this again:" >&2
  echo "   op item edit \"$ITEM\" --vault $VAULT \"Tenant ID=$EXPECTED_TENANT\"" >&2
  exit 1
fi
ITEM_JSON="$ITEM_JSON" node -e '
  const f = (JSON.parse(process.env.ITEM_JSON).fields || []);
  const get = (l) => { const x = f.find(x => (x.label || "").trim().toLowerCase() === l && x.value); return x ? String(x.value).trim() : ""; };
  const body = new URLSearchParams({ client_id: get("client id"), client_secret: get("credential"),
    scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" });
  fetch("https://login.microsoftonline.com/" + encodeURIComponent(get("tenant id")) + "/oauth2/v2.0/token", { method: "POST", body })
    .then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.access_token) { console.log("Graph token: ok (no mail sent)"); return; }
      console.error("!! Graph token refused: " + r.status + " " + (j.error || "") + " " + String(j.error_description || "").split(String.fromCharCode(10))[0].slice(0, 200));
      console.error("   Check the client id and that credential is the secret Value (not its Secret ID), and that it has not expired.");
      process.exit(1);
    })
    .catch((e) => { console.error("!! could not reach Microsoft sign-in: " + e.message); process.exit(1); });'

for pair in "GRAPH_TENANT_ID:tenant id" "GRAPH_CLIENT_ID:client id" "GRAPH_CLIENT_SECRET:credential"; do
  name="${pair%%:*}"; label="${pair#*:}"
  printf '%s' "$(field "$label")" | npx wrangler secret put "$name" >/dev/null
  echo "set $name"
done
unset ITEM_JSON
curl -s https://forms.gt-apps.co.uk/health; echo "   (expect \"mail\":true)"
