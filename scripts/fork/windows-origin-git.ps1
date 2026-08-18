# Point LocalSystem git at a file store for Origin HTTPS. The Windows
# Origin CLI's credential-helper does not speak git's stdin protocol, so
# we persist an Origin HTTPS token in C:\buildkite-agent\.git-credentials
# instead. The token is minted with `origin credential-helper get` on a
# logged-in machine.

$ErrorActionPreference = "Stop"
$store = "C:\buildkite-agent\.git-credentials"
if (-not (Test-Path $store)) {
  throw "Missing $store. The LocalSystem Origin HTTPS store is not installed."
}
$gitCmd = "C:\Program Files\Git\cmd"
if (Test-Path $gitCmd) { $env:Path = "$gitCmd;$env:Path" }
foreach ($hostName in @("https://origin.cursor.com", "https://origin.cursor.com/git")) {
  git config --system --unset-all "credential.$hostName.helper" 2>$null | Out-Null
  git config --system "credential.$hostName.helper" ""
  git config --system --add "credential.$hostName.helper" "store --file=C:/buildkite-agent/.git-credentials"
}
Write-Host "Origin git store helper ready"
