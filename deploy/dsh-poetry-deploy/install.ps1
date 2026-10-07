<#
.SYNOPSIS
  Install the 诗泉 side-panel plugin (dsh-poetry) into another DSH installation.

.DESCRIPTION
  Copies the @deepseek-ai/dsh-poetry package into the target DSH's node_modules,
  syncs it into the web profile, wires the web profile package.json (file:
  dependency) and cordis.patch.yml so the '诗词' footer button + its panel load
  on every DSH restart. The plugin talks to the public online API at
  poetry.palemoky.com directly from the browser, so NO token / proxy / config is
  needed.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install.ps1 -DshRoot "<USERPROFILE>\...\work\dsh"

  # optionally point at a custom DSH config home (defaults to <USERPROFILE>\.dsh)
  powershell -ExecutionPolicy Bypass -File install.ps1 -DshRoot "..." -ProfileRoot "D:\dsh-home"
#>
param(
    # Root of the DSH checkout that contains node_modules\@deepseek-ai
    [string]$DshRoot,
    # Path to the DSH user config home (defaults to <USERPROFILE>\.dsh)
    [string]$ProfileRoot
)

$ErrorActionPreference = "Stop"

# --- locate DSH root --------------------------------------------------------
if (-not $DshRoot) {
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
$pkgDest = Join-Path $DshRoot "node_modules\@deepseek-ai\dsh-poetry"

# --- 1) copy package into DSH checkout -------------------------------------
$src = Join-Path $PSScriptRoot "package"
if (-not (Test-Path $src)) {
    Write-Error "package folder not found next to this script: $src"
    exit 1
}
New-Item -ItemType Directory -Force -Path $pkgDest | Out-Null
Copy-Item -Recurse -Force -Path (Join-Path $src "*") -Destination $pkgDest
Write-Host "[1/4] Copied dsh-poetry package -> $pkgDest"

# --- 2) copy also into web profile node_modules ----------------------------
if (Test-Path (Join-Path $webProfile "node_modules")) {
    $profDest = Join-Path $webProfile "node_modules\@deepseek-ai\dsh-poetry"
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
# Always set (or overwrite) the dsh-poetry file: dependency to the correct path.
$pkgJson.dependencies.PSObject.Properties.Remove("@deepseek-ai/dsh-poetry")
$pkgJson.dependencies | Add-Member -NotePropertyName "@deepseek-ai/dsh-poetry" -NotePropertyValue $fileUri
if ($profileExists) {
    $pkgJson | ConvertTo-Json -Depth 6 | Set-Content -Path $pkgJsonPath -Encoding utf8
}
else {
    # create a minimal web profile package.json (mirrors the shipped shape)
    $pkgJson = @{
        name         = "dsh-profile-web"
        private      = $true
        dependencies = @{ "@deepseek-ai/dsh-poetry" = $fileUri }
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

# cordis.patch.yml: ensure the loader row mounts dsh-poetry on startup
$patchPath = Join-Path $webProfile "cordis.patch.yml"
if (Test-Path $patchPath) {
    $patch = Get-Content $patchPath -Raw
    if ($patch -match "dsh-poetry") {
        Write-Host "[4/4] cordis.patch.yml already loads dsh-poetry"
    }
    else {
        $patch = $patch.TrimEnd() + "`n- insert:`n    - id: dsh-poetry`n      name: '@deepseek-ai/dsh-poetry'`n"
        Set-Content -Path $patchPath -Value $patch -Encoding utf8
        Write-Host "[4/4] Added dsh-poetry loader row to cordis.patch.yml"
    }
}
else {
    $newPatch = "# dsh profile patch`n- insert:`n    - id: dsh-poetry`n      name: '@deepseek-ai/dsh-poetry'`n"
    New-Item -ItemType Directory -Force -Path $webProfile | Out-Null
    Set-Content -Path $patchPath -Value $newPatch -Encoding utf8
    Write-Host "[4/4] Created cordis.patch.yml with dsh-poetry loader row"
}

Write-Host ""
Write-Host "Done. Restart DSH on this machine; the '诗词' footer button will appear above Settings in the sidebar."
