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

if (git remote get-url upstream 2>$null) {
  git remote set-url upstream https://github.com/pingdotgg/t3code.git
} else {
  git remote add upstream https://github.com/pingdotgg/t3code.git
}
git fetch --force --tags upstream

$resolved = node "$root\scripts\fork\resolve-fork-release.mjs" | ConvertFrom-Json
$version = $resolved.version
Write-Host "Building Windows NSIS $version"

node "$root\scripts\update-release-package-versions.ts" $version

if (-not (Get-Command vp -ErrorAction SilentlyContinue)) {
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "vp and npm are missing. Install Node.js and Vite+ on this agent."
  }
  npm exec --yes vp -- --version | Out-Host
}

vp i --filter=@t3tools/desktop... --filter=t3... --filter=@t3tools/scripts...
vp run dist:desktop:artifact -- --platform win --target nsis --arch x64 --build-version $version --verbose

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
