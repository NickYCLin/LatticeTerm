/**
 * Host fingerprint trust dialog.
 *
 * Appears when connecting to an unknown host for the first time. Displays
 * the full key algorithm and fingerprint with clear options for session-only
 * trust or permanent trust.
 */

import { useState } from "react";
import type { HostFingerprint } from "../../domain/security";
import { ShieldIcon, CloseIcon, CheckIcon } from "../icons";

export function HostFingerprintDialog({
  fingerprint,
  onTrustOnce,
  onTrustAndSave,
  onCancel,
}: {
  fingerprint: HostFingerprint;
  onTrustOnce: () => void;
  onTrustAndSave: () => void;
  onCancel: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function copyToClipboard() {
    navigator.clipboard.writeText(fingerprint.fingerprint);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="scrim scrim--top" role="presentation" onMouseDown={onCancel}>
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="fingerprint-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="dialog__head">
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ color: "var(--accent)", display: "flex" }}>
              <ShieldIcon size={18} />
            </span>
            <h2 className="dialog__title" id="fingerprint-title">
              Verify Host Fingerprint
            </h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onCancel}
            aria-label="Close"
          >
            <CloseIcon size={14} />
          </button>
        </header>

        <div className="dialog__body stack">
          <p className="dialog__text">
            The authenticity of host{" "}
            <strong className="mono">
              {fingerprint.host}:{fingerprint.port}
            </strong>{" "}
            cannot be established automatically. Please verify that this fingerprint
            matches your server before connecting:
          </p>

          <div
            style={{
              backgroundColor: "var(--surface-raised)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              padding: "0.75rem 1rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
              <span className="eyebrow">Key Algorithm</span>
              <span className="mono" style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                {fingerprint.algorithm}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
              <span
                className="mono"
                style={{
                  fontSize: "0.8125rem",
                  color: "var(--text)",
                  wordBreak: "break-all",
                  userSelect: "all",
                }}
              >
                {fingerprint.fingerprint}
              </span>
              <button
                type="button"
                className="button button--ghost button--sm"
                onClick={copyToClipboard}
                style={{ flexShrink: 0 }}
              >
                {copied ? <CheckIcon size={12} /> : null}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            Are you sure you want to continue connecting?
          </p>
        </div>

        <div className="dialog__foot">
          <button
            type="button"
            className="button button--ghost"
            onClick={onCancel}
          >
            Cancel
          </button>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              className="button button--secondary"
              onClick={onTrustOnce}
            >
              Trust once
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={onTrustAndSave}
            >
              Trust & remember
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
