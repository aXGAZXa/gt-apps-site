# Limit the contact-form app to sending as forms@gt-apps.co.uk only.
# Run in Windows PowerShell from the gt-apps-site folder. One Microsoft sign-in
# window opens: sign in as gareth.taylor@gt-apps.co.uk. Safe to re-run: every
# step checks first and skips what is already in place.
#
# Route 1 (default, Microsoft's current way): Exchange "RBAC for Applications".
#   No Graph permission in Entra. The app gets the Exchange role
#   "Application Mail.Send", limited to a management scope matching only forms@.
#
#     powershell -ExecutionPolicy Bypass -File _worker\m365\scope-sender.ps1
#
#   If Exchange refuses the role assignment ("You must be assigned a delegating
#   role assignment ..."), the script says why. Add -FixDelegation and it puts
#   the admin account straight into the Organization Management role group (and
#   gives that group the delegating assignment if it lacks it), then tries again.
#
# Route 2 (fallback, legacy): -Route AccessPolicy. Graph Mail.Send application
#   permission with admin consent (granted in Entra afterwards, by hand), held
#   to forms@ by an Application Access Policy on a mail-enabled security group
#   whose only member is forms@. The policy is created before the consent, so
#   there is never a moment when the app can send as anyone.
#
# See ../../_docs/contact-form-m365-setup.md.
param(
  [ValidateSet("Rbac", "AccessPolicy")][string]$Route = "Rbac",
  [switch]$FixDelegation,
  [string]$AppId = "27736171-af60-4d0a-9931-b020ad0cbb80",
  [string]$ServicePrincipalId = "2696e8fe-5e78-47d1-99f0-ef94a259a313",
  [string]$Sender = "forms@gt-apps.co.uk",
  [string]$Admin = "gareth.taylor@gt-apps.co.uk",
  [string]$DisplayName = "GT-Apps website contact form",
  [string]$ScopeName = "GT-Apps website sender only",
  [string]$GroupAddress = "website-sender-scope@gt-apps.co.uk",
  [string]$GroupName = "GT-Apps website sender scope"
)
$ErrorActionPreference = "Stop"
$Role = "Application Mail.Send"
$OrgManagement = "Organization Management"

function Say([string]$text) { Write-Host $text }
function Step([string]$text) { Write-Host ""; Write-Host "== $text" -ForegroundColor Cyan }
function NextStep([string]$text) { Write-Host ""; Write-Host "NEXT: $text" -ForegroundColor Yellow }
function IsDelegationRefusal($err) { "$err" -match "delegating role assignment|don't have access to create, change, or remove" }

function Ensure-ServicePrincipal {
  if (Get-ServicePrincipal -Identity $AppId -ErrorAction SilentlyContinue) { Say "Exchange service principal: already there." ; return }
  New-ServicePrincipal -AppId $AppId -ObjectId $ServicePrincipalId -DisplayName $DisplayName | Out-Null
  Say "Exchange service principal: created for $DisplayName."
}

function Ensure-Scope {
  $scope = Get-ManagementScope -Identity $ScopeName -ErrorAction SilentlyContinue
  if ($scope) { Say "Scope '$ScopeName': already there ($($scope.RecipientFilter))."; return }
  New-ManagementScope -Name $ScopeName -RecipientRestrictionFilter "PrimarySmtpAddress -eq '$Sender'" | Out-Null
  Say "Scope '$ScopeName': created (only $Sender)."
}

function Get-AppAssignment {
  Get-ManagementRoleAssignment -Role $Role -ErrorAction SilentlyContinue |
    Where-Object { $_.RoleAssigneeType -eq "ServicePrincipal" -and ("$($_.RoleAssignee)" -match $ServicePrincipalId -or "$($_.RoleAssigneeName)" -match $ServicePrincipalId -or "$($_.Name)" -match $ServicePrincipalId) }
}

