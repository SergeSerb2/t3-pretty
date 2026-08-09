$ErrorActionPreference = "Stop"

$pwshDir = Join-Path $env:ProgramFiles "PowerShell\7"
$pwshPath = Join-Path $pwshDir "pwsh.exe"
if (-not (Test-Path $pwshPath)) {
  $pwshVersion = "7.6.4"
  $archive = Join-Path $env:TEMP "PowerShell-$pwshVersion-win-x64.msi"
  try {
    Invoke-WebRequest `
      -UseBasicParsing `
      -Uri "https://github.com/PowerShell/PowerShell/releases/download/v$pwshVersion/PowerShell-$pwshVersion-win-x64.msi" `
      -OutFile $archive
    $actual = (Get-FileHash -Algorithm SHA256 $archive).Hash.ToLowerInvariant()
    $expected = "d11942df52fd12470169797abfa4781d9480efdc81000ba4fa55a5b921ed8dd0"
    if ($actual -ne $expected) {
      throw "PowerShell MSI checksum mismatch"
    }

    $process = Start-Process msiexec.exe `
      -ArgumentList @(
        "/i",
        "`"$archive`"",
        "/qn",
        "ADD_PATH=1",
        "REGISTER_MANIFEST=1",
        "USE_MU=0",
        "ENABLE_MU=0"
      ) `
      -Wait `
      -PassThru
    if ($process.ExitCode -ne 0) {
      throw "PowerShell MSI failed with exit $($process.ExitCode)"
    }
  }
  finally {
    Remove-Item $archive -Force -ErrorAction SilentlyContinue
  }

  if (-not (Test-Path $pwshPath)) {
    throw "PowerShell 7 was installed but $pwshPath was not found"
  }
}

$machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
if (($machinePath -split ";") -notcontains $pwshDir) {
  [Environment]::SetEnvironmentVariable("Path", "$machinePath;$pwshDir", "Machine")
}
$env:Path = "$pwshDir;$env:Path"

Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope LocalMachine -Force

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
