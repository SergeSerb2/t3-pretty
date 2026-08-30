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
$agentVersion = if ($env:BUILDKITE_AGENT_VERSION) {
  $env:BUILDKITE_AGENT_VERSION
} else {
  "3.137.2"
}
$env:buildkiteAgentVersion = $agentVersion
Set-ExecutionPolicy Bypass -Scope Process -Force
Invoke-Expression ((New-Object System.Net.WebClient).DownloadString("https://raw.githubusercontent.com/buildkite/agent/v$agentVersion/install.ps1"))

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

$serviceName = "buildkite-t3-pretty"
$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($service -and $service.Status -ne "Stopped") {
  Stop-Service -Name $serviceName
  $service.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
}
$serviceAgentDir = "C:\buildkite-agent\service"
$serviceAgentExe = Join-Path $serviceAgentDir "buildkite-agent.exe"
New-Item -ItemType Directory -Force -Path $serviceAgentDir | Out-Null
Copy-Item $agentExe $serviceAgentExe -Force
$serviceAgentVersion = (& $serviceAgentExe --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or -not $serviceAgentVersion.Contains($agentVersion)) {
  throw "Expected Buildkite agent $agentVersion at $serviceAgentExe; got '$serviceAgentVersion'"
}
if (-not $service) {
  & $nssm install $serviceName $serviceAgentExe start
}
& $nssm set $serviceName Application $serviceAgentExe
& $nssm set $serviceName AppParameters "start --config `"$cfg`""
& $nssm set $serviceName AppDirectory "C:\buildkite-agent"
$agentLog = "C:\buildkite-agent\buildkite-agent.log"
& $nssm set $serviceName AppStdout $agentLog
& $nssm set $serviceName AppStderr $agentLog
& $nssm set $serviceName Start SERVICE_AUTO_START
& $nssm set $serviceName AppExit Default Restart
& $nssm set $serviceName AppRestartDelay 5000
& sc.exe failure $serviceName reset= 86400 actions= restart/5000/restart/30000/restart/60000
if ($LASTEXITCODE -ne 0) {
  throw "Failed to configure recovery for Buildkite Windows service $serviceName"
}
& sc.exe failureflag $serviceName 1
if ($LASTEXITCODE -ne 0) {
  throw "Failed to configure recovery flag for Buildkite Windows service $serviceName"
}

$hooksDir = "C:\buildkite-agent\hooks"
New-Item -ItemType Directory -Force -Path $hooksDir | Out-Null
$gitCmd = "C:\Program Files\Git\cmd"
if (Test-Path $gitCmd) { $env:Path = "$gitCmd;$env:Path" }
git config --system core.longpaths true
if ($LASTEXITCODE -ne 0) {
  throw "Failed to enable long paths for the Buildkite Windows agent"
}
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

& $nssm start $serviceName
if ($LASTEXITCODE -ne 0) {
  throw "Buildkite Windows service $serviceName failed to start. Check $agentLog"
}
$service = Get-Service -Name $serviceName
try {
  $service.WaitForStatus("Running", [TimeSpan]::FromSeconds(30))
} catch {
  throw "Buildkite Windows service $serviceName failed to start. Check $agentLog"
}
if ($service.Status -ne "Running") {
  throw "Buildkite Windows service $serviceName failed to start. Check $agentLog"
}
Write-Host "Registered Buildkite Windows service $agentName on queue $queue"
