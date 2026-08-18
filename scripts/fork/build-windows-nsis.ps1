# Native Buildkite Windows NSIS build. The GitHub Actions importer cannot
# schedule Windows jobs, so this is the Origin release path for x64 installers.
#
# Unsigned by default. Azure Trusted Signing still lives in fork-release.yml
# and is skipped until those secrets exist on the cluster.

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $root

& "$root\scripts\fork\ensure-windows-release-toolchain.ps1" -CheckOnly

$gitBash = Join-Path $env:ProgramFiles "Git\bin"
$pwshDir = Join-Path $env:ProgramFiles "PowerShell\7"
if (Test-Path $gitBash) { $env:Path = "$gitBash;$env:Path" }
if (Test-Path $pwshDir) { $env:Path = "$pwshDir;$env:Path" }

if (-not $env:GITHUB_RUN_NUMBER) {
  if (-not $env:BUILDKITE_BUILD_NUMBER) {
    throw "BUILDKITE_BUILD_NUMBER is required to mint a fork version."
  }
  $env:GITHUB_RUN_NUMBER = $env:BUILDKITE_BUILD_NUMBER
}

if ((@(git remote) -contains "upstream")) {
  git remote set-url upstream https://github.com/pingdotgg/t3code.git
} else {
  git remote add upstream https://github.com/pingdotgg/t3code.git
}
git fetch --force --tags upstream

$resolved = node "$root\scripts\fork\resolve-fork-release.mjs" | ConvertFrom-Json
$version = $resolved.version
Write-Host "Building Windows NSIS $version"

# Official Vite+ is vp.exe under VP_HOME. npm's global `vp` / `npx vp`
# is a stub that prints install instructions and exits 0.
$vpHome = "C:\buildkite-agent\vite-plus"
$env:VP_HOME = $vpHome
$vpBin = Join-Path $vpHome "bin"
$vpExe = Join-Path $vpBin "vp.exe"

function Test-OfficialVp($path) {
  if (-not $path -or -not (Test-Path $path)) { return $false }
  if ([IO.Path]::GetFileName($path) -ne "vp.exe") { return $false }
  $out = & $path --version 2>&1 | Out-String
  if ($out -match "npx vp") { return $false }
  return $LASTEXITCODE -eq 0
}

if (-not (Test-OfficialVp $vpExe)) {
  Write-Host "Installing official Vite+ into $vpHome"
  $installer = Join-Path $env:TEMP "vite-plus-install.ps1"
  Invoke-RestMethod https://vite.plus/ps1 | Set-Content -Path $installer -Encoding UTF8
  $env:CI = "true"
  $install = Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $installer
  ) -Wait -PassThru -NoNewWindow
  if ($null -eq $install -or $install.ExitCode -ne 0) {
    $code = if ($null -ne $install) { $install.ExitCode } else { 1 }
    throw "Official Vite+ installer failed with exit $code"
  }
}

if (-not (Test-OfficialVp $vpExe)) {
  throw "vp.exe is not official Vite+ after install at $vpExe"
}

$env:Path = "$vpBin;$env:Path"

function Invoke-Vp {
  param([Parameter(ValueFromRemainingArguments = $true)]$VpArgs)
  & $vpExe @VpArgs
  if ($LASTEXITCODE -ne 0) {
    throw "vp exited $LASTEXITCODE: $($VpArgs -join ' ')"
  }
}

Invoke-Vp i --filter=@t3tools/desktop... --filter=t3... --filter=@t3tools/scripts...
node "$root\scripts\update-release-package-versions.ts" $version
if ($LASTEXITCODE -ne 0) {
  throw "update-release-package-versions exited $LASTEXITCODE"
}
Invoke-Vp run dist:desktop:artifact -- --platform win --target nsis --arch x64 --build-version $version --verbose

$publish = Join-Path $root "release-publish"
New-Item -ItemType Directory -Force -Path $publish | Out-Null
Get-ChildItem (Join-Path $root "release") -File | Where-Object {
  $_.Extension -in ".exe", ".blockmap", ".yml"
} | Copy-Item -Destination $publish -Force

if (Get-Command buildkite-agent -ErrorAction SilentlyContinue) {
  Push-Location $publish
  try { buildkite-agent artifact upload "*" } finally { Pop-Location }
}

Write-Host "Windows NSIS artifacts in $publish"