# Why Exchange refuses: it lets you assign a role only if you hold a *delegating*
# assignment of it with no scope. Microsoft gives Organization Management the
# delegating assignments for the application roles; a Global Administrator
# reaches that group only indirectly (through a hidden TenantAdmins_ group), and
# the check can miss that. Prints what is there and returns what is missing.
function Show-Delegation {
  Step "Why Exchange refused: who may hand out '$Role'"
  $delegating = @(Get-ManagementRoleAssignment -Role $Role -Delegating $true -ErrorAction SilentlyContinue)
  if ($delegating.Count -eq 0) { Say "  Delegating assignments of '$Role': NONE in this organisation." }
  foreach ($d in $delegating) {
    Say ("  Delegating assignment: {0} -> {1} (scope: {2})" -f $d.Role, $d.RoleAssigneeName, $d.RecipientWriteScope)
  }
  $orgHasIt = [bool]($delegating | Where-Object { $_.RoleAssigneeName -eq $OrgManagement })

  $me = Get-User -Identity $Admin
  $members = @(Get-RoleGroupMember -Identity $OrgManagement -ResultSize Unlimited)
  Say "  '$OrgManagement' direct members: $((@($members | ForEach-Object { $_.Name }) -join ', '))"
  $iAmDirect = [bool]($members | Where-Object { $_.Name -eq $me.Name -or "$($_.PrimarySmtpAddress)" -eq $Admin })
  Say "  $Admin a direct member: $iAmDirect"
  [pscustomobject]@{ OrgHasDelegating = $orgHasIt; AdminIsDirectMember = $iAmDirect }
}

function Fix-Delegation($found) {
  Step "Fixing delegation (-FixDelegation)"
  if (-not $found.AdminIsDirectMember) {
    Add-RoleGroupMember -Identity $OrgManagement -Member $Admin -BypassSecurityGroupManagerCheck
    Say "  Added $Admin to '$OrgManagement' directly."
  }
  if (-not $found.OrgHasDelegating) {
    try {
      New-ManagementRoleAssignment -Role $Role -SecurityGroup $OrgManagement -Delegating | Out-Null
      Say "  Gave '$OrgManagement' the delegating assignment of '$Role'."
    } catch {
      Say "  Could not add the delegating assignment to '$OrgManagement': $($_.Exception.Message)"
      Say "  (Exchange applies the same rule to this. If the organisation has no delegating assignment of the role at all, only Microsoft support can restore it.)"
    }
  }
}

function Try-Assign {
  New-ManagementRoleAssignment -App $ServicePrincipalId -Role $Role -CustomResourceScope $ScopeName | Out-Null
}

function Run-Rbac {
  Ensure-ServicePrincipal
  Ensure-Scope

  if (Get-AppAssignment) { Say "Role assignment '$Role' for the app: already there." }
  else {
    try { Try-Assign; Say "Role assignment: '$Role' for the app, limited to '$ScopeName'." }
    catch {
      if (-not (IsDelegationRefusal $_)) { throw }
      Say "Exchange refused the role assignment: $($_.Exception.Message)"
      $found = Show-Delegation
      if (-not $FixDelegation) {
        NextStep "run the same command again with -FixDelegation. It adds $Admin directly to '$OrgManagement' and retries. If that still fails, use the fallback: -Route AccessPolicy."
        return $false
      }
      Fix-Delegation $found
      # Exchange may take a few minutes to see a new role group member.
      $done = $false
      foreach ($wait in 0, 60, 120, 180) {
        if ($wait) { Say "  Waiting $wait seconds for Exchange to pick up the change..."; Start-Sleep -Seconds $wait }
        try { Try-Assign; $done = $true; break }
        catch { if (-not (IsDelegationRefusal $_)) { throw }; Say "  Still refused." }
      }
      if (-not $done) {
        NextStep "close PowerShell, wait 30 minutes and run the same command (with -FixDelegation) again: Exchange can be slow to see the new membership. If it is still refused after that, use the fallback: -Route AccessPolicy."
        return $false
      }
      Say "Role assignment: '$Role' for the app, limited to '$ScopeName'."
    }
  }

  Step "Check (Test-ServicePrincipalAuthorization bypasses Exchange's cache; real sends can take 30 min to 2 h)"
  $in = Test-ServicePrincipalAuthorization -Identity $ServicePrincipalId -Resource $Sender | Where-Object RoleName -eq $Role
  $out = Test-ServicePrincipalAuthorization -Identity $ServicePrincipalId -Resource $Admin | Where-Object RoleName -eq $Role
  Say ("  {0}: InScope = {1}   (expect True)" -f $Sender, $in.InScope)
  Say ("  {0}: InScope = {1}   (expect False)" -f $Admin, $out.InScope)
  if ("$($in.InScope)" -eq "True" -and "$($out.InScope)" -ne "True") {
    NextStep "done. Tell Calder: the Graph secrets can go on the Worker. Do NOT grant Mail.Send consent in Entra on this route."
    return $true
  }
  NextStep "the check is not as expected; send this output to Calder."
  return $false
}

