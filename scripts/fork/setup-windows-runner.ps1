$ErrorActionPreference = "Stop"

$tokenPath = "C:\dev\t3-runner-token.json"
$token = (Get-Content $tokenPath -Raw | ConvertFrom-Json).token
Remove-Item $tokenPath -Force
if ([string]::IsNullOrWhiteSpace($token)) {
  throw "Registration token missing"
}

$runnerDir = "C:\actions-runner-t3code-fork"
New-Item -ItemType Directory -Force -Path $runnerDir | Out-Null
Set-Location $runnerDir

if (-not (Test-Path ".\config.cmd")) {
  $archive = "$env:TEMP\actions-runner-win-x64-2.336.0.zip"
  Invoke-WebRequest `
    -UseBasicParsing `
    -Uri "https://github.com/actions/runner/releases/download/v2.336.0/actions-runner-win-x64-2.336.0.zip" `
    -OutFile $archive
  $actual = (Get-FileHash -Algorithm SHA256 $archive).Hash.ToLowerInvariant()
  $expected = "d59123a43003e357b0805b5d0f611d0bd2f65ab67d51bd070dd4e7a0f685c162"
  if ($actual -ne $expected) {
    throw "Runner checksum mismatch"
  }
  Expand-Archive -Path $archive -DestinationPath $runnerDir -Force
}

& .\config.cmd `
  --unattended `
  --replace `
  --url https://github.com/SergeSerb2/t3code-fork-theme `
  --token $token `
  --name windows-5080-t3code-fork `
  --labels t3code-fork,release-only,windows-x64 `
  --work _work-t3code-fork `
  --runasservice
if ($LASTEXITCODE -ne 0) {
  throw "Runner config failed with exit $LASTEXITCODE"
}

$services = Get-Service | Where-Object Name -Like "actions.runner.SergeSerb2-t3code-fork-theme*"
$services | Start-Service
$services | Select-Object Name, Status, StartType | Format-List
