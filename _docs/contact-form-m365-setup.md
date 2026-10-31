# Contact form: the Microsoft 365 part (for Gaz, with Calder)

What this sets up: an Entra app that can send mail **only as
forms@gt-apps.co.uk**, and its client secret in 1Password. About 15 minutes.
Sign in everywhere as **gareth.taylor@gt-apps.co.uk**.

Already done: the shared mailbox `forms@gt-apps.co.uk` ("GT-Apps Website");
support@ and enquiries@ deliver to gareth.taylor@ (31 Oct 2026, Calder).

Why no Graph permission is ticked in Entra: Exchange's "RBAC for
Applications" grants `Mail.Send` scoped to the one mailbox. A tenant-wide
Mail.Send consent in Entra would *add* to that and let the app send as anyone,
so in step 1 we deliberately add no API permission and grant no admin consent
(the fallback in step 3 is the one exception, and it is held to forms@ by a policy).
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

Status 31 Oct 2026: the app is registered (client `27736171-af60-4d0a-9931-b020ad0cbb80`,
enterprise application `2696e8fe-5e78-47d1-99f0-ef94a259a313`); the Exchange service
principal and the scope `GT-Apps website sender only` exist. The role assignment was
refused at 18:31, about 35 minutes after `Enable-OrganizationCustomization`, with
"You must be assigned a delegating role assignment to the management role ... without a
scope restriction".

**Why (not propagation).** Exchange lets you hand out a role only if you hold a
*delegating* assignment of that role with no scope. Microsoft's docs say the delegating
assignments for the application roles sit on the **Organization Management** role group,
and "you need to be a member of the Organization Management role group to assign these
permissions". A Global Administrator is in that group only indirectly, through a hidden
`TenantAdmins_...` group, and in a new tenant that route can fail this check. The other
possible cause is that the new organisation has no delegating assignment of
`Application Mail.Send` at all. The script now reports which it is, and `-FixDelegation`
handles both: it adds gareth.taylor@ to Organization Management directly, and gives that
group the delegating assignment if it is missing.

The two IDs are now the script's defaults. In **Windows PowerShell**, in the
`gt-apps-site` folder (`C:\Users\gaz70\source\VSCode\gt-apps-site`). Sign in as
gareth.taylor@ when the window opens:

```powershell
cd C:\Users\gaz70\source\VSCode\gt-apps-site
powershell -ExecutionPolicy Bypass -File _worker\m365\scope-sender.ps1 -FixDelegation
```

That is one sign-in. The script skips what is done, explains a refusal, fixes the
delegation, retries for about 6 minutes, then checks. What you see at the end:

- **Done**: `forms@gt-apps.co.uk: InScope = True` and
  `gareth.taylor@gt-apps.co.uk: InScope = False`, then `NEXT: done`. Tell Calder.
  **Don't** add Mail.Send in Entra on this route.
- **Still refused**: `NEXT: close PowerShell, wait 30 minutes and run the same command
  again`. Exchange can be slow to see a new member of a role group. Run the same line once
  more after 30 minutes.
- **Refused after that too**: use the fallback (legacy, but it still works):

```powershell
powershell -ExecutionPolicy Bypass -File _worker\m365\scope-sender.ps1 -Route AccessPolicy
```

  It creates a hidden mail-enabled security group `website-sender-scope@gt-apps.co.uk`
  whose only member is forms@, and an Application Access Policy (`RestrictAccess`) for the
  app on that group. It then checks with `Test-ApplicationAccessPolicy`; expect forms@
  `Granted` and gareth.taylor@ `Denied`. **Only then**, in Entra: App registrations →
  GT-Apps website contact form → API permissions → Add a permission → Microsoft Graph →
  Application permissions → **Mail.Send** → Add → **Grant admin consent for GT Apps**.
  The policy is made before the consent, so at no point can the app send as anyone else.
  Microsoft calls these policies legacy and advises moving to RBAC for Applications later.
  The move would be: assign the role scoped to the group, remove the Entra consent, then
  remove the policy.

Then tell Calder. The agent runs `bash _worker/set-graph-secrets.sh`
(1Password → Worker secrets) and the end-to-end test, which needs one person to
press Send in a browser (see `contact-form-worker.md`). A new RBAC assignment can take
30 minutes to 2 hours to reach Graph; a policy can take up to an hour. So a first send
that fails with 403 just needs a wait.

Sources: [RBAC for Applications in Exchange Online](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac)
(Requirements; FAQ on Application Access Policies),
[New-ManagementRoleAssignment](https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/new-managementroleassignment?view=exchange-ps)
(`-Delegating`).

## If something goes wrong

- `New-ServicePrincipal` says the object ID is wrong: it must be the
  **Enterprise application** Object ID (step 1.5).
- `InScope = True` for gareth.taylor@ too (RBAC route): the app has a tenant-wide
  Mail.Send consent; in Entra → the app → API permissions, remove Mail.Send and revoke
  admin consent. (On the fallback route that consent is meant to be there; the policy
  holds it to forms@.)
- To undo everything: `Remove-ManagementRoleAssignment` for the app,
  `Remove-ManagementScope "GT-Apps website sender only"`,
  `Remove-ServicePrincipal <AppId>` (in Connect-ExchangeOnline), and delete the
  app registration in Entra. Fallback route: `Remove-ApplicationAccessPolicy` for the
  app, `Remove-DistributionGroup website-sender-scope@gt-apps.co.uk`, and revoke the
  Mail.Send consent. `-FixDelegation` added gareth.taylor@ to Organization Management
  directly; that can stay (he is Global Administrator anyway).
