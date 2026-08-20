/**
 * Host fingerprint trust dialog.
 *
 * Shown the first time a host is reached. The fingerprint is displayed in
 * full and can be copied, because a truncated one cannot be compared against
 * what the host itself reports.
 */

import { useState } from "react";
import type { HostFingerprint } from "../../domain/security";
import { hostTargetKey } from "../../domain/security";
import { useI18n } from "../../i18n";
import { CheckIcon, CloseIcon, ShieldIcon } from "../icons";

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

  async function copy() {
    try {
      await navigator.clipboard.writeText(fingerprint.fingerprint);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the value stays selectable on screen.
    }
  }

  return (
    <div className="scrim scrim--top" role="presentation" onMouseDown={onCancel}>
      <div
        className="dialog dialog--wide"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="fingerprint-title"
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
                onClick={copy}
              >
                {copied ? <CheckIcon size={13} /> : null}
                {copied ? t("common.copied") : t("common.copy")}
              </button>
            </div>
            <span className="fingerprint-box__value">
              {fingerprint.fingerprint}
            </span>
          </div>

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
