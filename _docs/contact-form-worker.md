# Contact form Worker (forms.gt-apps.co.uk)

Decided 31 Oct 2026 (Gaz): option A in `contact-form-options.md`. The form on
the home page posts to a Cloudflare Worker, which checks it and sends one email
through Microsoft Graph as a send-only mailbox. If anything fails, the form
offers the visitor their own email app (mailto) instead.

## Status (31 Oct 2026)

| Part | State |
|---|---|
| Worker `gt-apps-forms` on `https://forms.gt-apps.co.uk` | **deployed**, live checks pass (below) |
| Turnstile widget (managed, gt-apps.co.uk + www) | **created**; secret on the Worker and in 1Password |
| Graph sender (Entra app, Exchange scoping, client secret) | **waiting for Gaz**: `contact-form-m365-setup.md` |
| Site form wired to the Worker | **done on branch `contact-worker`, not published** |
| End-to-end test (real Turnstile, real Graph send) | to do after the Graph step |

Until the Graph secrets are set the Worker answers `503 not_configured` after
the Turnstile check, and `/health` shows `"mail": false`.

## How it works

`POST https://forms.gt-apps.co.uk/contact`, JSON:
`{ name, email, topic, message, website, turnstile }`.

In order, the Worker:

1. Allows only the site's origins (`ALLOWED_ORIGINS`; CORS preflight too).
   Anything else: 403. Only `POST` with `Content-Type: application/json`.
2. Rate limit per visitor IP: 3 a minute (Workers rate-limit binding; it counts
   per Cloudflare location and is approximate, so a 4th or 5th may get through).
   Over: 429.
3. Body at most 16 KB (413), valid JSON (400).
4. Honeypot `website` filled: answers 200 and sends nothing.
5. Validates: name 1 to 100 characters (made one line), email at most 200 and
   well formed, topic one of `General enquiry`, `Business or press`,
   `App support`, message 10 to 4,000 characters. Failures: 422 with the fields.
6. Turnstile `siteverify` with the visitor's IP; the token must be for one of
   `TURNSTILE_HOSTNAMES` and action `contact`. Failure: 403.