function Run-AccessPolicy {
  Step "Fallback: Application Access Policy (legacy; Microsoft now recommends RBAC for Applications)"
  $group = Get-DistributionGroup -Identity $GroupAddress -ErrorAction SilentlyContinue
  if (-not $group) {
    $group = New-DistributionGroup -Name $GroupName -Alias ($GroupAddress.Split("@")[0]) -PrimarySmtpAddress $GroupAddress -Type Security -Members $Sender
    Say "Mail-enabled security group $GroupAddress created, with $Sender as its only member."
  } else { Say "Group $GroupAddress already there." }
  Set-DistributionGroup -Identity $GroupAddress -HiddenFromAddressListsEnabled $true -RequireSenderAuthenticationEnabled $true
  $members = @(Get-DistributionGroupMember -Identity $GroupAddress -ResultSize Unlimited)
  if (-not ($members | Where-Object { "$($_.PrimarySmtpAddress)" -eq $Sender })) { Add-DistributionGroupMember -Identity $GroupAddress -Member $Sender; Say "Added $Sender to the group." }
  $others = @($members | Where-Object { "$($_.PrimarySmtpAddress)" -ne $Sender })
  if ($others.Count) { Say ("WARNING: the group has other members, who the app could also send as: {0}" -f (($others | ForEach-Object { $_.PrimarySmtpAddress }) -join ", ")) }

  $policy = Get-ApplicationAccessPolicy -ErrorAction SilentlyContinue | Where-Object { $_.AppId -eq $AppId }
  if ($policy) { Say "Application access policy for the app: already there ($($policy.AccessRight) on $($policy.ScopeName))." }
  else {
    New-ApplicationAccessPolicy -AppId $AppId -PolicyScopeGroupId $GroupAddress -AccessRight RestrictAccess -Description "GT-Apps website contact form: send only as $Sender" | Out-Null
    Say "Application access policy: RestrictAccess to $GroupAddress."
  }

  Step "Check"
  $in = Test-ApplicationAccessPolicy -Identity $Sender -AppId $AppId
  $out = Test-ApplicationAccessPolicy -Identity $Admin -AppId $AppId
  Say ("  {0}: {1}   (expect Granted)" -f $Sender, $in.AccessCheckResult)
  Say ("  {0}: {1}   (expect Denied)" -f $Admin, $out.AccessCheckResult)
  if ("$($in.AccessCheckResult)" -eq "Granted" -and "$($out.AccessCheckResult)" -eq "Denied") {
    NextStep "only now, in Entra: App registrations > $DisplayName > API permissions > Add a permission > Microsoft Graph > Application permissions > Mail.Send > Add, then 'Grant admin consent for GT Apps'. Then tell Calder (the policy can take up to an hour to apply to real sends)."
    return $true
  }
  NextStep "the check is not as expected; do NOT grant Mail.Send consent. Send this output to Calder."
  return $false
}

Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -UserPrincipalName $Admin -ShowBanner:$false
try {
  if ($Route -eq "Rbac") { $ok = Run-Rbac } else { $ok = Run-AccessPolicy }
}
finally {
  Disconnect-ExchangeOnline -Confirm:$false
}
if (-not $ok) { exit 1 }
