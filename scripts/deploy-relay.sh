#!/usr/bin/env bash
# Deploys the lattice-relay server to a Linux host over SSH.
#
#   scripts/deploy-relay.sh user@host [ssh-port]
#
# The relay is built on the target with the system's cargo (installed via
# rustup if missing), installed to /usr/local/bin, and run as the dedicated
# lattice-relay user through systemd. Re-running upgrades in place.
set -euo pipefail

TARGET="${1:?usage: deploy-relay.sh user@host [ssh-port]}"
SSH_PORT="${2:-22}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

SSH=(ssh -p "$SSH_PORT" "$TARGET")

echo "==> Packing lattice-remote sources"
TARBALL="$(mktemp -t lattice-relay-XXXXXX.tar.gz)"
tar -czf "$TARBALL" -C "$REPO_ROOT" crates/lattice-remote deploy/lattice-relay.service

echo "==> Copying to $TARGET"
scp -P "$SSH_PORT" "$TARBALL" "$TARGET:/tmp/lattice-relay-src.tar.gz"
rm -f "$TARBALL"

echo "==> Building and installing on the server"
"${SSH[@]}" 'bash -s' <<'REMOTE'
set -euo pipefail
SUDO=""
if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi

if ! command -v cc >/dev/null 2>&1; then
  echo "--> Installing a C linker"
  if command -v apt-get >/dev/null 2>&1; then
    $SUDO apt-get update -qq && $SUDO apt-get install -y -qq build-essential
  elif command -v dnf >/dev/null 2>&1; then
    $SUDO dnf install -y gcc
  fi
fi

if ! command -v cargo >/dev/null 2>&1 && [ ! -x "$HOME/.cargo/bin/cargo" ]; then
  echo "--> Installing Rust"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
fi
export PATH="$HOME/.cargo/bin:$PATH"

echo "--> Building lattice-relay"
BUILD_DIR="$(mktemp -d)"
tar -xzf /tmp/lattice-relay-src.tar.gz -C "$BUILD_DIR"
rm -f /tmp/lattice-relay-src.tar.gz
cargo build --manifest-path "$BUILD_DIR/crates/lattice-remote/Cargo.toml" \
  --release --features relay-server --bin lattice-relay

echo "--> Installing binary and service"
$SUDO install -m 0755 "$BUILD_DIR/crates/lattice-remote/target/release/lattice-relay" /usr/local/bin/lattice-relay
if ! id lattice-relay >/dev/null 2>&1; then
  $SUDO useradd --system --home-dir /var/lib/lattice-relay --shell /usr/sbin/nologin lattice-relay
fi
# Deployments made before the HTTPS/WSS ingress switch listened publicly on
# 0.0.0.0:44910; the unit now binds 127.0.0.1 only. Surface the change and
# drop the firewall rule the old script opened, so no stale allow lingers.
if $SUDO grep -q -- '--bind 0.0.0.0:44910' /etc/systemd/system/lattice-relay.service 2>/dev/null; then
  echo "--> NOTE: the relay now listens on 127.0.0.1:44910 (was 0.0.0.0)."
  echo "    Clients that dialed this host's port 44910 directly must switch"
  echo "    to the HTTPS/WSS ingress in front of the relay."
fi
if command -v ufw >/dev/null 2>&1 && $SUDO ufw status 2>/dev/null | grep -q '44910'; then
  echo "--> Removing the stale ufw rule for the old public 44910 listener"
  $SUDO ufw delete allow 44910/tcp || true
fi
$SUDO install -m 0644 "$BUILD_DIR/deploy/lattice-relay.service" /etc/systemd/system/lattice-relay.service
$SUDO systemctl daemon-reload
$SUDO systemctl enable lattice-relay
# enable --now leaves an already-running relay on the old unit; restart makes
# the new binary and bind address take effect deterministically.
$SUDO systemctl restart lattice-relay
rm -rf "$BUILD_DIR"

sleep 1
$SUDO systemctl --no-pager --lines 5 status lattice-relay
REMOTE

echo "==> Done. The relay listens on 127.0.0.1:44910. Put HTTPS/WSS ingress in front of it for public use."
