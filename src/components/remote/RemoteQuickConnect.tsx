import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  formatDeviceId,
  loadRelayAddress,
  normalizeDeviceId,
  saveRelayAddress,
} from "../../app/remoteRelay";
import type { RemoteApi } from "../../app/useRemoteSessions";
import { useI18n } from "../../i18n/context";
import { Callout } from "../common/Callout";
import { CloseIcon, ScreenShareIcon, ShieldIcon } from "../icons";

/**
 * AnyDesk-style entry: type the other machine's nine-digit device ID and its
 * pairing code, and the relay finds it — no IP address or port required.
 */
export function RemoteQuickConnect({
  remote,
  onConnected,
  onCancel,
}: {
  remote: RemoteApi;
  onConnected: (sessionId: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [relayAddress, setRelayAddress] = useState(() =>
    loadRelayAddress(window.localStorage),
  );
  const [deviceId, setDeviceId] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const idRef = useRef<HTMLInputElement>(null);

  useEffect(() => idRef.current?.focus(), []);
  useEffect(() => {
    function close(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    document.addEventListener("keydown", close, true);
    return () => document.removeEventListener("keydown", close, true);
  }, [busy, onCancel]);

  const formattedCode =
    pairingCode.length > 4
      ? `${pairingCode.slice(0, 4)}-${pairingCode.slice(4)}`
      : pairingCode;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedId = normalizeDeviceId(deviceId);
    if (!normalizedId) {
      setProblem(t("remote.quick.idInvalid"));
      return;
    }
    if (pairingCode.length !== 8) {
      setProblem(t("remote.connect.codeInvalid"));
      return;
    }
    if (!relayAddress.trim()) {
      setProblem(t("remote.quick.relayMissing"));
      return;
    }
    setBusy(true);
    setProblem(null);
    const outcome = await remote.connect({
      profileId: `relay:${normalizedId}`,
      hostname: "",
      port: 0,
      pairingCode,
      deviceId: normalizedId,
      relayAddress: relayAddress.trim(),
    });
    // Drop the one-time secret immediately after the IPC call resolves.
    setPairingCode("");
    setBusy(false);
    if (outcome.outcome === "connected") {
      saveRelayAddress(window.localStorage, relayAddress);
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
        aria-labelledby="remote-quick-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog__head">
          <span className="dialog__icon dialog__icon--inline" aria-hidden="true">
            <ScreenShareIcon size={18} />
          </span>
          <h2 className="dialog__title" id="remote-quick-title">
            {t("remote.quick.title")}
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
          <Callout tone="security" title={t("remote.quick.securityTitle")}>
            {t("remote.quick.securityBody")}
          </Callout>
          {problem && (
            <Callout tone="warn" title={t("remote.connect.failedTitle")}>
              {problem}
            </Callout>
          )}

          <div className="field">
            <label className="field__label" htmlFor="remote-quick-id">
              {t("remote.quick.deviceId")}
            </label>
            <input
              id="remote-quick-id"
              ref={idRef}
              className="input mono remote-quick-id"
              value={formatDeviceId(deviceId)}
              inputMode="numeric"
              placeholder="000 000 000"
              disabled={busy}
              onChange={(event) =>
                setDeviceId(
                  event.currentTarget.value.replace(/\D/g, "").slice(0, 9),
                )
              }
            />
            <p className="field__optional">{t("remote.quick.deviceIdHint")}</p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="remote-quick-code">
              {t("remote.connect.code")}
            </label>
            <div className="remote-code-field">
              <ShieldIcon size={16} />
              <input
                id="remote-quick-code"
                className="input mono"
                value={formattedCode}
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
          </div>

          <div className="field">
            <label className="field__label" htmlFor="remote-quick-relay">
              {t("remote.host.relayAddress")}
            </label>
            <input
              id="remote-quick-relay"
              className="input mono"
              value={relayAddress}
              disabled={busy}
              placeholder={t("remote.host.relayPlaceholder")}
              onChange={(event) => setRelayAddress(event.currentTarget.value)}
            />
            <small className="field__optional">
              {t("remote.quick.relayHint")}
            </small>
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
              {busy ? t("remote.connect.connecting") : t("remote.quick.submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
