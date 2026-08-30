/**
 * Host fingerprint trust dialog.
 *
 * Shown the first time a host is reached. The fingerprint is displayed in
 * full and can be copied, because a truncated one cannot be compared against
 * what the host itself reports.
 */

import { useEffect, useRef, useState } from "react";
import { copyTextToClipboard } from "../../app/clipboardText";
import type { HostFingerprint } from "../../domain/security";
import { hostTargetKey } from "../../domain/security";
import { useI18n } from "../../i18n/context";
import { CheckIcon, CloseIcon, ShieldIcon } from "../icons";
import { useModalFocus } from "./modalFocus";

export function HostFingerprintDialog({
  fingerprint,
  onTrustOnce,
  onTrustAndSave,
  onCancel,
}: {
  fingerprint: HostFingerprint;
  /**
   * Offered only where a session-scoped trust actually exists. Omitting it
   * hides the button rather than quietly making it persist the key.
   */
  onTrustOnce?: () => void;
  onTrustAndSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [copyProblem, setCopyProblem] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const copyTimerRef = useRef<number | null>(null);
  const copyRequestRef = useRef(0);

  useModalFocus({
    dialogRef,
    getInitialFocus: () => cancelRef.current,
    onEscape: onCancel,
  });

  useEffect(
    () => () => {
      copyRequestRef.current += 1;
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    },
    [],
  );

  async function copy() {
    const request = ++copyRequestRef.current;
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
    setCopied(false);
    setCopyProblem(null);
    try {
      await copyTextToClipboard(fingerprint.fingerprint);
      if (request !== copyRequestRef.current) return;
      setCopied(true);
      copyTimerRef.current = window.setTimeout(() => {
        if (request === copyRequestRef.current) {
          setCopied(false);
          copyTimerRef.current = null;
        }
      }, 2_000);
    } catch (reason) {
      if (request !== copyRequestRef.current) return;
      setCopyProblem(
        t("common.copyFailed.body", {
          error: reason instanceof Error ? reason.message : String(reason),
        }),
      );
    }
  }

  return (
    <div className="scrim scrim--top" role="presentation" onMouseDown={onCancel}>
      <div
        ref={dialogRef}
        className="dialog dialog--wide"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="fingerprint-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog__head">
          <span className="dialog__icon dialog__icon--inline" aria-hidden="true">
            <ShieldIcon size={18} />
          </span>
          <h2 className="dialog__title" id="fingerprint-title">
            {t("security.verify.title")}
          </h2>
          <button
            ref={cancelRef}
            type="button"
            className="icon-button icon-button--sm"
            onClick={onCancel}
            aria-label={t("common.close")}
            style={{ marginLeft: "auto" }}
          >
            <CloseIcon size={14} />
          </button>
        </header>

        <div className="dialog__stack">
          <p className="dialog__body">
            {t("security.verify.body", {
              target: hostTargetKey(fingerprint.host, fingerprint.port),
            })}
          </p>

          <div className="fingerprint-box">
            <div className="fingerprint-box__row">
              <span className="eyebrow">{t("security.algorithm")}</span>
              <span className="mono">{fingerprint.algorithm}</span>
            </div>
            <div className="fingerprint-box__row">
              <span className="eyebrow">{t("security.fingerprint")}</span>
              <button
                type="button"
                className="button button--ghost button--sm"
                onClick={() => void copy()}
              >
                {copied ? <CheckIcon size={13} /> : null}
                {copied ? t("common.copied") : t("common.copy")}
              </button>
            </div>
            <span className="fingerprint-box__value">
              {fingerprint.fingerprint}
            </span>
          </div>

          {copyProblem && (
            <p
              role="alert"
              className="dialog__body"
              style={{ color: "var(--danger)" }}
            >
              {copyProblem}
            </p>
          )}

          <p className="dialog__body">{t("security.verifyHint")}</p>
        </div>

        <div className="dialog__actions">
          <button
            type="button"
            className="button button--ghost"
            onClick={onCancel}
          >
            {t("common.cancel")}
          </button>
          {onTrustOnce && (
            <button
              type="button"
              className="button button--secondary"
              onClick={onTrustOnce}
            >
              {t("security.trustOnce")}
            </button>
          )}
          <button
            type="button"
            className="button button--primary"
            onClick={onTrustAndSave}
          >
            {t("security.trustAndSave")}
          </button>
        </div>
      </div>
    </div>
  );
}
