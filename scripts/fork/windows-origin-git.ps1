# Configure Origin HTTPS git for the Windows Buildkite agent.
#
# The windows-release service runs as LocalSystem, so Serge's user git
# credentials never apply. This script installs the Origin CLI into
# C:\buildkite-agent, logs in with CURSOR_API_KEY, and points git at the
# Origin credential helper. Used as the agent pre-checkout hook and by
# setup-buildkite-windows-agent.ps1.
#
# The API key is read from C:\buildkite-agent\cursor-api-key (mode 600).

$ErrorActionPreference = "Stop"

$agentRoot = "C:\buildkite-agent"
$keyFile = Join-Path $agentRoot "cursor-api-key"
$installDir = Join-Path $agentRoot "origin"
$binDir = Join-Path $agentRoot "bin"
$origin = Join-Path $binDir "origin.exe"

if (-not (Test-Path $keyFile)) {
  throw "Missing $keyFile. Write the Cursor API key there for LocalSystem checkout."
}

$apiKey = (Get-Content -LiteralPath $keyFile -Raw).Trim()
if (-not $apiKey.StartsWith("crsr_")) {
  throw "$keyFile does not look like a Cursor API key."
}

New-Item -ItemType Directory -Force -Path $installDir, $binDir | Out-Null

if (-not (Test-Path $origin)) {
  $env:ORIGIN_INSTALL_DIR = $installDir
  $env:ORIGIN_BIN_DIR = $binDir
  $installer = Join-Path $env:TEMP "origin-install.ps1"
  Invoke-WebRequest -UseBasicParsing -Uri "https://downloads.cursor.com/origin/install.ps1" -OutFile $installer
  & $installer
  if (-not (Test-Path $origin)) {
    throw "Origin CLI install did not produce $origin"
  }
}

$gitCmd = "C:\Program Files\Git\cmd"
if (Test-Path $gitCmd) { $env:Path = "$gitCmd;$env:Path" }
$env:Path = "$binDir;$env:Path"
& $origin auth login --api-key $apiKey
if ($LASTEXITCODE -ne 0) {
  throw "origin auth login failed with exit $LASTEXITCODE"
}
& $origin auth setup-git --global
if ($LASTEXITCODE -ne 0) {
  throw "origin auth setup-git failed with exit $LASTEXITCODE"
}

# setup-git may record a bare `origin` helper. LocalSystem PATH is thin, so
# pin the absolute binary for both Origin git hosts Buildkite uses.
foreach ($hostName in @("https://origin.cursor.com", "https://origin.cursor.com/git")) {
  git config --system --unset-all "credential.$hostName.helper" 2>$null | Out-Null
  git config --system "credential.$hostName.helper" ""
  git config --system --add "credential.$hostName.helper" "!'$origin' credential-helper"
}

Write-Host "Origin git helper configured for LocalSystem"
