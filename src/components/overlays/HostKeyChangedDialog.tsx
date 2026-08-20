/**
 * Host key changed blocking warning dialog.
 *
 * High-risk security event (potential Man-In-The-Middle attack).
 * Refuses automatic connection and clearly displays old vs new fingerprints.
 */

import { useState } from "react";
import type { HostFingerprint } from "../../domain/security";
import { AlertIcon, CloseIcon } from "../icons";

export function HostKeyChangedDialog({
  host,
  port,
  expectedFingerprint,
  receivedFingerprint,
  onAbort,
  onAcceptRiskAndReplace,
}: {
  host: string;
  port: number;
  expectedFingerprint: HostFingerprint;
  receivedFingerprint: HostFingerprint;
  onAbort: () => void;
  onAcceptRiskAndReplace: () => void;
}) {
  const [showOverrideConfirm, setShowOverrideConfirm] = useState(false);

  return (
    <div className="scrim scrim--top" role="presentation" onMouseDown={onAbort}>
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="key-changed-title"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ borderColor: "var(--danger)" }}
      >
        <header className="dialog__head">
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ color: "var(--danger)", display: "flex" }}>
              <AlertIcon size={18} />
            </span>
            <h2 className="dialog__title" id="key-changed-title" style={{ color: "var(--danger)" }}>
              WARNING: Remote Host Identification Has Changed!
            </h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onAbort}
            aria-label="Close"
          >
            <CloseIcon size={14} />
          </button>
        </header>

        <div className="dialog__body stack">
          <p className="dialog__text">
            IT IS POSSIBLE THAT SOMEONE IS DOING SOMETHING NASTY! Someone could be
            eavesdropping on you right now (man-in-the-middle attack).
          </p>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            The host key for <strong className="mono">{host}:{port}</strong> differs
            from the key previously trusted for this host.
          </p>

          <div
            style={{
              backgroundColor: "var(--surface-raised)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              padding: "0.75rem",
              fontSize: "0.8125rem",
            }}
            className="stack"
          >
            <div>
              <span className="eyebrow" style={{ color: "var(--text-muted)" }}>
                Previously Trusted ({expectedFingerprint.algorithm})
              </span>
              <p className="mono" style={{ color: "var(--text-muted)", wordBreak: "break-all" }}>
                {expectedFingerprint.fingerprint}
              </p>
            </div>

            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.5rem" }}>
              <span className="eyebrow" style={{ color: "var(--danger)" }}>
                Newly Received from Server ({receivedFingerprint.algorithm})
              </span>
              <p className="mono" style={{ color: "var(--danger)", wordBreak: "break-all", fontWeight: 600 }}>
                {receivedFingerprint.fingerprint}
              </p>
            </div>
          </div>

          {showOverrideConfirm ? (
            <div
              style={{
                backgroundColor: "var(--surface)",
                border: "1px solid var(--danger)",
                borderRadius: "var(--radius-sm)",
                padding: "0.75rem",
              }}
            >
              <p style={{ fontSize: "0.8125rem", color: "var(--danger)", fontWeight: 600 }}>
                Are you absolutely sure you want to replace the trusted key for {host}?
                Only do this if you know the server was recently re-installed or re-keyed.
              </p>
            </div>
          ) : (
            <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
              If you did not expect the server key to change, abort immediately and
              contact your server administrator.
            </p>
          )}
        </div>

        <div className="dialog__foot">
          <button
            type="button"
            className="button button--primary"
            onClick={onAbort}
          >
            Abort connection (Recommended)
          </button>

          {showOverrideConfirm ? (
            <button
              type="button"
              className="button button--danger"
              onClick={onAcceptRiskAndReplace}
            >
              Accept risk & update key
            </button>
          ) : (
            <button
              type="button"
              className="button button--ghost button--danger button--sm"
              onClick={() => setShowOverrideConfirm(true)}
            >
              Advanced: Replace key
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
