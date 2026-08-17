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

# nssm is optional; start the agent in the background if it is missing.
$nssm = Get-Command nssm -ErrorAction SilentlyContinue
if ($nssm) {
  nssm install buildkite-t3-pretty $agentExe start
  nssm set buildkite-t3-pretty AppParameters "start"
  nssm set buildkite-t3-pretty AppStdout "C:\buildkite-agent\buildkite-agent.log"
  nssm set buildkite-t3-pretty AppStderr "C:\buildkite-agent\buildkite-agent.log"
  nssm start buildkite-t3-pretty
  Write-Host "Registered Buildkite Windows service $agentName on queue $queue"
} else {
  Start-Process -FilePath $agentExe -ArgumentList "start" -WindowStyle Hidden
  Write-Host "Started Buildkite agent $agentName on queue $queue (install nssm later to run it as a service)"
}
