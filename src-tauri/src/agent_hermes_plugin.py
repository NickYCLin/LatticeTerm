"""Process-scoped Hermes lifecycle bridge for LatticeTerm.

The host installs this module in a temporary bundled-plugin overlay.  Only
bounded lifecycle metadata is forwarded; prompts, tool arguments, responses,
and credentials never leave the Hermes process.
"""

from __future__ import annotations

import json
import os
import subprocess
from functools import partial
from typing import Any


_REPORTER = os.environ.get("LATTICETERM_AGENT_REPORTER", "")
_FIELDS = {
    "on_session_start": ("session_id",),
    "pre_llm_call": ("session_id",),
    "on_session_end": ("session_id", "completed", "failed", "interrupted"),
    "subagent_start": ("parent_session_id", "child_session_id"),
    "subagent_stop": ("parent_session_id", "child_session_id"),
    "pre_approval_request": ("session_id",),
    "post_approval_response": ("session_id", "choice"),
}


def _forward(event: str, **payload: Any) -> None:
    if not _REPORTER:
        return
    message = {"hook_event_name": event}
    for field in _FIELDS[event]:
        value = payload.get(field)
        if isinstance(value, bool):
            message[field] = value
        elif (
            isinstance(value, str)
            and len(value) <= 512
            and not any(ord(character) < 32 or ord(character) == 127 for character in value)
        ):
            message[field] = value
    try:
        subprocess.run(
            [_REPORTER, "agent-hermes-hook"],
            input=json.dumps(message, separators=(",", ":")),
            text=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=8,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        # Observability must never prevent Hermes from finishing the turn.
        return


def register(ctx: Any) -> None:
    for event in _FIELDS:
        ctx.register_hook(event, partial(_forward, event))
