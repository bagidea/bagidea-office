# BagIdea Office - uninstaller.
# Removes ONLY this app's own footprint:
#   - stops the running suite (shell + wallpaper + daemon)
#   - removes "Start with Windows" (HKCU Run key)
#   - removes the bagidea command from your PATH + the BAGIDEA_GODOT env var
#   - removes the Start Menu shortcut
#   - deletes the app folder %LOCALAPPDATA%\BagIdeaOffice
# It does NOT touch shared tools (Git / Node / Rust / Claude / Godot install).
# Run via:  bagidea uninstall   (add -KeepData to back up your data first)
param([switch]$KeepData)
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$APPDIR = Join-Path $env:LOCALAPPDATA "BagIdeaOffice"
$APP    = Join-Path $APPDIR "app"

Write-Host ""
Write-Host "  ===== BagIdea Office - UNINSTALL =====" -ForegroundColor Cyan
Start-Sleep 2   # let the CLI process that launched us exit and release files

# 1) Stop the whole suite (so no file stays locked).
Write-Host "  [1/5] Stopping the app..." -ForegroundColor DarkCyan
Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -eq "node.exe" -and $_.CommandLine -match "server\.js") -or
  $_.Name -eq "bagidea-office-shell.exe" -or
  $_.Name -eq "BagIdeaOffice.exe" -or
  $_.Name -like "Godot*"
} | ForEach-Object { taskkill /PID $_.ProcessId /T /F 2>$null | Out-Null }
Start-Sleep 1

# 2) Start-with-Windows registry value + our Windows Settings > Apps entry.
Write-Host "  [2/5] Removing start-with-Windows + Apps entry..." -ForegroundColor DarkCyan
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v BagIdeaOffice /f 2>$null | Out-Null
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\BagIdeaOffice" /f 2>$null | Out-Null

# 3) PATH entry + env var.
Write-Host "  [3/5] Removing the bagidea command from PATH..." -ForegroundColor DarkCyan
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath) {
  $keep = $userPath -split ';' | Where-Object { $_ -and ($_.TrimEnd('\') -ne $APP.TrimEnd('\')) }
  [Environment]::SetEnvironmentVariable("Path", ($keep -join ';'), "User")
}
[Environment]::SetEnvironmentVariable("BAGIDEA_GODOT", $null, "User")

# 4) Start Menu shortcut.
Write-Host "  [4/5] Removing the Start Menu shortcut..." -ForegroundColor DarkCyan
$lnk = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\BagIdea Office.lnk"
if (Test-Path $lnk) { Remove-Item $lnk -Force -ErrorAction SilentlyContinue }

# 5) The app files (optionally back up your data first).
if ($KeepData -and (Test-Path (Join-Path $APP "daemon"))) {
  $backup = Join-Path $env:USERPROFILE "BagIdeaOffice-data-backup"
  Write-Host "  [5/5] Backing up your data -> $backup, then removing files..." -ForegroundColor DarkCyan
  New-Item -ItemType Directory -Force $backup | Out-Null
  foreach ($f in @("registry.json","sessions.json","projects.json","jobs.json",
      "calendar.json","notes.json","layout.json","stats.json","proposals.json","presets.json")) {
    $p = Join-Path $APP "daemon\$f"; if (Test-Path $p) { Copy-Item $p $backup -Force }
  }
  if (Test-Path (Join-Path $APP "daemon\tooldetail")) { Copy-Item (Join-Path $APP "daemon\tooldetail") (Join-Path $backup "tooldetail") -Recurse -Force }
  if (Test-Path (Join-Path $APP "workspace")) { Copy-Item (Join-Path $APP "workspace") (Join-Path $backup "workspace") -Recurse -Force }
} else {
  Write-Host "  [5/5] Removing all files..." -ForegroundColor DarkCyan
}
if (Test-Path $APPDIR) { Remove-Item -Recurse -Force $APPDIR -ErrorAction SilentlyContinue }

Write-Host ""
if (Test-Path $APPDIR) {
  Write-Host "  ! Some files could not be deleted (still in use?). Close any open" -ForegroundColor Yellow
  Write-Host "    BagIdea windows/terminals and delete this folder by hand:" -ForegroundColor Yellow
  Write-Host "    $APPDIR" -ForegroundColor Yellow
} else {
  Write-Host "  BagIdea Office has been removed." -ForegroundColor Green
  if ($KeepData) { Write-Host "  Your data backup: $env:USERPROFILE\BagIdeaOffice-data-backup" -ForegroundColor Cyan }
  Write-Host "  (Git / Node / Rust / Claude were left installed - remove them via winget if you want.)" -ForegroundColor DarkGray
  Write-Host "  Open a NEW terminal so the PATH change takes effect." -ForegroundColor DarkGray
}
Write-Host ""
