import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { SensitiveClipboardClearChoice } from "../../app/preferences";
import { copySensitiveText } from "../../app/sensitiveClipboard";
import type { RemoteHostApi } from "../../app/useRemoteHost";
import { useI18n } from "../../i18n";
import { Callout } from "../common/Callout";
import { CloseIcon, CopyIcon, ScreenShareIcon, ShieldIcon } from "../icons";

export function RemoteHostDialog({
  host,
  sensitiveClipboardClear,
  onClose,
}: {
  host: RemoteHostApi;
  sensitiveClipboardClear: SensitiveClipboardClearChoice;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [bindAddress, setBindAddress] = useState("127.0.0.1");
  const [port, setPort] = useState(44_900);
  const [fps, setFps] = useState(5);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState<"address" | "code" | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1_000));

  useEffect(() => {
    if (!host.status) return;
    const timer = window.setInterval(
      () => setNow(Math.floor(Date.now() / 1_000)),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [host.status]);

  useEffect(() => {
    function close(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", close, true);
    return () => document.removeEventListener("keydown", close, true);
  }, [busy, onClose]);

  const secondsRemaining = Math.max(
    0,
    (host.status?.expiresAt ?? now) - now,
  );
  const expiry = useMemo(() => {
    const minutes = Math.floor(secondsRemaining / 60)
      .toString()
      .padStart(2, "0");
    const seconds = (secondsRemaining % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  }, [secondsRemaining]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    host.clearClosedReason();
    try {
      await host.start({ bindAddress: bindAddress.trim(), port, fps });
      setNow(Math.floor(Date.now() / 1_000));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    setProblem(null);
    try {
      await host.stop();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function copy(kind: "address" | "code", value: string) {
    try {
      if (kind === "code") {
        await copySensitiveText(value, sensitiveClipboardClear);
      } else {
        await navigator.clipboard.writeText(value);
      }
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1_500);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }

  const statusLabel = host.status
    ? t(`remote.host.state.${host.status.state}`)
    : null;

  return (
    <div
      className="scrim scrim--center"
      role="presentation"
      onMouseDown={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="dialog dialog--wide remote-host-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="remote-host-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog__head">
          <span className="dialog__icon dialog__icon--inline" aria-hidden="true">
            <ScreenShareIcon size={18} />
          </span>
          <h2 className="dialog__title" id="remote-host-title">
            {t("remote.host.title")}
          </h2>
          <button
            type="button"
            className="icon-button icon-button--sm"
            onClick={onClose}
            disabled={busy}
            aria-label={t("common.close")}
            style={{ marginLeft: "auto" }}
          >
            <CloseIcon size={14} />
          </button>
        </header>

        <div className="dialog__stack">
          <Callout tone="security" title={t("remote.host.securityTitle")}>
            {t("remote.host.securityBody")}
          </Callout>

          {(problem || host.closedReason) && (
            <Callout tone="warn" title={t("remote.host.problemTitle")}>
              {problem ?? host.closedReason}
            </Callout>
          )}

          {host.status ? (
            <div className="remote-host-active">
              <div className="remote-host-state">
                <span
                  className={`remote-host-state__dot state-${host.status.state}`}
                  aria-hidden="true"
                />
                <div>
                  <strong>{statusLabel}</strong>
                  <small>
                    {host.status.peer
                      ? t("remote.host.peer", { peer: host.status.peer })
                      : t("remote.host.waiting")}
                  </small>
                </div>
              </div>

              <div className="remote-host-share-grid">
                <div className="remote-host-value">
                  <span>{t("remote.host.address")}</span>
                  <code>{host.status.address}</code>
                  <button
                    type="button"
                    className="icon-button icon-button--sm"
                    onClick={() => void copy("address", host.status!.address)}
                    aria-label={t("remote.host.copyAddress")}
                  >
                    <CopyIcon size={13} />
                  </button>
                </div>
                {host.status.pairingCode && (
                  <div className="remote-host-value remote-host-value--code">
                    <span>{t("remote.host.code")}</span>
                    <code>{host.status.pairingCode}</code>
                    <button
                      type="button"
                      className="icon-button icon-button--sm"
                      onClick={() =>
                        void copy("code", host.status!.pairingCode)
                      }
                      aria-label={t("remote.host.copyCode")}
                    >
                      <CopyIcon size={13} />
                    </button>
                  </div>
                )}
              </div>

              {host.status.state !== "streaming" && (
                <div className="remote-host-expiry">
                  <ShieldIcon size={14} />
                  <span>{t("remote.host.expires", { time: expiry })}</span>
                  <span>
                    {t("remote.host.attempts", {
                      count: host.status.attemptsRemaining,
                    })}
                  </span>
                </div>
              )}

              {copied && (
                <p className="text-muted" aria-live="polite">
                  {copied === "code" && sensitiveClipboardClear !== "off"
                    ? t("remote.host.copiedAutoClear", {
                        seconds: sensitiveClipboardClear,
                      })
                    : t("remote.host.copied")}
                </p>
              )}

              <div className="dialog__actions">
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={onClose}
                  disabled={busy}
                >
                  {t("remote.host.keepRunning")}
                </button>
                <button
                  type="button"
                  className="button button--danger"
                  onClick={() => void stop()}
                  disabled={busy}
                >
                  {busy ? t("remote.host.stopping") : t("remote.host.stop")}
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit}>
              <div className="field-grid field-grid--even">
                <div className="field">
                  <label className="field__label" htmlFor="remote-host-address">
                    {t("remote.host.bindAddress")}
                  </label>
                  <input
                    id="remote-host-address"
                    className="input mono"
                    value={bindAddress}
                    disabled={busy}
                    onChange={(event) => setBindAddress(event.currentTarget.value)}
                  />
                  <small className="field__optional">
                    {t("remote.host.bindHint")}
                  </small>
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="remote-host-port">
                    {t("remote.host.port")}
                  </label>
                  <input
                    id="remote-host-port"
                    className="input mono"
                    type="number"
                    min={1}
                    max={65_535}
                    value={port}
                    disabled={busy}
                    onChange={(event) => setPort(Number(event.currentTarget.value))}
                  />
                </div>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="remote-host-fps">
                  {t("remote.host.frameRate", { fps })}
                </label>
                <input
                  id="remote-host-fps"
                  type="range"
                  min={1}
                  max={10}
                  value={fps}
                  disabled={busy}
                  onChange={(event) => setFps(Number(event.currentTarget.value))}
                />
              </div>

              <div className="dialog__actions">
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={onClose}
                  disabled={busy}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  className="button button--primary"
                  disabled={busy}
                >
                  <ScreenShareIcon size={14} />
                  {busy ? t("remote.host.starting") : t("remote.host.start")}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
