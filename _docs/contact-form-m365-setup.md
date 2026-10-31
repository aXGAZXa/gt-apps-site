# Contact form: the Microsoft 365 part (for Gaz, with Calder)

What this sets up: an Entra app that can send mail **only as
forms@gt-apps.co.uk**, and its client secret in 1Password. About 15 minutes.
Sign in everywhere as **gareth.taylor@gt-apps.co.uk**.

Already done: the shared mailbox `forms@gt-apps.co.uk` ("GT-Apps Website");
support@ and enquiries@ deliver to gareth.taylor@ (31 Oct 2026, Calder).

Why no Graph permission is ticked in Entra: Exchange's "RBAC for
Applications" grants `Mail.Send` scoped to the one mailbox. A tenant-wide
Mail.Send consent in Entra would *add* to that and let the app send as anyone,
so in step 1 we deliberately add no API permission and grant no admin consent.
(This replaces the older "application access policy", which Microsoft now
treats as legacy.)

## 1. Register the app (browser, ~5 min)

1. Go to **https://entra.microsoft.com** and sign in.
2. Left menu: **Entra ID → App registrations** → **+ New registration**.
3. Name: `GT-Apps website contact form`.
   Supported account types: **Accounts in this organizational directory only
   (GT Apps only - Single tenant)**. Redirect URI: leave empty.
   Click **Register**.
4. On the app's **Overview**, copy:
   - **Application (client) ID** → call it *AppId*.
   - **Directory (tenant) ID** → should be `46fe1449-f713-404c-b0bc-50d7d14677f6`.
5. Same page, under Essentials: click the link **Managed application in local
   directory** (the app's name). On that *Enterprise application* Overview,
   copy **Object ID** → call it *ServicePrincipalId*.
   (Not the Object ID on the App registration page: that one is different.)
6. Back on the app registration: **API permissions**. If `User.Read` is listed,
   select **⋯ → Remove permission** (not needed). **Do not** add Mail.Send and
   **do not** click "Grant admin consent".
7. **Certificates & secrets → Client secrets → + New client secret**.
   Description: `Cloudflare Worker gt-apps-forms`. Expires: **730 days
   (24 months)**. Click **Add**.
8. Copy the secret's **Value** now (it's shown once; not the Secret ID).

## 2. Save it in 1Password (~2 min)

In the **GT-Apps** vault, new item, type **API Credential**, title exactly:

`Microsoft Graph sender for website contact form`

| Field label (exact) | Value |
|---|---|
| `credential` (the item's main secret field) | the secret **Value** from step 1.8 |
| `client id` (text) | *AppId* |
| `tenant id` (text) | `46fe1449-f713-404c-b0bc-50d7d14677f6` |
| `expires` (text or date) | today + 24 months, e.g. `2028-10-31` |
| notes | `Entra app "GT-Apps website contact form"; sends only as forms@ (Exchange RBAC for Applications). Used by Cloudflare Worker gt-apps-forms. Rotate before expiry: gt-apps-site _docs/contact-form-worker.md.` |

Also put a reminder in Gaz's calendar a month before the expiry date.

## 3. Limit it to forms@ (PowerShell, ~5 min)

On this PC (the ExchangeOnlineManagement module is installed), in Windows
PowerShell from the `gt-apps-site` folder:

```powershell
powershell -ExecutionPolicy Bypass -File _worker\m365\scope-sender.ps1 -AppId <AppId> -ServicePrincipalId <ServicePrincipalId>
```

A Microsoft sign-in window opens: sign in as gareth.taylor@. The script
creates the Exchange service principal, a scope matching only
`forms@gt-apps.co.uk`, and assigns the role **Application Mail.Send** within
that scope. It finishes with a check; expect:

```
  forms@gt-apps.co.uk: InScope = True   (expect True)
  gareth.taylor@gt-apps.co.uk: InScope = False   (expect False)
```

Stop here and tell Calder. The agent then runs `bash _worker/set-graph-secrets.sh`
(1Password → Worker secrets) and the end-to-end test, which needs one person to
press Send in a browser (see `contact-form-worker.md`). New assignments can take
up to 30 minutes before Graph accepts them, so a first send that fails with 403
just needs a short wait.

## If something goes wrong

- `New-ServicePrincipal` says the object ID is wrong: it must be the
  **Enterprise application** Object ID (step 1.5).
- `InScope = True` for gareth.taylor@ too: the app has a tenant-wide Mail.Send
  consent; in Entra → the app → API permissions, remove Mail.Send and revoke
  admin consent.
- To undo everything: `Remove-ManagementRoleAssignment` for the app,
  `Remove-ManagementScope "GT-Apps website sender only"`,
  `Remove-ServicePrincipal <AppId>` (in Connect-ExchangeOnline), and delete the
  app registration in Entra.
