# gt-apps.co.uk

The GT-Apps studio website, a static site served by GitHub Pages from the
`main` branch of this repo (custom domain in `CNAME`, DNS on Cloudflare).
Plain HTML and CSS with one small script; no framework, no build step, no
tracking.

## Where each page comes from

| Path | Source of truth | Edit it in |
|---|---|---|
| `/` (`index.html`), `404.html`, `style.css`, `assets/`, `favicon.png`, `apple-touch-icon.png` | the studio site | **this repo** |
| `app-ads.txt` | the studio (ad networks read it from the developer's domain, for every app) | **this repo** |
| `CNAME` | GitHub Pages setting for gt-apps.co.uk | this repo (don't remove it) |
| `/who-goes-first/` | the Who Goes First? app | `games_night_spinner` repo, `site/who-goes-first/` |
| `/pulse/privacy/` | Pulse's privacy policy, `F:\Pulse\docs\legal\privacy-policy.md` | **the Pulse repo**, then rebuild here (below) |

Each app owns its own folder of pages (overview, privacy policy, support), kept
next to its code so a release and its policy change together. Nothing is
duplicated: an app's folder is self-contained (its own stylesheet and icons) and
links back to the studio home with `../`. The studio never edits an app's
folder here; it is a copy.

The list of apps and where their pages live is `_tools/apps.txt`. Folders
starting with `_` (`_tools/`, `_docs/`) are not published by GitHub Pages.
`_docs/` holds notes about the site: the contact form options and URL checks.

## Updating an app's pages

1. Edit and commit the pages in the app's repo (`site/<app>/`).
2. Here, run `bash _tools/sync-apps.sh` (every app, from each repo's current
   commit) or `bash _tools/sync-apps.sh who-goes-first=<branch or commit>`.
   It copies committed files only and never deletes; if the app has dropped a
   file, it lists it for you to remove by hand.
3. Check `git diff`, commit naming the source commit the script printed, push.

## Adding an app

Give it a `site/<slug>/` folder in its own repo, add a line to
`_tools/apps.txt`, sync, and add a card for it to the Apps section of
`index.html`.

## URLs that must keep working

The store listings and ad networks link to these, so never move or rename them:

- `/app-ads.txt`
- `/who-goes-first/`, `/who-goes-first/index.html`
- `/who-goes-first/privacy.html` (also built into the app as its privacy URL)
- `/who-goes-first/support.html`
- `/pulse/privacy/` (and `/pulse/privacy`, which redirects to it): Pulse's
  privacy URL in the app, App Store Connect and the Play Console
- `/favicon.png`, `/apple-touch-icon.png`, `/who-goes-first/icon.png`,
  `/who-goes-first/apple-touch-icon.png`

## Pulse privacy policy

`pulse/privacy/index.html` is generated, not hand-written. Pulse doesn't have
its own `site/` folder yet, so instead of `sync-apps.sh` it is built from the
policy's markdown:

    python _tools/build-pulse-privacy.py [path to privacy-policy.md]

It publishes only the public policy, from the second `# Pulse privacy policy`
heading to the first `# Appendix` heading; Appendices A to C (store answers,
internal issues) are never written out, and the script stops if it can't find
them. Placeholders in `[square brackets]` stay visibly marked, with a "Draft"
banner, until they are filled in the source; the script lists any that remain.
It also flags any gt-apps.com address: that domain belongs to another company.

Published as a marked draft on 1 Nov 2026 (Gaz's decision, option B): the
page is live with its placeholders showing and a "Draft: this policy is not
final" banner. It carries `<meta name="robots" content="noindex">`, and nothing
on the site links to it (not the home page, not the footer; the site has no
sitemap), so only the app's link reaches it. Keep it that way until Gaz says
otherwise.

To finalise: fill every placeholder in the policy (company number, registered
office, ICO number, privacy email, email provider, effective date), commit it in
the Pulse repo, rebuild here until the script reports no placeholders, check
the page, then commit and push `main`. Pushing `main` is what publishes.

## Contact form

The form on the home page validates in the browser, then posts to the GT-Apps
Worker at `https://forms.gt-apps.co.uk/contact` (code in `_worker/`) after a
Cloudflare Turnstile check; the Worker emails support@ (app support) or
enquiries@ (everything else) through Microsoft 365. If the Worker or Turnstile
fails, or `data-endpoint` is emptied, the form offers the visitor's own email
app (mailto) instead. How it works, deploys and is tested:
`_docs/contact-form-worker.md`.

## Brand

Colours, font and logo files are kept in the GT-Apps brand folder (its
README); the CSS custom properties at the top of `style.css` match it. The font is Montserrat (SIL Open Font License 1.1), self-hosted in
`assets/fonts/` with its licence.

## Preview locally

`python -m http.server 8000` in this folder, then open http://localhost:8000/.
