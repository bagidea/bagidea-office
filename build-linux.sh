#!/usr/bin/env bash
# BagIdea Office — Linux (Ubuntu/Debian) one-shot installer & build.
#   • installs dependencies via apt (Node 20, Rust, WebKitGTK, X11 tools, audio)
#   • downloads Godot 4.6.3 (linux x86_64 OR arm64/aarch64, auto-detected) if missing
#   • builds the native shell (tao/wry)
#   • wires Claude Code hooks and sets up the 'bagidea' CLI + autostart
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "  ==========================================="
echo "   BagIdea Office - LINUX INSTALLER (apt)"
echo "  ==========================================="

# ---- 1. Dependencies (apt) ---------------------------------------------------
echo "[1/6] installing dependencies (sudo apt)..."
if ! command -v apt-get &> /dev/null; then
  echo "    ! This installer targets Ubuntu/Debian (apt). On other distros, install the"
  echo "      equivalents of: nodejs(>=18) rust git webkit2gtk gtk3 libsoup3 x11-utils"
  echo "      wmctrl xdotool pulseaudio-utils  — then run: cargo build --release in shell/"
  exit 1
fi
sudo apt-get update -y
# Build + runtime libs for the Rust shell (tao/wry → WebKitGTK) + wallpaper/audio tools.
# WebKitGTK is 4.1 on newer Ubuntu, 4.0 on older — install whichever is available.
sudo apt-get install -y curl git build-essential pkg-config \
  libgtk-3-dev libwebkit2gtk-4.1-dev libsoup-3.0-dev \
  x11-utils wmctrl xdotool libxdo3 libxdo-dev \
  pulseaudio-utils alsa-utils unzip \
  || sudo apt-get install -y curl git build-essential pkg-config \
       libgtk-3-dev libwebkit2gtk-4.0-dev libsoup2.4-dev \
       x11-utils wmctrl xdotool libxdo3 libxdo-dev pulseaudio-utils alsa-utils unzip

# Node.js >= 18 (the daemon uses global fetch / AbortSignal.timeout). Ubuntu's apt node
# is often too old, so fall back to NodeSource 20 when needed.
need_node=1
if command -v node &> /dev/null; then
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$major" -ge 18 ] 2>/dev/null && need_node=0
fi
if [ "$need_node" -eq 1 ]; then
  echo "    + installing Node.js 20 (NodeSource)..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# ---- detect CPU arch — the office runs on x86_64 AND arm64/aarch64 on Linux ---
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64)   GODOT_ARCH="x86_64" ;;
  aarch64|arm64)  GODOT_ARCH="arm64" ;;
  *) echo "    ! unrecognized CPU arch '$ARCH' — assuming x86_64 (override with BAGIDEA_GODOT_ARCH)"; GODOT_ARCH="x86_64" ;;
esac
GODOT_ARCH="${BAGIDEA_GODOT_ARCH:-$GODOT_ARCH}"   # manual override, e.g. BAGIDEA_GODOT_ARCH=arm64

# ---- try a prebuilt shell (skips installing Rust + the cargo build) ----------
# Only on x86_64 + WebKitGTK 4.1 (the prebuilt shell is built on Ubuntu 24.04 /
# webkit 4.1, x86_64 only). arm64 and older distros fall back to a source build —
# which works. Force a source build with BAGIDEA_NO_PREBUILT=1.
PREBUILT=0
if [ "$GODOT_ARCH" != "x86_64" ]; then
  echo "    - no prebuilt shell for linux $GODOT_ARCH yet — building from source"
elif [ -z "$BAGIDEA_NO_PREBUILT" ] && pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
  SLUG=$(git -C "$ROOT" remote get-url origin 2>/dev/null | sed -nE 's#.*github\.com[:/]+([^/]+)/([^/.]+).*#\1/\2#p')
  VER=$(head -n1 "$ROOT/VERSION" 2>/dev/null | tr -d ' \r\n')
  if [ -n "$SLUG" ] && [ -n "$VER" ]; then
    mkdir -p "$ROOT/shell/target/release"
    echo "    + looking for a prebuilt shell v$VER (linux x86_64)…"
    if curl -fSL --retry 3 -o "$ROOT/shell/target/release/bagidea-office-shell" "https://github.com/$SLUG/releases/download/v$VER/bagidea-office-shell-linux-x64"; then
      chmod +x "$ROOT/shell/target/release/bagidea-office-shell"
      PREBUILT=1
      echo "    → got the prebuilt shell (skipping Rust + the cargo build)"
    else
      echo "    - no prebuilt available; will build from source"
      rm -f "$ROOT/shell/target/release/bagidea-office-shell"
    fi
  fi
