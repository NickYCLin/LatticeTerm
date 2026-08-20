import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { RdpApi } from "../../app/useRdpSessions";
import { connectionTarget, type ConnectionProfile } from "../../domain/connection";
import { useI18n } from "../../i18n";
import { Callout } from "../common/Callout";
import { CloseIcon, ScreenShareIcon, ShieldIcon } from "../icons";

export function RdpConnectFlow({
  profile,
  rdp,
  onConnected,
  onCancel,
}: {
  profile: ConnectionProfile;
  rdp: RdpApi;
  onConnected: (sessionId: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [certificate, setCertificate] = useState<{
    fingerprint: string;
    detail: string;
  } | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => passwordRef.current?.focus(), []);
  useEffect(() => {
    function close(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    document.addEventListener("keydown", close, true);
    return () => document.removeEventListener("keydown", close, true);
  }, [busy, onCancel]);

  async function attempt(trustedCertificateSha256?: string) {
    if (!profile.username.trim()) {
      setProblem(t("rdp.connect.noUsername"));
      return;
    }
    setBusy(true);
    setProblem(null);
    const outcome = await rdp.connect({
      profileId: profile.id,
      hostname: profile.hostname,
      port: profile.port,
      username: profile.username,
      password,
      domain: domain.trim() || undefined,
      width: 1280,
      height: 720,
      trustedCertificateSha256,
    });
    setBusy(false);
    if (outcome.outcome === "connected") {
      setPassword("");
      onConnected(outcome.sessionId);
    } else if (outcome.outcome === "certificateUnknown") {
      setCertificate({
        fingerprint: outcome.fingerprintSha256,
        detail: outcome.detail,
      });
    } else {
      setProblem(
        t("rdp.connect.failedBody", {
          stage: outcome.stage,
          detail: outcome.detail,
        }),
      );
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void attempt();
  }

  return (
    <div className="scrim scrim--center" role="presentation" onMouseDown={onCancel}>
      <div
        className="dialog dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rdp-connect-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog__head">
          <span className="dialog__icon dialog__icon--inline" aria-hidden="true">
            <ScreenShareIcon size={18} />
          </span>
          <h2 className="dialog__title" id="rdp-connect-title">
            {t("rdp.connect.title", { name: profile.name })}
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
          <Callout tone="security" title={t("rdp.connect.securityTitle")}>
            {t("rdp.connect.securityBody")}
          </Callout>
          {problem && (
            <Callout tone="warn" title={t("rdp.connect.failedTitle")}>
              {problem}
            </Callout>
          )}
          {certificate && (
            <Callout tone="warn" title={t("rdp.connect.certificateTitle")}>
              <div className="rdp-certificate">
                <span>{t("rdp.connect.certificateBody")}</span>
                <code>{certificate.fingerprint}</code>
                <small>{certificate.detail}</small>
                <button
                  type="button"
                  className="button button--danger"
                  disabled={busy}
                  onClick={() => void attempt(certificate.fingerprint)}
                >
                  {t("rdp.connect.trustOnce")}
                </button>
              </div>
            </Callout>
          )}

          <div className="field-grid field-grid--even">
            <div className="field">
              <label className="field__label" htmlFor="rdp-password">
                {t("rdp.connect.password")}
              </label>
              <input
                id="rdp-password"
                ref={passwordRef}
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                disabled={busy}
                onChange={(event) => setPassword(event.currentTarget.value)}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="rdp-domain">
                {t("rdp.connect.domain")}
              </label>
              <input
                id="rdp-domain"
                className="input"
                value={domain}
                disabled={busy}
                placeholder={t("rdp.connect.domainPlaceholder")}
                onChange={(event) => setDomain(event.currentTarget.value)}
              />
            </div>
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
              <ShieldIcon size={14} />
              {busy ? t("rdp.connect.connecting") : t("rdp.connect.submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
