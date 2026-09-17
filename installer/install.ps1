# BagIdea Office - one-shot open-source installer (Windows 11).
#
# Installs EVERYTHING needed on a bare machine and leaves you ready to run:
#   Git · Node LTS · Rust · the MSVC C++ Build Tools (the Rust linker) ·
#   Godot 4.6.3 · the Claude Code CLI. Then it clones the repo, builds the Rust
#   shell, brands the window icon, wires the `bagidea` command onto your PATH and
#   drops a Start Menu shortcut. Safe to re-run - every step skips what's done and
#   a re-run does a `git pull` (your data is preserved).
#
#   irm https://raw.githubusercontent.com/bagidea/bagidea-office/main/installer/install.ps1 | iex
#
# Options (env or params):
#   -Repo   <url>     source repo            (default: the public BagIdea Office)
#   -Branch <name>    branch to install      (default: main)
#   -SkipBuildTools   don't auto-install the Visual Studio C++ Build Tools
param(
  [string]$Repo   = $(if ($env:BAGIDEA_REPO)   { $env:BAGIDEA_REPO }   else { "https://github.com/bagidea/bagidea-office.git" }),
  [string]$Branch = $(if ($env:BAGIDEA_BRANCH) { $env:BAGIDEA_BRANCH } else { "main" }),
  # Optional art pack (characters + 3D models + sounds). The licensed packs are
  # NOT in the public repo, so the office falls back to procedural visuals. Point
  # -Assets at YOUR own zip/folder (or set $env:BAGIDEA_ASSETS_URL to a URL you
  # host) and the installer drops them into godot/assets so it looks complete.
  [string]$Assets = $env:BAGIDEA_ASSETS_URL,
  [switch]$SkipBuildTools
)
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# PowerShell's DEFAULT execution policy is Restricted, and in PowerShell `npm`
# resolves to npm.ps1 - a script - so on a stock machine `npm install -g` dies
# with "running scripts is disabled on this system" and the install quietly ends
# up with no Claude Code CLI. Process scope lasts only as long as THIS installer
# run: it is not written to the registry and does not change the machine's
# policy. (For the user's own terminal afterwards, see the check at the end -
# their policy is theirs to set, and we ask rather than silently lower it.)
try { Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force -ErrorAction Stop } catch {}

$APPDIR = Join-Path $env:LOCALAPPDATA "BagIdeaOffice"
$APP    = Join-Path $APPDIR "app"
$GODOTV = "4.6.3"

