# Contact form: how it should send (proposal, 31 Oct 2026)

Status: **decided 31 Oct 2026: option A** (Gaz), with the mailto fallback
kept. What was built and how to run it: `contact-form-worker.md`; the
Microsoft 365 steps: `contact-form-m365-setup.md`. The rest of this note is the
original proposal, kept as written.

What's built now: the form (name, email, subject, message, a hidden honeypot
field), validation in the browser, and a mailto fallback that works today. It
opens the visitor's own email app with the message ready, addressed to
enquiries@ (or support@ for "App support"). The form posts to an endpoint
instead as soon as `data-endpoint` is set on it in `index.html`; on any failure
it tells the visitor to email directly.

Constraints: the site is static on GitHub Pages; DNS is on Cloudflare; mail is
Microsoft 365 (MX on Microsoft, which stays as it is); no tracking.

## Options

### A. Cloudflare Worker + Turnstile, sending through Microsoft Graph (recommended)

A small Worker (about 80 lines) at `https://forms.gt-apps.co.uk/contact` checks
the Turnstile token and the honeypot, validates the fields, then calls Graph
`sendMail` as a dedicated sender (for example a free shared mailbox
`forms@gt-apps.co.uk`) to enquiries@ or support@, with **Reply-To set to the
visitor**, so a reply goes straight back to them.

- **Cost:** free. Workers' free tier (100,000 requests a day) and Turnstile are
  free; a shared mailbox needs no Microsoft 365 licence.
- **Privacy:** the message only passes through Cloudflare (already the DNS
  provider) and Microsoft (already the mail provider). No new company sees it,
  and nothing is stored: the Worker keeps no data and its logs can stay off.
  Turnstile is Cloudflare's privacy-friendly CAPTCHA (no cookies for tracking,
  usually invisible).
- **Security:** an Entra app registration with the `Mail.Send` application
  permission, **limited to the one sender mailbox** with an Exchange
  application access policy (or RBAC for Applications), so the secret can't send
  as anyone else. The client secret lives only as an encrypted Worker secret.
  It expires (24 months at most), so it needs a calendar reminder to rotate.
- **Effort:** about an hour to set up, plus the Worker code and a test; then
  little upkeep apart from secret rotation.
- **Site change:** set `data-endpoint`, add the Turnstile widget, and widen the
  page's Content-Security-Policy to `forms.gt-apps.co.uk` and
  `challenges.cloudflare.com`. Update the privacy note by the form to say the
  message goes through Cloudflare to our Microsoft 365 mailbox.
- **Why a subdomain:** the site's A records point straight at GitHub Pages
  (185.199.108-111.153, DNS only, checked 31 Oct 2026). A Worker route on
  `gt-apps.co.uk` itself would need those records proxied through Cloudflare,
  which can interfere with GitHub Pages issuing its own HTTPS certificate. A
  separate `forms.` custom domain for the Worker leaves the Pages records alone.

**Not SMTP AUTH.** Microsoft is retiring Basic authentication for SMTP AUTH in
Exchange Online during 2026, so a username and password sender would stop
working; OAuth SMTP from a Worker means raw TCP, STARTTLS and token handling,
which is more fragile than one Graph HTTPS call. **Not Cloudflare Email
Routing's send binding** either: it needs the domain's MX on Cloudflare, which
would take mail away from Microsoft 365.

What Gaz would need to do (or approve Calder doing): create the shared mailbox;
create the Entra app registration and grant `Mail.Send` (admin consent); add the
application access policy limiting it to that mailbox; create the Worker, its
secrets and the `forms` custom domain in Cloudflare; create a Turnstile widget
for gt-apps.co.uk.

### B. A hosted form service (Formspree, Web3Forms, Basin and similar)

The form posts to the service, which emails enquiries@.

- **Effort:** lowest: one account and one URL; no code to run.
- **Privacy:** a third party receives and usually **stores** every message, so
  it needs naming in the privacy note and a data processing agreement; some add
  their own CAPTCHA (reCAPTCHA or hCaptcha), which brings in third-party scripts
  and cookies.
- **Limits:** free plans are small (tens to a few hundred submissions a month,
  depending on the service and as of this writing), may brand the emails or
  confirmation pages, and can change their terms.
- **Control:** delivery depends on someone else's sender reputation; routing by
  subject (support@ versus enquiries@) is often a paid feature.

### C. mailto only (what works today)

- **Effort and cost:** none; no data passes through anyone.
- **Drawback:** it relies on the visitor having an email app set up. Many
  desktop users (webmail only) get nothing or an unfamiliar app opening, so some
  enquiries are lost. Long messages can be cut short (the form copies long ones
  to the clipboard and says so).

## Recommendation

**A**, keeping C as the automatic fallback if the Worker ever fails. It's free,
adds no new company to the data path, keeps the mail in Microsoft 365, and
spam is handled by Turnstile plus the honeypot. B is the quick alternative if
Gaz would rather not hold a Graph permission and secret.
