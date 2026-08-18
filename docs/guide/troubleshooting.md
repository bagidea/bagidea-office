# Common problems

## Installation problems

The installer is designed to "finish in one pass on a clean machine," but some
machines have different conditions. Below are all the common symptoms and how to
fix them — almost everything is solved by **opening a new terminal and re-running
the installer** (re-running is safe; no data is lost).

**`irm ... | iex` shows an execution policy error**
- Run this line instead:
  ```powershell
  powershell -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/bagidea/bagidea-office/main/installer/install.ps1 | iex"
  ```

**`winget not found`**
- Older Windows doesn't have winget yet — install **App Installer** from the Microsoft Store
  (`https://apps.microsoft.com/detail/9nblggh4nns1`), then open a new terminal and re-run.

**Git/Node installed but `git`/`node` not found when it continues**
- winget writes PATH to the registry, but the existing terminal doesn't see it yet — the
  installer refreshes PATH for you within the same pass, but if it still happens,
  **close the terminal, open a new one, and re-run** and it will definitely be fixed.

**`BUILD FAILED` / `cargo build` shows `error: linker 'link.exe' not found` or `link.exe returned exit code`**
- This is the most common symptom: Rust needs Visual Studio's **C++ linker**.
- This version of the installer installs the **VS C++ Build Tools** automatically, but if that
  round was skipped/incomplete, install it yourself:
  ```powershell
  winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
  ```
  Or open the **Visual Studio Installer** → Modify → check **Desktop development with C++** → Install
- When done, **open a new terminal** (so the build environment variables load) and re-run the installer.

**`cargo`/`rustup` not found right after installing Rust**
- Open a new terminal, or temporarily run: `$env:Path += ";$env:USERPROFILE\.cargo\bin"` then re-run.

