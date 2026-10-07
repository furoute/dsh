<#
.SYNOPSIS
  Install the DeepSeek Billing Dock (dsh-billing) into another DSH installation.

.DESCRIPTION
  Copies the @deepseek-ai/dsh-billing package into the target DSH's node_modules
  and wires the web profile so the '充值余额 / 今日消费' readout loads on every DSH
  restart. Run this from the dsh-billing-deploy folder on the target machine.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install.ps1 -DshRoot "<USERPROFILE>\...\work\dsh"

  # after install, also set the DeepSeek platform login token:
  powershell -ExecutionPolicy Bypass -File install.ps1 -DshRoot "..." -Token "YOUR_BEARER_TOKEN"
#>
param(
    # Root of the DSH checkout that contains node_modules\@deepseek-ai\dsh-billing
    [string]$DshRoot,
    # Path to the DSH user config home (defaults to <USERPROFILE>\.dsh)
    [string]$ProfileRoot,
    # Optional DeepSeek platform login bearer token (Authorization: Bearer <token>)
    [string]$Token,
    # Skip token prompt (for scripting)
    [switch]$NoPrompt
)

$ErrorActionPreference = "Stop"

# --- locate DSH root --------------------------------------------------------
if (-not $DshRoot) {
    # hint: the shipped DSH install typically has node_modules under the checked-out tree
    $DshRoot = Read-Host "Path to DSH checkout root (the folder containing node_modules @deepseek-ai)"
}
if (-not (Test-Path (Join-Path $DshRoot "node_modules\@deepseek-ai"))) {
    Write-Error "Could not find node_modules\@deepseek-ai under: $DshRoot"
    exit 1
}

# --- locate profile root ----------------------------------------------------
if (-not $ProfileRoot) {
    $ProfileRoot = Join-Path $HOME ".dsh"
}
$webProfile = Join-Path $ProfileRoot "profiles\web"
$pkgDest = Join-Path $DshRoot "node_modules\@deepseek-ai\dsh-billing"

# --- 1) copy package into DSH checkout -------------------------------------
$src = Join-Path $PSScriptRoot "package"
if (-not (Test-Path $src)) {
    Write-Error "package folder not found next to this script: $src"
    exit 1
}
New-Item -ItemType Directory -Force -Path $pkgDest | Out-Null
Copy-Item -Recurse -Force -Path (Join-Path $src "*") -Destination $pkgDest
Write-Host "[1/4] Copied dsh-billing package -> $pkgDest"

# --- 2) copy also into web profile node_modules ----------------------------
if (Test-Path (Join-Path $webProfile "node_modules")) {
    $profDest = Join-Path $webProfile "node_modules\@deepseek-ai\dsh-billing"
    New-Item -ItemType Directory -Force -Path $profDest | Out-Null
    Copy-Item -Recurse -Force -Path (Join-Path $src "*") -Destination $profDest
    Write-Host "[2/4] Synced into web profile -> $profDest"
}
else {
    Write-Host "[2/4] web profile node_modules not present yet; will create wiring below"
}

# --- 3) wire profile package.json + cordis.patch.yml -----------------------
# package.json: register the file: dependency so the web profile resolves the package
$pkgJsonPath = Join-Path $webProfile "package.json"
$profileExists = Test-Path $pkgJsonPath
$pkgJson = @{}
if ($profileExists) {
    $pkgJson = Get-Content $pkgJsonPath -Raw | ConvertFrom-Json
}
if (-not $pkgJson.dependencies) { $pkgJson | Add-Member -NotePropertyName dependencies -NotePropertyValue @{} }
$fileUri = "file:" + ($pkgDest -replace "\\", "/")
# Always set (or overwrite) the dsh-billing file: dependency to the correct path.
$pkgJson.dependencies.PSObject.Properties.Remove("@deepseek-ai/dsh-billing")
$pkgJson.dependencies | Add-Member -NotePropertyName "@deepseek-ai/dsh-billing" -NotePropertyValue $fileUri
if ($profileExists) {
    $pkgJson | ConvertTo-Json -Depth 6 | Set-Content -Path $pkgJsonPath -Encoding utf8
}
else {
    # create a minimal web profile package.json (mirrors the shipped shape)
    $pkgJson = @{
        name         = "dsh-profile-web"
        private      = $true
        dependencies = @{ "@deepseek-ai/dsh-billing" = $fileUri }
        dsh          = @{
            profile  = @{
                bundles = @("@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app")
            }
        }
    } | ConvertTo-Json -Depth 8
    New-Item -ItemType Directory -Force -Path $webProfile | Out-Null
    Set-Content -Path $pkgJsonPath -Value $pkgJson -Encoding utf8
}
Write-Host "[3/4] Wired web profile package.json (file: -> $fileUri)"

# cordis.patch.yml: ensure the loader row mounts dsh-billing on startup
$patchPath = Join-Path $webProfile "cordis.patch.yml"
if (Test-Path $patchPath) {
    $patch = Get-Content $patchPath -Raw
    if ($patch -match "dsh-billing") {
        Write-Host "[4/4] cordis.patch.yml already loads dsh-billing"
    }
    else {
        $patch = $patch.TrimEnd() + "`n- insert:`n    - id: dsh-billing`n      name: '@deepseek-ai/dsh-billing'`n"
        Set-Content -Path $patchPath -Value $patch -Encoding utf8
        Write-Host "[4/4] Added dsh-billing loader row to cordis.patch.yml"
    }
}
else {
    $newPatch = "# dsh profile patch`n- insert:`n    - id: dsh-billing`n      name: '@deepseek-ai/dsh-billing'`n"
    New-Item -ItemType Directory -Force -Path $webProfile | Out-Null
    Set-Content -Path $patchPath -Value $newPatch -Encoding utf8
    Write-Host "[4/4] Created cordis.patch.yml with dsh-billing loader row"
}

# --- token ------------------------------------------------------------------
$cfgPath = Join-Path $pkgDest "config.json"
if (-not $Token -and -not $NoPrompt) {
    $Token = Read-Host "DeepSeek platform login token (Authorization: Bearer <token>), or press Enter to skip"
}
if ($Token) {
    @{ token = $Token } | ConvertTo-Json | Set-Content -Path $cfgPath -Encoding utf8
    Write-Host "Wrote token to config.json (also syncing to web profile copy)"
    if (Test-Path (Join-Path $webProfile "node_modules\@deepseek-ai\dsh-billing")) {
        Copy-Item -Force -Path $cfgPath -Destination (Join-Path $webProfile "node_modules\@deepseek-ai\dsh-billing\config.json")
    }
}
else {
    Write-Host "No token set. Edit  $cfgPath  and put your token under `"token`" before using."
}

Write-Host ""
Write-Host "Done. Restart DSH on this machine; the 充值余额 / 今日消费 readout will load below the chat dialog."
