import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { RemoteApi } from "../../app/useRemoteSessions";
import { connectionTarget, type ConnectionProfile } from "../../domain/connection";
import { useI18n } from "../../i18n";
import { Callout } from "../common/Callout";
import { CloseIcon, ScreenShareIcon, ShieldIcon } from "../icons";

export function RemoteConnectFlow({
  profile,
  remote,
  onConnected,
  onCancel,
}: {
  profile: ConnectionProfile;
  remote: RemoteApi;
  onConnected: (sessionId: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [pairingCode, setPairingCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => codeRef.current?.focus(), []);
  useEffect(() => {
    function close(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    document.addEventListener("keydown", close, true);
    return () => document.removeEventListener("keydown", close, true);
  }, [busy, onCancel]);

  const formatted =
    pairingCode.length > 4
      ? `${pairingCode.slice(0, 4)}-${pairingCode.slice(4)}`
      : pairingCode;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pairingCode.length !== 8) {
      setProblem(t("remote.connect.codeInvalid"));
      return;
    }
    setBusy(true);
    setProblem(null);
    const outcome = await remote.connect({
      profileId: profile.id,
      hostname: profile.hostname,
      port: profile.port,
      pairingCode,
    });
    // Drop the one-time secret immediately after the IPC call resolves.
    setPairingCode("");
    setBusy(false);
    if (outcome.outcome === "connected") {
      onConnected(outcome.sessionId);
    } else {
      setProblem(
        t("remote.connect.failedBody", {
          stage: outcome.stage,
          detail: outcome.detail,
        }),
      );
    }
  }

  return (
    <div className="scrim scrim--center" role="presentation" onMouseDown={onCancel}>
      <div
        className="dialog dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="remote-connect-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog__head">
          <span className="dialog__icon dialog__icon--inline" aria-hidden="true">
            <ScreenShareIcon size={18} />
          </span>
          <h2 className="dialog__title" id="remote-connect-title">
            {t("remote.connect.title", { name: profile.name })}
          </h2>
          <button
            type="button"
            className="icon-button icon-button--sm"
            onClick={onCancel}
            disabled={busy}
            aria-label={t("common.close")}
            style={{ marginLeft: "auto" }}
          >
            <CloseIcon size={14} />
          </button>
        </header>

        <form className="dialog__stack" onSubmit={submit}>
          <p className="dialog__body mono">{connectionTarget(profile)}</p>
          <Callout tone="security" title={t("remote.connect.securityTitle")}>
            {t("remote.connect.securityBody")}
          </Callout>
          {problem && (
            <Callout tone="warn" title={t("remote.connect.failedTitle")}>
              {problem}
            </Callout>
          )}

          <div className="field">
            <label className="field__label" htmlFor="remote-pairing-code">
              {t("remote.connect.code")}
            </label>
            <div className="remote-code-field">
              <ShieldIcon size={16} />
              <input
                id="remote-pairing-code"
                ref={codeRef}
                className="input mono"
                value={formatted}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="0000-0000"
                disabled={busy}
                onChange={(event) =>
                  setPairingCode(
                    event.currentTarget.value.replace(/\D/g, "").slice(0, 8),
                  )
                }
              />
            </div>
            <p className="field__optional">{t("remote.connect.codeHint")}</p>
          </div>

          <div className="dialog__actions">
            <button
              type="button"
              className="button button--ghost"
              onClick={onCancel}
              disabled={busy}
            >
              {t("common.cancel")}
            </button>
            <button type="submit" className="button button--primary" disabled={busy}>
              {busy ? t("remote.connect.connecting") : t("remote.connect.submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
