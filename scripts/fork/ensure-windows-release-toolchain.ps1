# Installs or verifies the tools the T3 Pretty Windows desktop release job needs
# on windows-5080-t3code-fork. Run as Administrator without -CheckOnly to
# install missing pieces. The release workflow calls this with -CheckOnly so a
# missing toolchain fails fast instead of dying inside electron-builder.
param(
  [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"

function Write-Missing($name, $path) {
  $hint = "On the runner host, as Administrator, run: powershell -ExecutionPolicy Bypass -File C:\dev\ensure-windows-release-toolchain.ps1"
  throw "$name is required at $path. $hint"
}

function Test-GitBash {
  Test-Path (Join-Path $env:ProgramFiles "Git\bin\bash.exe")
}

function Test-Pwsh7 {
  Test-Path (Join-Path $env:ProgramFiles "PowerShell\7\pwsh.exe")
}

function Get-VsInstallPath {
  $programFilesX86 = ${env:ProgramFiles(x86)}
  $vswhere = Join-Path $programFilesX86 "Microsoft Visual Studio\Installer\vswhere.exe"
  if (-not (Test-Path $vswhere)) {
    return $null
  }
  $installPath = & $vswhere -products * -latest -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  if ([string]::IsNullOrWhiteSpace($installPath)) {
    return $null
  }
  return $installPath.Trim()
}

function Install-GitForWindows {
  $version = "2.55.0.4"
  $installer = Join-Path $env:TEMP "Git-$version-64-bit.exe"
  try {
    Invoke-WebRequest `
      -UseBasicParsing `
      -Uri "https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.4/Git-$version-64-bit.exe" `
      -OutFile $installer
    $actual = (Get-FileHash -Algorithm SHA256 $installer).Hash.ToLowerInvariant()
    $expected = "0cbc0b34a74b3aff3ace0910328549155a770e228331b19cb1498218a120e7ff"
    if ($actual -ne $expected) {
      throw "Git for Windows checksum mismatch"
    }

    $process = Start-Process $installer `
      -ArgumentList @(
        "/VERYSILENT",
        "/NORESTART",
        "/SUPPRESSMSGBOXES",
        "/COMPONENTS=gitlfs,assoc,assoc_sh",
        '/DIR=C:\Program Files\Git'
      ) `
      -Wait `
      -PassThru
    if ($process.ExitCode -ne 0) {
      throw "Git for Windows setup failed with exit $($process.ExitCode)"
    }
  }
  finally {
    Remove-Item $installer -Force -ErrorAction SilentlyContinue
  }

  if (-not (Test-GitBash)) {
    throw "Git for Windows was installed but bash.exe was not found"
  }
}

function Install-VsBuildTools {
  $bootstrapper = Join-Path $env:TEMP "vs_BuildTools.exe"
  try {
    Invoke-WebRequest `
      -UseBasicParsing `
      -Uri "https://aka.ms/vs/17/release/vs_BuildTools.exe" `
      -OutFile $bootstrapper

    $process = Start-Process $bootstrapper `
      -ArgumentList @(
        "--quiet",
        "--wait",
        "--norestart",
        "--nocache",
        "--add", "Microsoft.VisualStudio.Workload.VCTools",
        "--add", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
        "--add", "Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre",
        "--includeRecommended"
      ) `
      -Wait `
      -PassThru
    if ($process.ExitCode -ne 0 -and $process.ExitCode -ne 3010) {
      throw "Visual Studio Build Tools setup failed with exit $($process.ExitCode)"
    }
  }
  finally {
    Remove-Item $bootstrapper -Force -ErrorAction SilentlyContinue
  }

  if ($null -eq (Get-VsInstallPath)) {
    throw "Visual Studio Build Tools were installed but MSVC x64 tools were not found"
  }
}

function Install-SpectreLibs {
  $componentId = "Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre"
  $programFilesX86 = ${env:ProgramFiles(x86)}
  $vswhere = Join-Path $programFilesX86 "Microsoft Visual Studio\Installer\vswhere.exe"
  $setupExe = Join-Path $programFilesX86 "Microsoft Visual Studio\Installer\setup.exe"
  $installPath = Get-VsInstallPath
  if ($null -eq $installPath) {
    return
  }
  $existing = & $vswhere -products * -latest -requires $componentId -property installationPath
  if (-not [string]::IsNullOrWhiteSpace($existing)) {
    Write-Host "Spectre MSVC libs already installed."
    return
  }

  Write-Host "Adding $componentId to $installPath"
  $process = Start-Process $setupExe `
    -ArgumentList @(
      "modify",
      "--installPath",
      "`"$installPath`"",
      "--add",
      $componentId,
      "--quiet",
      "--norestart"
    ) `
    -Wait `
    -PassThru
  if ($process.ExitCode -ne 0 -and $process.ExitCode -ne 3010) {
    throw "Spectre lib install failed with exit $($process.ExitCode)"
  }
}

if ($CheckOnly) {
  if (-not (Test-Pwsh7)) {
    Write-Missing "PowerShell 7" (Join-Path $env:ProgramFiles "PowerShell\7\pwsh.exe")
  }
  if (-not (Test-GitBash)) {
    Write-Missing "Git for Windows Bash" (Join-Path $env:ProgramFiles "Git\bin\bash.exe")
  }
  if ($null -eq (Get-VsInstallPath)) {
    Write-Missing "Visual Studio MSVC x64 tools" "${env:ProgramFiles(x86)}\Microsoft Visual Studio"
  }
  Write-Host "Windows release toolchain OK."
  return
}

if (-not (Test-GitBash)) {
  Write-Host "Installing Git for Windows."
  Install-GitForWindows
}

if ($null -eq (Get-VsInstallPath)) {
  Write-Host "Installing Visual Studio 2022 Build Tools with MSVC and Spectre libs."
  Install-VsBuildTools
}

Install-SpectreLibs

Write-Host "Windows release toolchain is ready."
