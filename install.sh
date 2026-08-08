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

# Prefer a dir already on PATH that we can write to without sudo.
if [ -w "/usr/local/bin" ] 2>/dev/null; then
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

case ":$PATH:" in
  *":$dir:"*) echo "  Run it with:  $BIN" ;;
  *) echo ""
     echo "  $dir is not on your PATH yet. Either run it directly:"
     echo "      $dir/$BIN"
     echo "  or add it permanently:"
     echo "      echo 'export PATH=\"$dir:\$PATH\"' >> ~/.zshrc && source ~/.zshrc" ;;
esac
echo ""