fi

# Rust (official rustup — the apt 'rustc' can be too old for some crates).
if [ "$PREBUILT" != "1" ] && ! command -v cargo &> /dev/null; then
  echo "    + installing Rust (rustup)..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path
fi
# Test-then-source (never `|| true`): `.`/`source` is a POSIX special builtin, so a
# missing-file failure can abort the script under `set -e` on stricter/older bash.
# With a prebuilt shell, Rust isn't installed and this file won't exist (#38).
if [ -f "$HOME/.cargo/env" ]; then . "$HOME/.cargo/env"; fi

# ---- 2. Godot ----------------------------------------------------------------
GODOT_DIR="$ROOT/godot/bin-linux"
GODOT_BIN="$GODOT_DIR/godot"
echo "[2/6] checking Godot engine..."
if [ ! -x "$GODOT_BIN" ]; then
  echo "    + downloading Godot 4.6.3 (linux $GODOT_ARCH) — ~80 MB, a progress bar follows..."
  mkdir -p "$GODOT_DIR"
  ZIP="$ROOT/godot/godot_linux.zip"
  curl -L --progress-bar "https://github.com/godotengine/godot/releases/download/4.6.3-stable/Godot_v4.6.3-stable_linux.$GODOT_ARCH.zip" -o "$ZIP"
  unzip -q -o "$ZIP" -d "$GODOT_DIR"
  # The zip contains Godot_v4.6.3-stable_linux.<arch> — normalize the name to 'godot'.
  mv "$GODOT_DIR"/Godot_v*_linux."$GODOT_ARCH" "$GODOT_BIN"
  chmod +x "$GODOT_BIN"
  rm -f "$ZIP"
  echo "    → installed Godot to $GODOT_BIN"
else
  echo "    - Godot already present"
fi

# ---- 3. Build the shell ------------------------------------------------------
if [ "$PREBUILT" = "1" ]; then
  echo "[3/6] using the prebuilt native shell (build skipped)"
else
  echo "[3/6] building the native shell (first build takes several minutes — NOT frozen)..."
  ( cd "$ROOT/shell" && cargo build --release )
fi

# ---- 4. Claude Code hooks (Node — same as macOS) -----------------------------
echo "[4/6] wiring Claude Code hooks..."
bash "$ROOT/installer/wire-hooks.sh" "$ROOT"

# ---- 5. CLI on PATH ----------------------------------------------------------
echo "[5/6] setting up the 'bagidea' command..."
chmod +x "$ROOT/cli/bagidea"
mkdir -p "$HOME/.local/bin"
ln -sf "$ROOT/cli/bagidea" "$HOME/.local/bin/bagidea"
case ":$PATH:" in
  *":$HOME/.local/bin:"*) : ;;
  *) echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc" ;;
esac

# ---- 6. Autostart at login (XDG) — on by default, toggle with 'bagidea startup off' ----
echo "[6/6] enabling autostart at login..."
mkdir -p "$HOME/.config/autostart"
cat > "$HOME/.config/autostart/bagidea-office.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=BagIdea Office
Exec=$ROOT/shell/target/release/bagidea-office-shell
X-GNOME-Autostart-enabled=true
NoDisplay=true
DESK

echo "  ==========================================="
echo "   INSTALL COMPLETE!"
echo "  ==========================================="
echo ""
echo "  Open a NEW terminal (so PATH updates), then:  bagidea start"
echo "  (X11/Xorg sessions get the desktop-wallpaper look; on Wayland it runs as a"
echo "   fullscreen window pinned below other windows.)"
echo ""
