# Native Buildkite Windows NSIS build. The GitHub Actions importer cannot
# schedule Windows jobs, so this is the Origin release path for x64 installers.
#
# Unsigned by default. Azure Trusted Signing still lives in fork-release.yml
# and is skipped until those secrets exist on the cluster.

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $root

$changelogSubject = (git log -1 --format=%s | Out-String).Trim()
$reusedVersion = $null
if ($changelogSubject -like "docs(changelog):*") {
  $prefix = "docs(changelog): add release notes through v"
  if ($changelogSubject.StartsWith($prefix)) {
    $reusedVersion = $changelogSubject.Substring($prefix.Length).Trim()
  } else {
    $reusedVersion = (
      node -e 'const src = require("node:fs").readFileSync("apps/web/src/changelog/changelogData.ts", "utf8"); const match = /^\s+version:\s*"([^"]+)",$/m.exec(src); if (!match) process.exit(1); process.stdout.write(match[1]);'
    ).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $reusedVersion) {
      throw "Changelog commit has no reusable version"
    }
  }
  if (-not $reusedVersion) {
    throw "Changelog commit has no reusable version"
  }
  Write-Host "Changelog commit; packaging already-minted $reusedVersion without reminting."
  $feedUrl = if ($env:T3CODE_DESKTOP_UPDATE_FEED_URL) {
    $env:T3CODE_DESKTOP_UPDATE_FEED_URL.TrimEnd("/")
  } else {
    "https://pub-8033bcab5baf492b81c605581ff028e0.r2.dev/t3-pretty/latest"
  }
  try {
    $manifest = (Invoke-WebRequest -UseBasicParsing -Uri "$feedUrl/latest.yml").Content
    if ($manifest -match ("(?m)^version: " + [regex]::Escape($reusedVersion) + "\s*$")) {
      Write-Host "Feed already has $reusedVersion; skipping Windows packaging."
      exit 0
    }
  } catch {
    Write-Host "warning: could not read the Windows updater feed; continuing the Windows release"
  }
}

& "$root\scripts\fork\ensure-windows-release-toolchain.ps1" -CheckOnly

$gitBash = Join-Path $env:ProgramFiles "Git\bin"
$pwshDir = Join-Path $env:ProgramFiles "PowerShell\7"
$cargoBin = "C:\Users\serge\.cargo\bin"
if (Test-Path $gitBash) { $env:Path = "$gitBash;$env:Path" }
if (Test-Path $pwshDir) { $env:Path = "$pwshDir;$env:Path" }
if (Test-Path $cargoBin) { $env:Path = "$cargoBin;$env:Path" }
if (Get-Command rustup -ErrorAction SilentlyContinue) {
  rustup default stable
  if ($LASTEXITCODE -ne 0) {
    rustup toolchain install stable --profile minimal --no-self-update
    rustup default stable
  }
  if ($LASTEXITCODE -ne 0) {
    throw "rustup default stable failed with exit ${LASTEXITCODE}"
  }
} else {
  throw "rustup is required on the windows-release agent."
}

if (-not $reusedVersion -and -not $env:GITHUB_RUN_NUMBER) {
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

if ($reusedVersion) {
  $version = $reusedVersion
} else {
  $resolved = node "$root\scripts\fork\resolve-fork-release.mjs" | ConvertFrom-Json
  $version = $resolved.version
}
Write-Host "Building Windows NSIS $version"

# Mac packager persists notes to main. Write locally so this installer still
# ships them if the Mac job has not pushed yet.
if (-not $env:CLI_PROXY_API_KEY) {
  foreach ($candidate in @(
    (Join-Path $env:USERPROFILE ".config\t3-pretty\CLI_PROXY_API_KEY"),
    "C:\buildkite-agent\secrets\CLI_PROXY_API_KEY"
  )) {
    if (Test-Path $candidate) {
      $env:CLI_PROXY_API_KEY = (Get-Content -Raw $candidate).Trim()
      break
    }
  }
}
node "$root\scripts\fork\generate-changelog.mjs" --version $version --no-push
if ($LASTEXITCODE -ne 0) {
  Write-Host "warning: changelog generation failed; continuing the Windows release"
}

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
    throw "vp exited ${LASTEXITCODE}: $($VpArgs -join ' ')"
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
  if (-not $env:CLOUDFLARE_API_TOKEN) {
    $fetched = buildkite-agent secret get CLOUDFLARE_API_TOKEN 2>$null
    if ($LASTEXITCODE -eq 0 -and $fetched) {
      $env:CLOUDFLARE_API_TOKEN = "$fetched".Trim()
    }
  }
}

if (-not $env:CLOUDFLARE_API_TOKEN) {
  foreach ($candidate in @(
    "C:\buildkite-agent\secrets\CLOUDFLARE_API_TOKEN",
    (Join-Path $env:USERPROFILE ".config\t3-pretty\CLOUDFLARE_API_TOKEN")
  )) {
    if (Test-Path $candidate) {
      $env:CLOUDFLARE_API_TOKEN = (Get-Content -Raw $candidate).Trim()
      break
    }
  }
}

$nightlyYml = Join-Path $publish "nightly.yml"
$latestYml = Join-Path $publish "latest.yml"
if ((Test-Path $nightlyYml) -and -not (Test-Path $latestYml)) {
  Copy-Item $nightlyYml $latestYml
}

if (-not $env:CLOUDFLARE_API_TOKEN) {
  throw "CLOUDFLARE_API_TOKEN is required to publish Windows updater assets to the public feed."
}

$upload = @("scripts\fork\origin-forge.mjs", "upload-assets")
Get-ChildItem $publish -File | Where-Object {
  $_.Extension -in ".exe", ".blockmap", ".yml"
} | ForEach-Object {
  $upload += "--asset"
  $upload += $_.FullName
}
node @upload
if ($LASTEXITCODE -ne 0) {
  throw "Windows updater upload exited $LASTEXITCODE"
}

Write-Host "Windows NSIS artifacts in $publish"
