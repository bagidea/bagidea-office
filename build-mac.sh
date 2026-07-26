#!/usr/bin/env bash
# BagIdea Office — macOS One-Shot Installer & Build Script.
#   • checks for dependencies (Homebrew, Node, Rust)
#   • downloads Godot 4.6.3 automatically if missing
#   • builds the DYLD wallpaper shim and the native shell
#   • wires Claude Code hooks and sets up the 'bagidea' CLI
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "  ==========================================="
echo "   BagIdea Office - macOS INSTALLER"
echo "  ==========================================="

# ---- 1. Check Dependencies ---------------------------------------------------
echo "[1/6] checking dependencies..."

if ! command -v brew &> /dev/null; then
    echo "    ! Homebrew not found. Please install it first: https://brew.sh"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "    + installing Node.js..."
    brew install node
fi

# ---- try a prebuilt UNIVERSAL shell (skips installing Rust + the cargo build) ----
# Falls back to a source build on any miss (offline, fork without releases, asset
# not uploaded yet). Force a source build with BAGIDEA_NO_PREBUILT=1.
PREBUILT=0
if [ -z "$BAGIDEA_NO_PREBUILT" ]; then
  SLUG=$(git -C "$ROOT" remote get-url origin 2>/dev/null | sed -nE 's#.*github\.com[:/]+([^/]+)/([^/.]+).*#\1/\2#p')
  VER=$(head -n1 "$ROOT/VERSION" 2>/dev/null | tr -d ' \r\n')
  if [ -n "$SLUG" ] && [ -n "$VER" ]; then
    BASE="https://github.com/$SLUG/releases/download/v$VER"
    mkdir -p "$ROOT/shell/target/release" "$ROOT/shell/macos"
    echo "    + looking for a prebuilt shell v$VER (universal)…"
    if curl -fSL --retry 3 -o "$ROOT/shell/target/release/bagidea-office-shell" "$BASE/bagidea-office-shell-macos-universal" \
       && curl -fSL --retry 3 -o "$ROOT/shell/macos/libwallpaper_shim.dylib" "$BASE/libwallpaper_shim-macos-universal.dylib"; then
      chmod +x "$ROOT/shell/target/release/bagidea-office-shell"
      codesign --force --sign - "$ROOT/shell/macos/libwallpaper_shim.dylib" 2>/dev/null || true
      codesign --force --sign - "$ROOT/shell/target/release/bagidea-office-shell" 2>/dev/null || true
      # Clear the download quarantine so Gatekeeper allows the unsigned binary.
      xattr -dr com.apple.quarantine "$ROOT/shell/target/release/bagidea-office-shell" "$ROOT/shell/macos/libwallpaper_shim.dylib" 2>/dev/null || true
      PREBUILT=1
      echo "    → got the prebuilt shell (skipping Rust + the cargo build)"
    else
      echo "    - no prebuilt available; will build from source"
      rm -f "$ROOT/shell/target/release/bagidea-office-shell" "$ROOT/shell/macos/libwallpaper_shim.dylib"
    fi
  fi
fi

if [ "$PREBUILT" != "1" ] && ! command -v cargo &> /dev/null; then
    echo "    + installing Rust..."
    # The 'rustup' homebrew formula is deprecated/removed in many taps.
    # We use the official rustup installer instead.
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path
    if [ -f "$HOME/.cargo/env" ]; then . "$HOME/.cargo/env"; fi
fi
# macOS ships /bin/bash 3.2, where `.`/`source` is a POSIX *special* builtin: a
# missing-file failure exits the shell IMMEDIATELY, before `|| true` can catch it.
# With a prebuilt shell, Rust is never installed and this file never exists — so we
# MUST test first, not guard with `|| true` (which silently killed installs — #38,
# and the same line reported under #2). The `if` form (not `[ -f … ] && …`) is
# required so an absent file doesn't leave a false exit status that trips `set -e`.
if [ -f "$HOME/.cargo/env" ]; then . "$HOME/.cargo/env"; fi

# ---- 2. Download Godot -------------------------------------------------------
GODOT_DIR="$ROOT/godot/bin-mac"
GODOT_APP="$GODOT_DIR/Godot.app"
GODOT_ZIP="$ROOT/godot/godot_macos.zip"

echo "[2/6] checking Godot engine..."
if [ ! -d "$GODOT_APP" ]; then
    echo "    + downloading Godot 4.6.3 (universal) - about 120 MB; a progress bar follows. This takes a few minutes, it is NOT frozen..."
    mkdir -p "$GODOT_DIR"
    # --progress-bar gives a visible moving bar so the download never looks stuck.
    curl -L --progress-bar "https://github.com/godotengine/godot/releases/download/4.6.3-stable/Godot_v4.6.3-stable_macos.universal.zip" -o "$GODOT_ZIP"
    echo "    + unzipping (a moment)..."
    unzip -q "$GODOT_ZIP" -d "$GODOT_DIR"
    rm "$GODOT_ZIP"
    echo "    → installed Godot to $GODOT_APP"
else
    echo "    - Godot already present"
fi

# ---- 3. Build Components -----------------------------------------------------
if [ "$PREBUILT" = "1" ]; then
  echo "[3/6] using the prebuilt wallpaper shim (build skipped)"
  echo "[4/6] using the prebuilt native shell (build skipped)"
else
  echo "[3/6] building wallpaper shim (DYLD injected into Godot)…"
  echo "    + compiling Rust - 'Compiling ...' lines will scroll. The first build takes several minutes, it is NOT frozen..."
  ( cd "$ROOT/shell/macos/wallpaper_shim" && cargo build --release )
  cp "$ROOT/shell/macos/wallpaper_shim/target/release/libwallpaper_shim.dylib" \
     "$ROOT/shell/macos/libwallpaper_shim.dylib"
  codesign --force --sign - "$ROOT/shell/macos/libwallpaper_shim.dylib"

  echo "[4/6] building the native shell…"
  echo "    + compiling the shell - more 'Compiling ...' lines; another few minutes, still working (NOT frozen)..."
  ( cd "$ROOT/shell" && cargo build --release )
fi

# ---- 4. Wiring --------------------------------------------------------------
echo "[5/6] wiring Claude Code hooks for this machine…"
bash "$ROOT/installer/wire-hooks.sh" "$ROOT"

# ---- 5. CLI Setup -----------------------------------------------------------
echo "[6/6] setting up the 'bagidea' CLI command..."
mkdir -p "$ROOT/bin"
# Ensure the cli script has the right permission
chmod +x "$ROOT/cli/bagidea"
ln -sf "$ROOT/cli/bagidea" "$ROOT/bin/bagidea"
export PATH="$ROOT/bin:$PATH"

echo "  ==========================================="
echo "   INSTALL COMPLETE!"
echo "  ==========================================="
echo ""
echo "To use the 'bagidea' command from any terminal, add this to your .zshrc:"
echo "  export PATH=\"$ROOT/bin:\$PATH\""
echo ""
echo "Run the office:  bagidea start"
echo "Or run shell:    $ROOT/shell/target/release/bagidea-office-shell"
