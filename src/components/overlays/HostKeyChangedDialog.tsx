/**
 * Host key changed warning.
 *
 * A blocking, high-risk state: the key a host offers no longer matches the one
 * that was trusted. There is deliberately no vague "continue" primary button —
 * replacing the trusted key is a separate, explicitly confirmed action, and it
 * is never the default.
 */

import { useState } from "react";
import type { HostFingerprint } from "../../domain/security";
import { hostTargetKey } from "../../domain/security";
import { useI18n } from "../../i18n";
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
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="scrim scrim--top" role="presentation" onMouseDown={onAbort}>
      <div
        className="dialog dialog--wide"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="key-changed-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog__head">
          <span
            className="dialog__icon dialog__icon--inline dialog__icon--danger"
            aria-hidden="true"
          >
            <AlertIcon size={18} />
          </span>
          <h2 className="dialog__title" id="key-changed-title">
            {t("security.changed.title")}
          </h2>
          <button
            type="button"
            className="icon-button icon-button--sm"
            onClick={onAbort}
            aria-label={t("common.close")}
            style={{ marginLeft: "auto" }}
          >
            <CloseIcon size={14} />
          </button>
        </header>

        <div className="dialog__stack">
          <p className="dialog__body">{t("security.changed.body")}</p>

          <div className="fingerprint-box">
            <div className="fingerprint-box__row">
              <span className="eyebrow">{t("security.changed.expected")}</span>
              <span className="mono">{expectedFingerprint.algorithm}</span>
            </div>
            <span className="fingerprint-box__value">
              {expectedFingerprint.fingerprint}
            </span>
          </div>

          <div className="fingerprint-box fingerprint-box--danger">
            <div className="fingerprint-box__row">
              <span className="eyebrow">{t("security.changed.received")}</span>
              <span className="mono">{receivedFingerprint.algorithm}</span>
            </div>
            <span className="fingerprint-box__value">
              {receivedFingerprint.fingerprint}
            </span>
          </div>

          <p className="dialog__body mono">{hostTargetKey(host, port)}</p>
          <p className="dialog__body">{t("security.changed.checklist")}</p>
        </div>

        <div className="dialog__actions">
          {confirming ? (
            <>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => setConfirming(false)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="button button--danger"
                onClick={onAcceptRiskAndReplace}
              >
                {t("security.changed.overrideConfirm")}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="button button--ghost button--danger"
                onClick={() => setConfirming(true)}
              >
                {t("security.changed.override")}
              </button>
              <button
                type="button"
                className="button button--primary"
                onClick={onAbort}
              >
                {t("security.changed.abort")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
