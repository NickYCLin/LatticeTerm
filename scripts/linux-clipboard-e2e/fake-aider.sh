#!/usr/bin/env bash

# A deliberately tiny PTY peer for the Linux clipboard end-to-end test.
# LatticeTerm discovers this file as `aider` through the isolated test PATH.
# The Python peer records every byte and emits the copy target only after the
# mounted terminal sends a nonce-bound trigger through the real PTY.

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")" && pwd)
exec /usr/bin/python3 "$SCRIPT_DIR/fake_aider.py"
