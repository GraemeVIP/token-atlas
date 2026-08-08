#!/bin/sh
# Token Atlas installer for macOS and Linux.
#   curl -fsSL https://raw.githubusercontent.com/graemevip/token-atlas/main/install.sh | sh
#
# Downloads a single self-contained binary. No Node, npm or Deno required.
set -eu

REPO="graemevip/token-atlas"
BIN="token-atlas"

os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
  Darwin) case "$arch" in
            arm64)  asset="token-atlas-macos-arm64" ;;
            x86_64) asset="token-atlas-macos-intel" ;;
            *) echo "Unsupported Mac architecture: $arch" >&2; exit 1 ;;
          esac ;;
  Linux)  case "$arch" in
            x86_64|amd64)  asset="token-atlas-linux-x64" ;;
            aarch64|arm64) asset="token-atlas-linux-arm64" ;;
            *) echo "Unsupported Linux architecture: $arch" >&2; exit 1 ;;
          esac ;;
  *) echo "Unsupported OS: $os. On Windows use the PowerShell command in the README." >&2; exit 1 ;;
esac

# Prefer somewhere already on PATH and writable without sudo. On Apple Silicon
# /usr/local/bin usually is not writable, so most Macs land on ~/.local/bin —
# which zsh does NOT have on PATH by default. That is handled further down.
# /opt/homebrew/bin is deliberately not used even when writable: it belongs to
# Homebrew, and foreign binaries there make `brew doctor` complain.
if [ -d "/usr/local/bin" ] && [ -w "/usr/local/bin" ]; then
  dir="/usr/local/bin"
else
  dir="$HOME/.local/bin"
  mkdir -p "$dir"
fi

url="https://github.com/$REPO/releases/latest/download/$asset"
tmp="$(mktemp)"

echo "Downloading Token Atlas ($asset)..."
if ! curl -fsSL "$url" -o "$tmp"; then
  echo "Download failed. Check https://github.com/$REPO/releases" >&2
  rm -f "$tmp"
  exit 1
fi

chmod +x "$tmp"
mv "$tmp" "$dir/$BIN"

# Binaries fetched with curl carry no com.apple.quarantine flag, so Gatekeeper
# does not block them the way it blocks browser downloads. Clear it anyway in
# case the file arrived by another route.
if [ "$os" = "Darwin" ]; then
  xattr -d com.apple.quarantine "$dir/$BIN" 2>/dev/null || true
fi

echo ""
echo "  Installed to $dir/$BIN"
echo ""

case ":$PATH:" in
  *":$dir:"*)
    echo "  Run it by typing:   $BIN"
    ;;
  *)
    # Not on PATH: add it to the right shell profile so `token-atlas` just
    # works, rather than leaving the user with "command not found".
    line="export PATH=\"$dir:\$PATH\""
    added=""
    for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile"; do
      case "$(basename "$rc")" in
        .zshrc)        [ "$(basename "${SHELL:-}")" = "zsh" ]  || continue ;;
        .bashrc|.bash_profile) [ "$(basename "${SHELL:-}")" = "bash" ] || continue ;;
      esac
      [ -e "$rc" ] || touch "$rc"
      if ! grep -Fq "$dir" "$rc" 2>/dev/null; then
        printf '\n# added by the token-atlas installer\n%s\n' "$line" >> "$rc"
      fi
      added="$rc"
      break
    done

    if [ -n "$added" ]; then
      echo "  Added $dir to your PATH in $(basename "$added")."
      echo ""
      echo "  Run it right now with:"
      echo "      $dir/$BIN"
      echo ""
      echo "  From your NEXT terminal window, just:   $BIN"
    else
      echo "  $dir is not on your PATH. Run it with:"
      echo "      $dir/$BIN"
    fi
    ;;
esac
echo ""