function Step($n, $m) { Write-Host ""; Write-Host "  [$n] $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "      + $m" -ForegroundColor Green }
function Skip($m) { Write-Host "      - $m" -ForegroundColor DarkGray }
function Warn($m) { Write-Host "      ! $m" -ForegroundColor Yellow }

# Download a big file WITH a visible, moving progress bar so it never looks
# frozen. BITS shows a clean % bar and is fast; Invoke-WebRequest is the fallback.
function Get-File($url, $out, $label) {
  Write-Host "      downloading $label - you'll see a progress bar; large files take a few minutes (NOT frozen)..." -ForegroundColor DarkGray
  $ProgressPreference = "Continue"
  try {
    Import-Module BitsTransfer -ErrorAction Stop
    Start-BitsTransfer -Source $url -Destination $out -Description $label -DisplayName $label -ErrorAction Stop
  } catch {
    Invoke-WebRequest -Uri $url -OutFile $out
  }
}
function Have($c) { return [bool](Get-Command $c -ErrorAction SilentlyContinue) }

# npm ships THREE shims - npm (bash), npm.cmd and npm.ps1 - and PowerShell picks
# the .ps1. Always call the .cmd: it runs under any execution policy, including
# the Restricted default a fresh Windows install has.
function Npm-Exe {
  $c = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($d in @((Join-Path $env:ProgramFiles "nodejs"), (Join-Path $env:APPDATA "npm"))) {
    $p = Join-Path $d "npm.cmd"
    if (Test-Path $p) { return $p }
  }
  return $null
}

# "https://github.com/OWNER/REPO(.git)" -> "OWNER/REPO" (for release-asset URLs).
function Repo-Slug($url) {
  if ($url -match "github\.com[:/]+([^/]+)/([^/.]+)") { return "$($matches[1])/$($matches[2])" }
  return $null
}

# Pull freshly-installed tools onto THIS session's PATH (winget updates the
# registry, not the running shell) so git/node/cargo are usable right away.
function Sync-Path {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user    = [Environment]::GetEnvironmentVariable("Path", "User")
  $parts = @($machine, $user) | Where-Object { $_ }
  $cargo = Join-Path $env:USERPROFILE ".cargo\bin"
  if (Test-Path $cargo) { $parts += $cargo }
  $npm = Join-Path $env:APPDATA "npm"
  if (Test-Path $npm) { $parts += $npm }
  $env:Path = ($parts -join ";")
}

Write-Host ""
Write-Host "  ===========================================" -ForegroundColor Cyan
Write-Host "   BagIdea Office - INSTALLER (open source)" -ForegroundColor Cyan
Write-Host "  ===========================================" -ForegroundColor Cyan

# winget is NICE-TO-HAVE, not required. Without it we still install everything
# that matters: Git + Node come from direct portable downloads, and the desktop
# shell comes prebuilt from the GitHub Release (no Rust build). Only the OPTIONAL
# agent CLI tools (gh/ffmpeg/...) truly need winget, so we just skip those.
# (This used to `exit 1` here, which killed the install on winget-less boxes —
# e.g. Windows Server / fresh Administrator accounts — before it ever reached the
# prebuilt path that needs no winget at all.)
$HasWinget = Have "winget"
if (-not $HasWinget) {
  Warn "winget not found - continuing WITHOUT it: Git + Node download directly, and the shell comes prebuilt (no build)."
  Warn "The optional agent tools (gh, ffmpeg, yt-dlp, ...) need winget - install 'App Installer' later to add them:"
  Warn "  https://apps.microsoft.com/detail/9nblggh4nns1"
}
# NOTE: do NOT name this "Winget" - PowerShell command names are case-insensitive,
# so a function "Winget" shadows winget.exe and `winget install` inside it would
# call the function again forever (CallDepthOverflow). Call the .exe explicitly.
function WingetInstall($id) {
  # No "| Out-Null" - let winget's own download/progress bar show so the step
  # has visible movement instead of looking frozen during a multi-minute install.
  winget.exe install --id $id -e --silent --accept-package-agreements --accept-source-agreements
  Sync-Path
}

# Persist a tools dir onto the User PATH (and this session) so a portable Git/Node
# we side-load without winget is found now and on every later terminal.
function Add-UserPath($dir) {
  if (-not (Test-Path $dir)) { return }
  $up = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($up -notlike "*$dir*") { [Environment]::SetEnvironmentVariable("Path", "$up;$dir", "User") }
  if ($env:Path -notlike "*$dir*") { $env:Path = "$env:Path;$dir" }
}

# ---- dependencies ------------------------------------------------------------
Step 1 "Git"
if (Have "git") { Skip "already installed ($((git --version)))" }
elseif ($HasWinget) { WingetInstall "Git.Git"; if (Have "git") { Ok "installed" } else { Warn "installed - reopen a terminal if 'git' isn't found" } }
else {
  # No winget: fetch portable MinGit (no admin, no installer) straight from the
  # git-for-windows releases and put its cmd\ on PATH. Git is mandatory - the app
  # is delivered by git clone/pull.
  try {
    $gitDir = Join-Path $APPDIR "tools\git"
    New-Item -ItemType Directory -Force $gitDir | Out-Null
    $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/git-for-windows/git/releases/latest" -Headers @{ "User-Agent" = "bagidea-office" } -ErrorAction Stop
    $a = $rel.assets | Where-Object { $_.name -match "^MinGit-.*-64-bit\.zip$" -and $_.name -notmatch "busybox" } | Select-Object -First 1
    if (-not $a) { throw "no MinGit asset in latest release" }
    $z = Join-Path $env:TEMP $a.name
    Get-File $a.browser_download_url $z "portable Git (MinGit)"
    Expand-Archive -Path $z -DestinationPath $gitDir -Force; Remove-Item $z -ErrorAction SilentlyContinue
    Add-UserPath (Join-Path $gitDir "cmd")
    if (Have "git") { Ok "installed portable Git" } else { Warn "Git extracted but not on PATH yet - reopen a terminal" }
  } catch { Warn "couldn't auto-install Git without winget - install Git for Windows from https://git-scm.com/download/win then re-run" }
}

Step 2 "Node.js LTS"
if (Have "node") { Skip "already installed ($(node --version))" }
elseif ($HasWinget) { WingetInstall "OpenJS.NodeJS.LTS"; if (Have "node") { Ok "installed" } else { Warn "installed - reopen a terminal if 'node' isn't found" } }
else {
  # No winget: fetch the Node LTS zip (no admin, no installer) from nodejs.org and
  # put it on PATH. Node is mandatory - it runs the daemon.
  try {
    $nodeDir = Join-Path $APPDIR "tools\node"
    New-Item -ItemType Directory -Force $nodeDir | Out-Null
    $idx = Invoke-RestMethod -Uri "https://nodejs.org/dist/index.json" -ErrorAction Stop
    $lts = $idx | Where-Object { $_.lts } | Select-Object -First 1
    if (-not $lts) { throw "no LTS entry in nodejs dist index" }
    $ver = $lts.version                     # e.g. v20.17.0
    $name = "node-$ver-win-x64"
    $z = Join-Path $env:TEMP "$name.zip"
    Get-File "https://nodejs.org/dist/$ver/$name.zip" $z "Node.js LTS $ver (~30 MB)"
    Expand-Archive -Path $z -DestinationPath $nodeDir -Force; Remove-Item $z -ErrorAction SilentlyContinue
    Add-UserPath (Join-Path $nodeDir $name)  # node.exe + npm live directly in this subfolder
    if (Have "node") { Ok "installed Node $ver" } else { Warn "Node extracted but not on PATH yet - reopen a terminal" }
  } catch { Warn "couldn't auto-install Node without winget - install Node LTS from https://nodejs.org then re-run" }
}

# ---- try to fetch a PREBUILT shell binary -----------------------------------
# If a matching release binary exists we DOWNLOAD it and skip installing Rust +
# the ~2-4 GB C++ Build Tools and the multi-minute cargo build. Falls back to a
# source build on any miss (offline, old version, a fork without releases). Force
# a source build with -SkipBuildTools or $env:BAGIDEA_NO_PREBUILT=1.
$Prebuilt = $false; $prebuiltTmp = $null; $prebuiltVer = $null
$slug = Repo-Slug $Repo
if (-not ($SkipBuildTools -or $env:BAGIDEA_NO_PREBUILT) -and $slug) {
  Write-Host ""; Write-Host "  [*] Looking for a prebuilt desktop shell (skips the Rust build)..." -ForegroundColor Cyan
  try {
    $prebuiltVer = ([string](Invoke-RestMethod -Uri "https://raw.githubusercontent.com/$slug/$Branch/VERSION" -ErrorAction Stop)).Trim()
    if ($prebuiltVer) {
      $asset = "bagidea-office-shell-windows-x64.exe"
      $url = "https://github.com/$slug/releases/download/v$prebuiltVer/$asset"
      $prebuiltTmp = Join-Path $env:TEMP $asset
      if (Test-Path $prebuiltTmp) { Remove-Item $prebuiltTmp -Force }
      Get-File $url $prebuiltTmp "prebuilt shell v$prebuiltVer"
      if ((Test-Path $prebuiltTmp) -and ((Get-Item $prebuiltTmp).Length -gt 200000)) {
        $Prebuilt = $true; Ok "got the prebuilt shell v$prebuiltVer - skipping Rust + C++ Build Tools + the cargo build"
      } else {
        if ($prebuiltTmp -and (Test-Path $prebuiltTmp)) { Remove-Item $prebuiltTmp -Force }
        $prebuiltTmp = $null; Skip "no usable prebuilt - will build from source"
      }
    }
  } catch { $Prebuilt = $false; $prebuiltTmp = $null; Skip "no prebuilt for this version - will build from source" }
} else { Skip "prebuilt disabled - building the shell from source" }

Step 3 "Rust toolchain (compiles the desktop shell)"
$cargo = Join-Path $env:USERPROFILE ".cargo\bin\cargo.exe"
if ($Prebuilt) { Skip "using a prebuilt shell - Rust toolchain not needed" }
elseif (Have "cargo") { $cargo = "cargo"; Skip "already installed ($(cargo --version))" }
elseif (Test-Path $cargo) { Skip "already installed" }
else {
  if ($HasWinget) { WingetInstall "Rustlang.Rustup" }
  else {
    # No winget + no prebuilt: pull rustup-init directly (win.rustup.rs) so a
    # source build is still possible on a winget-less box.
    try {
      $ri = Join-Path $env:TEMP "rustup-init.exe"
      Get-File "https://win.rustup.rs/x86_64" $ri "Rust installer (rustup)"
      & $ri -y --default-toolchain stable-x86_64-pc-windows-msvc --profile minimal 2>$null | Out-Null
      Sync-Path
    } catch { Warn "couldn't auto-install Rust without winget - install from https://rustup.rs then re-run" }
  }
  $rustup = Join-Path $env:USERPROFILE ".cargo\bin\rustup.exe"
  if (Test-Path $rustup) { & $rustup default stable-x86_64-pc-windows-msvc 2>$null | Out-Null; Ok "installed" }
  else { Warn "Rustup may need a new terminal - re-run this script if the build fails" }
}
Sync-Path

# ---- the C++ build tools Rust needs to LINK (the usual bare-machine blocker) --
Step 4 "Visual Studio C++ Build Tools (Rust linker + Windows SDK)"
function Have-MSVC {
  $vsw = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  if (Test-Path $vsw) {
    $p = & $vsw -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    if ($p) { return $true }
  }
  return [bool](Get-ChildItem "C:\Program Files*\Microsoft Visual Studio\*\*\VC\Tools\MSVC" -Directory -ErrorAction SilentlyContinue)
}
if ($Prebuilt) { Skip "using a prebuilt shell - the ~2-4 GB C++ Build Tools are not needed" }
elseif (Have-MSVC) { Skip "C++ build tools already present" }
elseif ($SkipBuildTools) { Warn "skipped (-SkipBuildTools) - the build will fail without a C++ linker" }
elseif (-not $HasWinget) { Warn "no prebuilt shell + no winget - can't auto-install the C++ Build Tools; install 'Desktop development with C++' via the Visual Studio Installer, then re-run (or get a machine where the prebuilt release download works)" }
else {
  Warn "Not found. Installing the C++ workload now."
  Warn "This is a LARGE one-time download (~2-4 GB) and can take 10-20 minutes."
  Warn "The progress bar may sit still for a while during install - it is NOT frozen. Please leave it running."
  winget.exe install --id Microsoft.VisualStudio.2022.BuildTools -e --silent `
    --accept-package-agreements --accept-source-agreements `
    --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
  if (Have-MSVC) { Ok "C++ build tools installed" }
  else { Warn "could not confirm the build tools - if the build fails, install 'Desktop development with C++' from the Visual Studio Installer" }
}

# ---- Edge WebView2 runtime: wry renders the shell UI with it -----------------
# Pre-installed on most Win10/11, but NOT guaranteed (N/LTSC/minimal). A prebuilt
# (or source-built) shell shows a blank window without it, so ensure it once.
Step "4b" "Microsoft Edge WebView2 runtime (the shell renders its UI with it)"
function Have-WebView2 {
  foreach ($k in @(
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}")) {
    $v = (Get-ItemProperty -Path $k -Name pv -ErrorAction SilentlyContinue).pv
    if ($v -and $v -ne "0.0.0.0") { return $true }
  }
  return $false
}
if (Have-WebView2) { Skip "WebView2 already present" }
else {
  Warn "Installing the Evergreen WebView2 runtime (small download)."
  $wv = Join-Path $env:TEMP "MicrosoftEdgeWebview2Setup.exe"
  try {
    Get-File "https://go.microsoft.com/fwlink/p/?LinkId=2124703" $wv "WebView2 runtime"
    Start-Process -FilePath $wv -ArgumentList "/silent","/install" -Wait
    if (Have-WebView2) { Ok "WebView2 installed" } else { Warn "couldn't confirm WebView2 - if the office window is blank, install the Evergreen WebView2 runtime" }
  } catch { Warn "WebView2 download failed - if the office window is blank, install the Evergreen WebView2 runtime" }
}

Step 5 "Godot $GODOTV (renders the office world)"
$gdir = Join-Path $APPDIR "tools\godot"
$gexe = Join-Path $gdir "Godot_v$GODOTV-stable_win64.exe"
if (Test-Path $gexe) { Skip "already installed" }
else {
  New-Item -ItemType Directory -Force $gdir | Out-Null
  $z = Join-Path $env:TEMP "godot.zip"
  try {
    Get-File "https://github.com/godotengine/godot/releases/download/$GODOTV-stable/Godot_v$GODOTV-stable_win64.exe.zip" $z "Godot $GODOTV (~120 MB)"
    Write-Host "      extracting Godot (a few seconds)..." -ForegroundColor DarkGray
    Expand-Archive -Path $z -DestinationPath $gdir -Force; Remove-Item $z -ErrorAction SilentlyContinue
    if (Test-Path $gexe) { Ok "installed" } else { Warn "extracted but exe not found" }
  } catch { Warn "download failed - check your connection and re-run" }
}
# Only publish the env var when the exe is REAL — a pointer at a failed
# download used to poison every Godot fallback (shell + daemon trusted it).
if (Test-Path $gexe) {
  [Environment]::SetEnvironmentVariable("BAGIDEA_GODOT", $gexe, "User")
  $env:BAGIDEA_GODOT = $gexe
}

Step 6 "Claude Code CLI (the brain of every agent)"
$npmExe = Npm-Exe
if (Have "claude") { Skip "already installed" }
elseif ($npmExe) {
  Write-Host "      installing via npm (about a minute)..." -ForegroundColor DarkGray
  & $npmExe install -g @anthropic-ai/claude-code
  Sync-Path
  # VERIFY. Every agent in the office is a claude session, so if this did not
  # land, nothing works - and saying "installed" anyway is how that turns into a
  # mystery instead of a message.
  if (Have "claude") {
    Ok "installed - Claude login is OPTIONAL: only if you run Claude models. GLM/DeepSeek/etc. need only their API key in Settings"
  } else {
    Warn "npm finished but the 'claude' command is still not on PATH."
    Warn "The office needs it: EVERY agent is a Claude Code session."
    Write-Host "      Open a NEW terminal and run:  npm.cmd install -g @anthropic-ai/claude-code" -ForegroundColor Yellow
  }
}
else { Warn "npm not on PATH yet - reopen a terminal and run: npm.cmd install -g @anthropic-ai/claude-code" }

# ---- handy CLI tools the agents can use (optional, best-effort) ---------------
# Each is installed via winget if missing; a failure is fine — agents just skip
# whatever isn't present. These widen what the office can actually DO (media,
# docs, data, GitHub) without writing any new code.
Write-Host "`n  [+] Handy CLI tools for agents (gh, ffmpeg, yt-dlp, pandoc, jq, ImageMagick - optional)" -ForegroundColor Cyan
if (-not $HasWinget) {
  Skip "optional agent tools (gh, ffmpeg, yt-dlp, jq, pandoc, ImageMagick, LibreOffice) need winget - skipped"
  Skip "install 'App Installer' from the Store later to add them: https://apps.microsoft.com/detail/9nblggh4nns1"
}
else {
foreach ($t in @(
    @{ id = "GitHub.cli";               cmd = "gh" },
    @{ id = "Gyan.FFmpeg";              cmd = "ffmpeg" },
    @{ id = "yt-dlp.yt-dlp";            cmd = "yt-dlp" },
    @{ id = "jqlang.jq";                cmd = "jq" },
    @{ id = "JohnMacFarlane.Pandoc";    cmd = "pandoc" },
    @{ id = "ImageMagick.ImageMagick";  cmd = "magick" }
  )) {
  if (Have $t.cmd) { Write-Host "      - $($t.cmd) already present" -ForegroundColor DarkGray; continue }
  Write-Host "      - installing $($t.cmd)..." -ForegroundColor DarkGray
  try { winget.exe install --id $t.id -e --silent --accept-package-agreements --accept-source-agreements | Out-Null } catch {}
}
Sync-Path

# LibreOffice — lets agents READ + CONVERT Office files headlessly (xlsx/docx/pptx -> csv/pdf/...).
# Detected by path (it doesn't put soffice on PATH itself), so we add its program dir too.
$loDir = "C:\Program Files\LibreOffice\program"
$loExe = Join-Path $loDir "soffice.exe"
if (Test-Path $loExe) { Write-Host "      - LibreOffice already present" -ForegroundColor DarkGray }
else {
  Write-Host "      - installing LibreOffice (Office-file support, ~350 MB, optional)..." -ForegroundColor DarkGray
  try { winget.exe install --id TheDocumentFoundation.LibreOffice -e --silent --accept-package-agreements --accept-source-agreements | Out-Null } catch {}
}
}  # end if $HasWinget
if (Test-Path $loExe) {
  $up = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($up -notlike "*LibreOffice\program*") {
    [Environment]::SetEnvironmentVariable("Path", "$up;$loDir", "User"); Sync-Path
    Write-Host "      - added soffice to PATH" -ForegroundColor DarkGray
  }
}
Ok "CLI tools step done (any that failed are optional)"

# ---- stop a running instance first -------------------------------------------
# A re-install while the office is open locks the very files we update + rebuild
# + re-brand below (git reset, the shell exe, the branded BagIdeaOffice.exe) ->
# "being used by another process". Stop the whole suite first; no-op on a fresh
# machine. (Branded exe is BagIdeaOffice.exe, not "Godot*".)
Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -eq "node.exe" -and $_.CommandLine -match "server\.js") -or
  $_.Name -eq "bagidea-office-shell.exe" -or
  $_.Name -eq "BagIdeaOffice.exe" -or
  $_.Name -like "Godot*"
} | ForEach-Object { taskkill /PID $_.ProcessId /T /F 2>$null | Out-Null }
Start-Sleep 1