**Godot download hangs/fails**
- A network/firewall issue while downloading the file from GitHub releases — check your
  connection and re-run (the installer skips steps that are already done and downloads only what's missing).

**Windows Security / Defender flags or quarantines the wallpaper or app**
- This is a **false positive**. Everything is open source and readable in the repo, and the
  binaries are **not yet code-signed**. Two things trip Windows heuristics: the branded
  wallpaper engine (`BagIdeaOffice.exe`, a re-iconed Godot) and the way it paints behind your
  desktop icons (a standard `SetParent`-onto-`WorkerW` wallpaper technique) — both look unusual,
  so Defender sometimes quarantines the exe even though it's harmless.
- **If Defender quarantined it** (the wallpaper won't start, or a "Threat found" toast appears):
  open **Windows Security → Virus & threat protection → Protection history**, find the
  BagIdea/Godot item, choose **Actions → Allow on device** (or **Restore**), then `bagidea start`.
- **To stop it recurring**, add the install folder to Defender's exclusions (run in PowerShell):
  ```powershell
  Add-MpPreference -ExclusionPath "$env:LOCALAPPDATA\BagIdeaOffice"
  ```
- **SmartScreen "protected your PC"** on install: **More info → Run anyway**, or download
  `install.ps1`, read it first, then run it yourself.
- Code signing (an Authenticode certificate) is on the roadmap and will remove these prompts.

**macOS: "can't be opened because Apple cannot check it for malicious software"**
- The prebuilt binary is unsigned for now. The installer already clears the download
  quarantine, but if Gatekeeper still blocks it: **right-click the app → Open** (then
  **Open** again in the dialog), or run
  `xattr -dr com.apple.quarantine ~/BagIdeaOffice/shell/target/release/bagidea-office-shell`.

**Build succeeds but typing `bagidea` isn't found**
- The command was just added to PATH — **open a new terminal** and try again
  (or open it from the Start Menu → "BagIdea Office").

**Want to start completely over**
- Delete `%LOCALAPPDATA%\BagIdeaOffice` and re-run the installer (the data in there will be lost too —
  back up `app\daemon\*.json` first if you want to keep the registry/sessions).

## Linux (experimental 🧪)

**Shell won't compile (missing WebKitGTK, etc.)**
- The installer installs `libwebkit2gtk-4.1-dev` (newer Ubuntu) or `4.0` (older) automatically —
  if it fails, install it yourself and re-run `./build-linux.sh`: `sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev libsoup-3.0-dev build-essential pkg-config`

**`bagidea: command not found`**
- The installer creates a symlink at `~/.local/bin/bagidea` — open a new terminal, or
  `export PATH="$HOME/.local/bin:$PATH"`

**The wallpaper doesn't attach to the background (it's a floating window)**
- Check that you're on X11: `echo $XDG_SESSION_TYPE` → if it says `x11` you need `wmctrl`/`xdotool`
  (`sudo apt install wmctrl xdotool`). If it says `wayland` = it uses a fullscreen bottom-most window fallback (by design).
- A transparent orb requires a running compositor (most desktop environments already have one).

**No sound (`bagidea say`)**
- Install a player: `sudo apt install pulseaudio-utils alsa-utils`

> Hit another problem on Linux: file an [issue](https://github.com/bagidea/bagidea-office/issues)
> with your distro, desktop, and `echo $XDG_SESSION_TYPE`

## Program / wallpaper

**Nothing happens when I open it / the wallpaper doesn't change**
- Opened it twice? The program is single-instance — the second one quietly exits.
  Check the tray icon first (it may already be running).
- Godot not found: set the `BAGIDEA_GODOT` env var to point at the Godot 4.6.x exe,
  then reopen (the installer sets this automatically).
- `bagidea status` tells you whether the daemon is up.

**Want to temporarily hide the office (meeting/screen recording)**
- Right-click the tray icon — two hide levels, and agents keep working under both:
  - **Hide everything** — wallpaper, chat window and chat head all disappear.
  - **Hide chat + button (wallpaper stays)** — only the chat window and the floating
    chat head disappear; the wallpaper office keeps living on your desktop.
- Click the item again to bring things back.

**The chat window is frozen — it draws but nothing reacts**
- Right-click the tray icon → **Reload chat window**. It rebuilds the page in place
  and puts the window back to its normal size and position. The daemon is untouched,
  so agents that are mid-task keep running — try this before **Restart office**.
- Seen after switching between window modes (⛶ large / 📡 feed) on Windows: the
  window keeps resizing but the page stays on its last drawn frame. 0.9.51 removed
  the two things the shell did to that window that WebView2 doesn't support
  (flipping the window's resizable style and dimming it with a layered-window
  alpha — the feed's see-through look is plain CSS now). If it still happens,
  please open an issue with what you did just before it froze.

**The 3D Editor won't open on this machine**
- Fixed in 0.9.45: the launcher now checks every place the Godot engine can live
  (the app's own copy, `BAGIDEA_GODOT`, the installer's tools folder) and tells you
  when none exists instead of failing silently. If you still see an error, re-run the
  installer or point `BAGIDEA_GODOT` at a Godot 4.6.x executable.

**How to close the program completely**
- The only way is the tray icon → **Exit BagIdea Office** (or `bagidea stop`) —
  closes the whole suite + restores your original wallpaper.

## Agents

**An agent doesn't respond at all / task.failed immediately**
- Are you logged into Claude yet? Open a terminal and run `claude` once.
- Out of quota/credit has the same symptom — try `claude -p "hi"` to see the answer directly.

**A permission card pops up even though I checked the tools**
- Did you check them in the "edit agent" screen and save? Tools you grant = always silent.
- Tools you *didn't* check still ask as usual — click **✓✓ Always** to remember it permanently.

**I gave a command but it's silent, no activity visible**
- Look at the 🔵 NOW WORKING / 📡 feed bar — the task may be running.
- `bagidea feed` in the terminal also shows all live events.

## Projects

**Clicking ▶ shows "No conversation found to continue"**
- This is a limitation of `claude -c` with sessions created headless — the current version's ▶
  button uses `claude --resume <id>` directly now, so you shouldn't see it again
  (if you do = old version → `bagidea update`).

**Deleting a project (🗑) fails**
- A program is locking a file — the system closes a dev server the agent left running and
  retries automatically. If it still fails it shows an error in the row: close any terminal/Explorer
  stuck in that folder and click again.

**The window state (open/closed) is out of sync**
- The system sweeps every 5 seconds — wait a moment, or close and reopen the PROJECTS tab.

## Voice (Right Ctrl)

**Nothing happens when I press it**
- Have you turned on Windows Voice Typing? Settings → Time & language → Speech
  → online speech recognition + install the Thai language pack.
- Try pressing `Win+H` directly in any text field — if nothing appears, the OS feature isn't ready yet.
- Key conflict? Change the key in ⚙ → AGENTS → PUSH-TO-TALK HOTKEY.

**My speech goes into another program**
- The current version forces focus before opening the mic — if you still hit it, click the
  chat window once before pressing Right Ctrl, and feel free to file an issue.

## Channels

**Telegram shows error: bad token** — the token is wrong/expired; get a new one from @BotFather
**Discord stuck connecting** — you forgot to enable MESSAGE CONTENT INTENT on the Bot page
**LINE doesn't fire** — the webhook URL must be public HTTPS and end with
`/channels/line/webhook`; check that cloudflared is still running

## View raw logs

- All events: `daemon/journal.jsonl`
- Chat history: `daemon/sessions.json`
- Run the daemon yourself to watch the live console: stop the program first, then `node daemon\server.js`