7. Sends with Graph `POST /users/forms@gt-apps.co.uk/sendMail` (app-only token,
   cached): to **support@** for `App support`, otherwise **enquiries@**
   (`SUPPORT_TO`, `ENQUIRIES_TO`; the visitor can't choose an address),
   Reply-To the visitor, subject `[gt-apps.co.uk] <topic> from <name>`, plain
   text, not saved to Sent Items. Graph failure: 502.

Nothing is stored. Workers observability (logs) is off; the only `console.log`
lines are the reason for a Turnstile or send failure, with no message content.

The page (`assets/js/contact.js`) loads Turnstile only when the visitor first
touches the form, waits up to 15 s for its token, then posts. On no token, a
blocked script, a network error or any non-200 answer it shows the reason and a
**Send it with your email app instead** button (mailto to the same address the
Worker would use). Emptying `data-endpoint` in `index.html` turns the form back
into mailto only.

## Where things are

| What | Where |
|---|---|
| Worker code, tests, config | `_worker/` (`src/index.js`, `test/`, `wrangler.toml`) |
| Cloudflare account / zone | GT-Apps, account `63fa8644513f5df90ba0a30df1de92cc`, zone `96601a8a1ca035fad7d6a364f0003283` |
| DNS | `forms.gt-apps.co.uk` is a Worker custom domain (Cloudflare made the record; proxied). The site's own A/AAAA/www records stay DNS-only on GitHub Pages; mail DNS untouched. |
| Turnstile site key (public) | `0x4AAAAAAFuPnLl-wGleRh63` (in `index.html`) |
| Cloudflare API token | 1Password GT-Apps, "Cloudflare API token (Calder)", `credential` |
| Turnstile secret | 1Password GT-Apps, "Cloudflare Turnstile: gt-apps.co.uk contact form", `credential`; Worker secret `TURNSTILE_SECRET` |
| Graph app credentials | 1Password GT-Apps, "Microsoft Graph sender for website contact form": `Tenant ID`, `Client ID`, `credential` (client secret); labels matched case-insensitively in any section; read with the desktop sign-in, not the service account; Worker secrets `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` |
| M365 tenant | `gtappsltd.onmicrosoft.com`, tenant ID `46fe1449-f713-404c-b0bc-50d7d14677f6` |
| Sender | shared mailbox `forms@gt-apps.co.uk` ("GT-Apps Website"), no licence, send-only |
| Recipients | `support@` and `enquiries@` (aliases on gareth.taylor@) |

## Test, deploy, secrets

From the repo root (needs Node 20+, and `op` signed in to the GT-Apps vault):

```bash
cd _worker && npm install            # once (wrangler, MIT OR Apache-2.0)
node --test test/*.test.js           # 15 unit tests, no network
export CLOUDFLARE_API_TOKEN="$(op read 'op://GT-Apps/nvo3bpjebfaynf2pl5mbjfpjoa/credential')"
npx wrangler deploy                  # deploys gt-apps-forms + the forms. custom domain
bash set-graph-secrets.sh            # Graph values from 1Password into Worker secrets
op read 'op://GT-Apps/ljv6uad23wgcic6thxarptonpe/credential' | npx wrangler secret put TURNSTILE_SECRET
```

Live checks without sending anything (expected answers in brackets):

```bash
U=https://forms.gt-apps.co.uk; O='Origin: https://gt-apps.co.uk'; J='Content-Type: application/json'
curl -s $U/health                                                       # {"ok":true,"mail":true}
curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS -H "$O" $U/contact  # 204
curl -s -X POST -H 'Origin: https://evil.example' -H "$J" -d '{}' $U/contact  # 403 origin
curl -s -X POST -H "$O" -H "$J" -d '{"website":"x"}' $U/contact        # 200, nothing sent
curl -s -X POST -H "$O" -H "$J" -d '{"name":"T","email":"t@example.com","topic":"General enquiry","message":"A test message.","turnstile":"fake"}' $U/contact  # 403 turnstile
```

Checked on 31 Oct 2026: all of these, plus 405 for GET, 415 for text/plain,
400 bad JSON, 422 bad fields, 413 for a 20 KB body, 429 from about the 4th
quick POST, and `localhost` refused once the test window was closed.

## End-to-end test (before publishing any form change)

Turnstile refuses automated browsers (by design), so a person presses Send.

1. `bash _worker/e2e-local.sh open` (adds `localhost` to the widget and the
   Worker's allowed origins and hostnames).
2. On branch `contact-worker`: `python -m http.server 8000` in the repo root.
3. In an ordinary browser open `http://localhost:8000/#contact`, send one
   **App support** and one **General enquiry** message, from an outside address
   (e.g. Gmail) so Reply-To can be checked.
4. Expect "Thank you. Your message has been sent…", the first in support@, the
   second in enquiries@, from "GT-Apps Website <forms@gt-apps.co.uk>", subject
   `[gt-apps.co.uk] …`, and Reply going to the sender's address. Check headers
   for `dmarc=pass` (DMARC is `p=reject`).
5. `bash _worker/e2e-local.sh close`, then confirm
   `curl -s -o /dev/null -w '%{http_code}' -X OPTIONS -H 'Origin: http://localhost:8000' https://forms.gt-apps.co.uk/contact`
   gives 403.
6. Merge `contact-worker` into `main`, push, and send one more from
   https://gt-apps.co.uk/#contact.

## Upkeep

- **Client secret rotation:** before the `expires` date in the 1Password item,
  add a new secret on the Entra app (Certificates & secrets), put its value in
  the item's `credential` and the new date in `expires`, run
  `bash _worker/set-graph-secrets.sh`, send a test, then delete the old secret
  in Entra.
- **Switch the form off quickly:** empty `data-endpoint` in `index.html` and
  push (mailto only), or `npx wrangler delete` the Worker (the page falls back
  to mailto by itself).
- **Spam getting through:** lower the rate limit in `wrangler.toml` and
  redeploy; Turnstile's own settings are in the Cloudflare dashboard under
  Turnstile → "gt-apps.co.uk contact form".
