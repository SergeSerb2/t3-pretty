# Native Buildkite Windows NSIS build. The GitHub Actions importer cannot
# schedule Windows jobs, so this is the Origin release path for x64 installers.
#
# Unsigned by default. Azure Trusted Signing still lives in fork-release.yml
# and is skipped until those secrets exist on the cluster.

$ErrorActionPreference = "Stop"
$env:CI = "true"
$env:GIT_TERMINAL_PROMPT = "0"
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = "0"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $root

$changelogSubject = (git log -1 --format=%s | Out-String).Trim()
$reusedVersion = $null
$changelogPrefix = "docs(changelog): add release notes through v"
if ($changelogSubject.StartsWith($changelogPrefix)) {
  $reusedVersion = $changelogSubject.Substring($changelogPrefix.Length).Trim()
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
$env:CARGO_HOME = Join-Path $root ".cache\t3-pretty-release\cargo"
$env:RUSTUP_HOME = "C:\buildkite-agent\rustup"
$rustToolchain = "stable-x86_64-pc-windows-msvc"
$env:RUSTUP_TOOLCHAIN = $rustToolchain
$rustToolchainBin = Join-Path $env:RUSTUP_HOME "toolchains\$rustToolchain\bin"
$bootstrapRustup = "C:\Users\serge\.cargo\bin\rustup.exe"
if (-not (Test-Path $bootstrapRustup)) {
  throw "rustup is required on the windows-release agent."
}
New-Item -ItemType Directory -Force -Path $env:CARGO_HOME | Out-Null
if (Test-Path $gitBash) { $env:Path = "$gitBash;$env:Path" }
if (Test-Path $pwshDir) { $env:Path = "$pwshDir;$env:Path" }
$env:Path = "$rustToolchainBin;$env:Path"

function Test-RustTool($name) {
  try {
    & $name --version
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

if (-not (Test-RustTool "cargo") -or -not (Test-RustTool "rustc")) {
  Write-Host "Repairing missing or unusable Rust toolchain $rustToolchain."
  try {
    & $bootstrapRustup toolchain uninstall $rustToolchain 2>$null
  } catch {
    Write-Host "warning: could not remove $rustToolchain; continuing with rustup install"
  }
  & $bootstrapRustup toolchain install $rustToolchain --profile minimal --no-self-update
  if ($LASTEXITCODE -ne 0) {
    throw "rustup toolchain install failed with exit ${LASTEXITCODE}"
  }
  if (-not (Test-RustTool "cargo")) {
    throw "cargo is unusable after repairing $rustToolchain"
  }
  if (-not (Test-RustTool "rustc")) {
    throw "rustc is unusable after repairing $rustToolchain"
  }
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

# Mac packager persists notes to main. When main already carries this
# version's notes commit, ship that exact file so both installers show the
# same What's New text; otherwise generate locally so this installer still
# ships notes if the Mac job has not pushed yet. Changelog-commit retries
# already have those notes; do not regenerate them.
if (-not $reusedVersion) {
  $notesFromMain = $false
  git fetch --quiet origin main
  if ($LASTEXITCODE -eq 0) {
    $mainTipSubject = (git log -1 --format=%s origin/main | Out-String).Trim()
    if ($mainTipSubject -eq ($changelogPrefix + $version)) {
      git checkout --quiet origin/main -- apps/web/src/changelog/changelogData.ts
      $notesFromMain = $LASTEXITCODE -eq 0
    }
  }
  if ($notesFromMain) {
    Write-Host "Reusing the What's New notes the Mac packager pushed to main."
  } else {
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
  }
} else {
  Write-Host "Changelog commit already has notes; skipping changelog generation."
}

function Invoke-Pnpm {
  param([Parameter(ValueFromRemainingArguments = $true)]$PnpmArgs)
  & corepack pnpm @PnpmArgs
  if ($LASTEXITCODE -ne 0) {
    throw "pnpm exited ${LASTEXITCODE}: $($PnpmArgs -join ' ')"
  }
}

Invoke-Pnpm install --filter=@t3tools/desktop... --filter=t3... --filter=@t3tools/scripts...
node "$root\scripts\update-release-package-versions.ts" $version
if ($LASTEXITCODE -ne 0) {
  throw "update-release-package-versions exited $LASTEXITCODE"
}
Invoke-Pnpm run dist:desktop:artifact -- --platform win --target nsis --arch x64 --build-version $version --verbose

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

# Publish the baked notes when the Mac job has not: main must not keep the
# frozen 2026-08-12 file when macos-release died before its own --publish.
# The script no-ops when the working tree has no pending notes or main
# already carries this version's notes commit.
node "$root\scripts\fork\generate-changelog.mjs" --publish
if ($LASTEXITCODE -ne 0) {
  Write-Host "warning: release notes ship with $version but could not be pushed to main"
}

Write-Host "Windows NSIS artifacts in $publish"
