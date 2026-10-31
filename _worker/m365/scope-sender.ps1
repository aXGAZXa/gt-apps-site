# Limit the contact-form app to sending as forms@gt-apps.co.uk only
# (Exchange Online "RBAC for Applications"). Run once, in Windows PowerShell,
# after the Entra app registration exists. A Microsoft sign-in window opens:
# sign in as gareth.taylor@gt-apps.co.uk (Exchange admin).
#
#   powershell -ExecutionPolicy Bypass -File _worker\m365\scope-sender.ps1 `
#     -AppId <Application (client) ID> -ServicePrincipalId <Enterprise application Object ID>
#
# ServicePrincipalId is the Object ID on the *Enterprise applications* page for
# the app, not the Object ID on the App registrations page.
# Safe to re-run: it skips anything already in place.
param(
  [Parameter(Mandatory = $true)][string]$AppId,
  [Parameter(Mandatory = $true)][string]$ServicePrincipalId,
  [string]$Sender = "forms@gt-apps.co.uk",
  [string]$Admin = "gareth.taylor@gt-apps.co.uk",
  [string]$DisplayName = "GT-Apps website contact form",
  [string]$ScopeName = "GT-Apps website sender only"
)
$ErrorActionPreference = "Stop"
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -UserPrincipalName $Admin -ShowBanner:$false

try {
  if (-not (Get-ServicePrincipal -Identity $AppId -ErrorAction SilentlyContinue)) {
    New-ServicePrincipal -AppId $AppId -ObjectId $ServicePrincipalId -DisplayName $DisplayName | Out-Null
    Write-Host "Created the Exchange service principal for $DisplayName."
  } else { Write-Host "Service principal already there." }

  if (-not (Get-ManagementScope -Identity $ScopeName -ErrorAction SilentlyContinue)) {
    New-ManagementScope -Name $ScopeName -RecipientRestrictionFilter "PrimarySmtpAddress -eq '$Sender'" | Out-Null
    Write-Host "Created scope '$ScopeName' (only $Sender)."
  } else { Write-Host "Scope already there." }

  $existing = Get-ManagementRoleAssignment -RoleAssignee $AppId -Role "Application Mail.Send" -ErrorAction SilentlyContinue
  if (-not $existing) {
    New-ManagementRoleAssignment -App $AppId -Role "Application Mail.Send" -CustomResourceScope $ScopeName | Out-Null
    Write-Host "Assigned 'Application Mail.Send' limited to that scope."
  } else { Write-Host "Role assignment already there." }

  Write-Host ""
  Write-Host "Check (it can take up to 30 minutes for Graph to honour a new assignment):"
  $in = Test-ServicePrincipalAuthorization -Identity $AppId -Resource $Sender
  $out = Test-ServicePrincipalAuthorization -Identity $AppId -Resource $Admin
  Write-Host ("  {0}: InScope = {1}   (expect True)" -f $Sender, (($in | Where-Object RoleName -eq "Application Mail.Send").InScope))
  Write-Host ("  {0}: InScope = {1}   (expect False)" -f $Admin, (($out | Where-Object RoleName -eq "Application Mail.Send").InScope))
}
finally {
  Disconnect-ExchangeOnline -Confirm:$false
}
