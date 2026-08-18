# Register a trusted Windows Buildkite agent for T3 Pretty Origin releases.
#
# Queue: windows-release. Never add pull-request queues. Requires a cluster
# agent token from the Origin-connected Buildkite org.
#
# Usage (elevated PowerShell):
#   '{"token":"<agent token>"}' | Set-Content C:\dev\t3-buildkite-token.json
#   powershell -ExecutionPolicy Bypass -File scripts\fork\setup-buildkite-windows-agent.ps1
#
# The script deletes the token file after it is read.

$ErrorActionPreference = "Stop"

$tokenPath = if ($env:TOKEN_PATH) { $env:TOKEN_PATH } else { "C:\dev\t3-buildkite-token.json" }
$agentName = if ($env:AGENT_NAME) { $env:AGENT_NAME } else { "windows-5080-t3code-fork" }
$queue = if ($env:QUEUES) { $env:QUEUES } else { "windows-release" }

if (-not (Test-Path $tokenPath)) {
  throw "Missing Buildkite token file at $tokenPath"
}
$token = (Get-Content $tokenPath -Raw | ConvertFrom-Json).token
Remove-Item $tokenPath -Force
if ([string]::IsNullOrWhiteSpace($token)) {
  throw "Agent token was empty"
}

$env:buildkiteAgentToken = $token
Set-ExecutionPolicy Bypass -Scope Process -Force
Invoke-Expression ((New-Object System.Net.WebClient).DownloadString("https://raw.githubusercontent.com/buildkite/agent/main/install.ps1"))

$cfg = "C:\buildkite-agent\buildkite-agent.cfg"
if (-not (Test-Path $cfg)) {
  throw "Missing $cfg after install"
}

$lines = Get-Content $cfg
$written = @{}
$output = foreach ($line in $lines) {
  $stripped = $line.TrimStart("# ").Trim()
  if ($stripped.StartsWith("token=") -and -not $written.ContainsKey("token")) {
    $written["token"] = $true
    "token=`"$token`""
  } elseif ($stripped.StartsWith("name=") -and -not $written.ContainsKey("name")) {
    $written["name"] = $true
    "name=`"$agentName`""
  } elseif ($stripped.StartsWith("tags=") -and -not $written.ContainsKey("tags")) {
    $written["tags"] = $true
    "tags=`"queue=$queue,os=windows,arch=x64,t3code-fork=true,release-only=true`""
  } else {
    $line
  }
}
if (-not $written.ContainsKey("token")) { $output += "token=`"$token`"" }
if (-not $written.ContainsKey("name")) { $output += "name=`"$agentName`"" }
if (-not $written.ContainsKey("tags")) {
  $output += "tags=`"queue=$queue,os=windows,arch=x64,t3code-fork=true,release-only=true`""
}
Set-Content -Path $cfg -Value $output

$agentExe = "C:\buildkite-agent\bin\buildkite-agent.exe"
if (-not (Test-Path $agentExe)) {
  $agentExe = "C:\buildkite-agent\buildkite-agent.exe"
}

$nssmCmd = Get-Command nssm -ErrorAction SilentlyContinue
if (-not $nssmCmd) {
  $nssmDir = "C:\buildkite-agent\nssm"
  $nssmExe = Join-Path $nssmDir "nssm.exe"
  if (-not (Test-Path $nssmExe)) {
    New-Item -ItemType Directory -Force -Path $nssmDir | Out-Null
    $zip = Join-Path $env:TEMP "nssm-2.24.zip"
    Invoke-WebRequest -UseBasicParsing -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile $zip
    $extract = Join-Path $env:TEMP "nssm-extract"
    if (Test-Path $extract) { Remove-Item -Recurse -Force $extract }
    Expand-Archive -Path $zip -DestinationPath $extract -Force
    $src = Get-ChildItem -Path $extract -Recurse -Filter nssm.exe |
      Where-Object { $_.FullName -match "win64" } |
      Select-Object -First 1
    if (-not $src) { throw "nssm.exe win64 not found in the NSSM zip" }
    Copy-Item $src.FullName $nssmExe -Force
  }
  $nssm = $nssmExe
} else {
  $nssm = $nssmCmd.Source
}

if (-not (Get-Service -Name "buildkite-t3-pretty" -ErrorAction SilentlyContinue)) {
  & $nssm install buildkite-t3-pretty $agentExe start
}
& $nssm set buildkite-t3-pretty AppDirectory "C:\buildkite-agent"
& $nssm set buildkite-t3-pretty AppStdout "C:\buildkite-agent\buildkite-agent.log"
& $nssm set buildkite-t3-pretty AppStderr "C:\buildkite-agent\buildkite-agent.log"
& $nssm set buildkite-t3-pretty Start SERVICE_AUTO_START

$hooksDir = "C:\buildkite-agent\hooks"
New-Item -ItemType Directory -Force -Path $hooksDir | Out-Null
$hookSrc = Join-Path $PSScriptRoot "windows-origin-git.ps1"
if (Test-Path $hookSrc) {
  Copy-Item $hookSrc (Join-Path $hooksDir "windows-origin-git.ps1") -Force
}
$preCheckout = Join-Path $hooksDir "pre-checkout.bat"
@(
  "@echo off"
  "powershell -NoProfile -ExecutionPolicy Bypass -File C:\buildkite-agent\hooks\windows-origin-git.ps1"
  "if errorlevel 1 exit /b %ERRORLEVEL%"
) | Set-Content -Path $preCheckout -Encoding ASCII
if (Test-Path "C:\buildkite-agent\.git-credentials") {
  & (Join-Path $hooksDir "windows-origin-git.ps1")
}

Get-Process -Name buildkite-agent -ErrorAction SilentlyContinue | Stop-Process -Force
& $nssm start buildkite-t3-pretty
Write-Host "Registered Buildkite Windows service $agentName on queue $queue"