# ---- the app: clone (or pull) ------------------------------------------------
Step 7 "Get the app -> $APP"
if (-not (Have "git")) { Warn "git not on PATH yet - reopen a terminal and re-run this script"; exit 1 }
New-Item -ItemType Directory -Force $APPDIR | Out-Null
if (Test-Path (Join-Path $APP ".git")) {
  Push-Location $APP
  git -c gc.auto=0 fetch --depth 1 origin $Branch 2>$null
  git reset --hard "origin/$Branch" 2>$null
  Pop-Location
  Ok "updated existing clone (git pull) - your data is untouched"
} elseif (Test-Path $APP) {
  $backup = Join-Path $env:TEMP "bagidea_userdata"
  if (Test-Path $backup) { Remove-Item -Recurse -Force $backup }
  New-Item -ItemType Directory -Force $backup | Out-Null
  foreach ($f in @("registry.json","sessions.json","projects.json","jobs.json",
      "calendar.json","notes.json","layout.json","stats.json","proposals.json")) {
    $p = Join-Path $APP "daemon\$f"; if (Test-Path $p) { Copy-Item $p (Join-Path $backup $f) -Force }
  }
  if (Test-Path (Join-Path $APP "daemon\i18n")) { Copy-Item (Join-Path $APP "daemon\i18n") (Join-Path $backup "i18n") -Recurse -Force }
  Remove-Item -Recurse -Force $APP
  git clone --depth 1 --branch $Branch $Repo $APP
  Get-ChildItem $backup -File | ForEach-Object { Copy-Item $_.FullName (Join-Path $APP ("daemon\" + $_.Name)) -Force }
  if (Test-Path (Join-Path $backup "i18n")) { Copy-Item (Join-Path $backup "i18n") (Join-Path $APP "daemon\i18n") -Recurse -Force }
  Ok "cloned + restored your previous data"
} else {
  git clone --depth 1 --branch $Branch $Repo $APP
  Ok "cloned to $APP"
}

# Harden git for a DEPLOYED checkout on Windows. Never auto-gc: a repack kicked off
# mid-pull races antivirus / a still-open pack handle and fails to delete the old
# pack -> "Unlink of file '.git/objects/pack/pack-*.idx' failed. Should I try again?
# (y/n)" loops forever and the update hangs (reported in the field). fscache + long
# paths are the usual Windows git hardening on top.
if (Test-Path (Join-Path $APP ".git")) {
  git -C $APP config gc.auto 0          2>$null
  git -C $APP config gc.autoDetach false 2>$null
  git -C $APP config core.fscache true   2>$null
  git -C $APP config core.longpaths true 2>$null
}

# ---- drop the prebuilt shell into place (if we fetched one above) ------------
if ($Prebuilt -and $prebuiltTmp -and (Test-Path $prebuiltTmp)) {
  $relDir = Join-Path $APP "shell\target\release"
  New-Item -ItemType Directory -Force $relDir | Out-Null
  try {
    Copy-Item $prebuiltTmp (Join-Path $relDir "bagidea-office-shell.exe") -Force -ErrorAction Stop
    Remove-Item $prebuiltTmp -Force -ErrorAction SilentlyContinue
  } catch {
    Warn "couldn't place the prebuilt shell ($($_.Exception.Message)) - will build from source"
    $Prebuilt = $false
  }
}

# ---- optional art pack (licensed packs are NOT in the public repo) -----------
Step "7b" "Art assets (characters / 3D models / sounds)"
$assetDir = Join-Path $APP "godot\assets"
if ($Assets) {
  try {
    $srcZip = $Assets
    if ($Assets -match "^https?://") {
      $srcZip = Join-Path $env:TEMP "bagidea-assets.zip"
      Get-File $Assets $srcZip "art pack"
    }
    if (Test-Path $srcZip -PathType Container) {
      Copy-Item (Join-Path $srcZip "*") $assetDir -Recurse -Force
      Ok "copied art pack into godot\assets"
    } elseif (Test-Path $srcZip) {
      Expand-Archive -Path $srcZip -DestinationPath $assetDir -Force
      Ok "art pack installed into godot\assets"
    } else {
      Warn "art pack not found: $Assets (skipping; procedural visuals)"
    }
  } catch {
    Warn "art pack step failed (skipping; procedural visuals)"
  }
} elseif (Test-Path (Join-Path $assetDir "characters")) {
  Skip "art assets are bundled with the install"
} else {
  Skip "no art assets found; using built-in procedural visuals"
}

# ---- build the Rust shell ----------------------------------------------------
Step 8 "Build the desktop shell (first build can take a few minutes)"
$exe = Join-Path $APP "shell\target\release\bagidea-office-shell.exe"
if ($Prebuilt -and (Test-Path $exe)) {
  Ok "using the prebuilt shell - no build needed -> $exe"
} else {
  if ($Prebuilt) { Warn "the prebuilt shell didn't land - falling back to a source build" }
  if (Have "cargo") { $cargo = "cargo" }
  Push-Location (Join-Path $APP "shell")
  Write-Host "      compiling - you'll see 'Compiling <crate>' lines scroll; the first build is 3-8 min (NOT frozen)..." -ForegroundColor DarkGray
  & $cargo build --release
  Pop-Location
  if (Test-Path $exe) { Ok "built -> $exe" }
  else {
    Warn "BUILD FAILED. Most often this means the C++ linker is missing."
    Warn "Fix it, then re-run this script:"
    Warn "  winget install Microsoft.VisualStudio.2022.BuildTools --override `"--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended`""
    Warn "  (or open the Visual Studio Installer and add 'Desktop development with C++')"
    Warn "Then reopen a terminal and run this installer again."
  }
}

# ---- branded window/taskbar icon (BAG IDEA, never a Godot icon) --------------
Step 9 "Brand the window icon"
$bindir  = Join-Path $APP "godot\bin"
$branded = Join-Path $bindir "BagIdeaOffice.exe"
$ico     = Join-Path $APP "godot\assets\brand\logo.ico"
if ((Test-Path $gexe) -and (Test-Path $ico)) {
  New-Item -ItemType Directory -Force $bindir | Out-Null
  $rcedit = Join-Path $env:TEMP "rcedit-x64.exe"
  if (-not (Test-Path $rcedit)) {
    try { Invoke-WebRequest -Uri "https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe" -OutFile $rcedit } catch {}
  }
  $copied = $false
  try { Copy-Item $gexe $branded -Force -ErrorAction Stop; $copied = $true }
  catch {
    if (Test-Path $branded) { Skip "branded exe in use (office running?) - kept the existing branded exe" }
    else { Warn "couldn't create branded exe: $($_.Exception.Message)" }
  }
  if ($copied -and (Test-Path $rcedit)) {
    & $rcedit $branded --set-icon $ico --set-version-string "FileDescription" "BagIdea Office" --set-version-string "ProductName" "BagIdea Office" 2>$null
    Ok "branded exe ready - the taskbar shows BAG IDEA from launch"
  } elseif ($copied) { Warn "couldn't fetch rcedit - the default Godot icon will be used" }
} else { Skip "skipped (Godot or logo.ico missing)" }

# ---- hook paths: the permission/notify hooks use absolute paths --------------
# The committed settings.json carry the dev machine's path; regenerate them so
# the permission hook (Security Center) and task hooks (Mission Control) resolve
# to THIS install. (A regex rewrite was unreliable against the escaped quotes in
# the JSON command strings, which silently left the hooks broken.)
Step 10 "Point the Claude hooks at this install"
# Use $APP (the just-cloned repo), not $PSScriptRoot: the web one-liner pipes
# this script through `iex`, where $PSScriptRoot is empty.
& (Join-Path $APP "installer\wire-hooks.ps1") -App $APP
Ok "hooks now resolve to the install path"

# ---- CLI on PATH + Start Menu shortcut ---------------------------------------
Step 11 "Add 'bagidea' to PATH + Start Menu shortcut"
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$APP*") {
  [Environment]::SetEnvironmentVariable("Path", "$userPath;$APP", "User"); Ok "added bagidea to PATH (open a new terminal to use it)" }
else { Skip "already on PATH" }
if (Test-Path $exe) {
  $ws = New-Object -ComObject WScript.Shell
  $lnk = $ws.CreateShortcut([IO.Path]::Combine($env:APPDATA, "Microsoft\Windows\Start Menu\Programs\BagIdea Office.lnk"))
  $lnk.TargetPath = $exe; $lnk.WorkingDirectory = Split-Path $exe; $lnk.Save()
  Ok "created Start Menu shortcut"
}

# ---- launch with Windows (default ON for fresh installs) ---------------------
# The same HKCU Run value the tray + `bagidea startup` toggle use. We set it only when
# it's NOT already present, so re-running never clobbers a user's later "off" choice.
# Fix: a fresh install used to not come back after a reboot.
Step 12 "Launch automatically with Windows"
if (Test-Path $exe) {
  $runKey = "HKCU\Software\Microsoft\Windows\CurrentVersion\Run"
  reg query $runKey /v BagIdeaOffice 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    reg add $runKey /v BagIdeaOffice /t REG_SZ /d "$exe" /f | Out-Null
    Ok "the office will start with Windows (turn off anytime: bagidea startup off)"
  } else { Skip "auto-start already set" }
} else { Skip "shell exe not built - skipped" }

# ---- register in Windows Settings > Apps (so "uninstall" is discoverable) ----
# Without this the app is invisible in Windows Settings, and the only way out is
# the `bagidea uninstall` CLI command — which most people don't know about, so
# they report "I can't uninstall". Register an Uninstall entry whose UninstallString
# runs our uninstaller; Windows Settings then shows "BagIdea Office" with an
# Uninstall button that does the right thing (PATH, Run key, shortcut, files).
Step 13 "Registering in Windows Settings"
if (Test-Path $exe) {
  $Ver = if (Test-Path "$APP\VERSION") { (Get-Content "$APP\VERSION" -Raw).Trim() } else { "" }
  $uk = "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\BagIdeaOffice"
  $uninstallCmd = 'powershell -NoProfile -ExecutionPolicy Bypass -File "' + ($APP -replace '"','') + '\installer\uninstall.ps1"'
  reg add $uk /v DisplayName       /t REG_SZ   /d "BagIdea Office" /f | Out-Null
  reg add $uk /v DisplayVersion    /t REG_SZ   /d "$Ver" /f | Out-Null
  reg add $uk /v Publisher         /t REG_SZ   /d "BagIdea Innovation Co., Ltd." /f | Out-Null
  reg add $uk /v DisplayIcon       /t REG_SZ   /d "$exe" /f | Out-Null
  reg add $uk /v InstallLocation   /t REG_SZ   /d "$APP" /f | Out-Null
  reg add $uk /v UninstallString   /t REG_SZ   /d "$uninstallCmd" /f | Out-Null
  reg add $uk /v NoModify          /t REG_DWORD /d 1 /f | Out-Null
  reg add $uk /v NoRepair          /t REG_DWORD /d 1 /f | Out-Null
  Ok "listed in Windows Settings > Apps (uninstall from there, or: bagidea uninstall)"
} else { Skip "shell exe not built - skipped" }

# ---- execution policy, for the user's OWN terminal ---------------------------
# We fixed our own session at the top, but the next thing we tell them to do is
# open a terminal and type `claude` - and a claude installed by npm is
# claude.ps1, which a Restricted policy refuses to run. Same for `npm`. So:
# check, explain, and ASK. Lowering a machine's script policy behind someone's
# back is not ours to do, and on a customer's machine it is not even theirs.
$policyBlocks = $false
try {
  $eff = Get-ExecutionPolicy
  if ($eff -eq "Restricted" -or $eff -eq "AllSigned") { $policyBlocks = $true }
} catch {}
if ($policyBlocks) {
  Write-Host ""
  Write-Host "  ! PowerShell script execution is $eff on this machine." -ForegroundColor Yellow
  Write-Host "    The office itself is fine - it runs claude through cmd, not PowerShell." -ForegroundColor DarkGray
  Write-Host '    But YOUR terminal will refuse claude and npm, because npm installs them' -ForegroundColor DarkGray
  Write-Host '    as .ps1 scripts. Two ways out - either is fine:' -ForegroundColor DarkGray
  Write-Host "      a) type claude.cmd / npm.cmd instead (no settings changed), or" -ForegroundColor Cyan
  Write-Host "      b) allow local scripts for your user only:" -ForegroundColor Cyan
  Write-Host "         Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser" -ForegroundColor Cyan
  if ($env:BAGIDEA_SET_EXECUTION_POLICY -eq "1") {
    try {
      Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force -ErrorAction Stop
      Ok "set to RemoteSigned for your user (BAGIDEA_SET_EXECUTION_POLICY=1)"
    } catch { Warn "could not set it: $($_.Exception.Message)" }
  } else {
    $sp = Read-Host "  Do (b) now for your user? (y/n)"
    if ($sp -eq "y") {
      try {
        Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force -ErrorAction Stop
        Ok "done - RemoteSigned, current user only"
      } catch { Warn "could not set it (a Group Policy may own this): $($_.Exception.Message)" }
    } else { Skip "left as-is - use claude.cmd / npm.cmd" }
  }
}

# ---- summary -----------------------------------------------------------------
Write-Host ""
if (Test-Path $exe) {
  Write-Host "  =============================================" -ForegroundColor Green
  Write-Host "   Done - BagIdea Office is installed!" -ForegroundColor Green
  Write-Host "  =============================================" -ForegroundColor Green
  Write-Host "   1) Open a NEW terminal and run:  claude   (log in to Claude, first time only)" -ForegroundColor Yellow
  Write-Host "   2) Then:  bagidea start   (or Start Menu > BagIdea Office)" -ForegroundColor Cyan
  Write-Host ""
  $go = Read-Host "  Launch it now? (y/n)"
  if ($go -eq "y") { Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) }
} else {
  Write-Host "  =============================================" -ForegroundColor Yellow
  Write-Host "   Almost there - the shell wasn't built yet." -ForegroundColor Yellow
  Write-Host "  =============================================" -ForegroundColor Yellow
  Write-Host "   See the build hint above (usually the C++ Build Tools)," -ForegroundColor Yellow
  Write-Host "   then open a NEW terminal and run this installer again." -ForegroundColor Yellow
  Write-Host "   Full guide + fixes: https://bagidea.github.io/bagidea-office/docs.html#install-win" -ForegroundColor Cyan
}
Write-Host ""
