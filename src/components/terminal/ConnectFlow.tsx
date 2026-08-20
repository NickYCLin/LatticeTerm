/**
 * Everything between pressing Connect and having a terminal.
 *
 * The backend refuses to open a session for a host it does not already trust,
 * so this component drives the conversation that resolves that: ask for a
 * password, attempt the connection, and if the host key is unknown put the
 * fingerprint in front of the user before trying again. A key that has
 * *changed* ends the attempt — that decision is deliberately not one click
 * away.
 */

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  connectionTarget,
  type ConnectionProfile,
} from "../../domain/connection";
import type { ConnectOutcome, SshApi } from "../../app/useSshSessions";
import { useI18n } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { Callout } from "../common/Callout";
import { HostFingerprintDialog } from "../overlays/HostFingerprintDialog";
import { HostKeyChangedDialog } from "../overlays/HostKeyChangedDialog";
import { CloseIcon, TerminalIcon } from "../icons";
import type { HostFingerprint } from "../../domain/security";

/**
 * The dialogs describe a stored vault entry, while a live connection only has
 * what the server just presented. The identifiers are filled from the target
 * so the two shapes meet without inventing history that has not happened yet.
 */
function presented(
  host: string,
  port: number,
  algorithm: string,
  fingerprint: string,
  seen?: { firstSeenAt: number; lastSeenAt: number },
): HostFingerprint {
  return {
    id: `${host}:${port}`,
    host,
    port,
    algorithm,
    fingerprint,
    firstSeenAt: seen?.firstSeenAt ?? 0,
    lastSeenAt: seen?.lastSeenAt ?? 0,
  };
}

type Phase =
  | { step: "password" }
  | { step: "connecting" }
  | { step: "unknownHost"; outcome: Extract<ConnectOutcome, { outcome: "hostUnknown" }> }
  | { step: "changedHost"; outcome: Extract<ConnectOutcome, { outcome: "hostChanged" }> };

function stageKey(stage: string): MessageKey {
  const known = [
    "connect",
    "authenticate",
    "channel",
    "pty",
    "shell",
    "trust",
    "invoke",
  ];
  return (
    known.includes(stage) ? `connect.stage.${stage}` : "connect.stage.connect"
  ) as MessageKey;
}

export function ConnectFlow({
  profile,
  ssh,
  onConnected,
  onCancel,
}: {
  profile: ConnectionProfile;
  ssh: SshApi;
  onConnected: (sessionId: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>({ step: "password" });
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<{ title: string; body: string } | null>(
    null,
  );
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    passwordRef.current?.focus();
  }, [phase.step]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel]);

  async function attempt(secret: string) {
    setPhase({ step: "connecting" });
    setProblem(null);

    const outcome = await ssh.connect({
      profileId: profile.id,
      hostname: profile.hostname,
      port: profile.port,
      username: profile.username,
      auth: { kind: "password", password: secret },
      // A sensible starting size; the pane corrects it the moment it mounts.
      cols: 80,
      rows: 24,
    });

    switch (outcome.outcome) {
      case "connected":
        // The password has done its job; drop it rather than keep it in state.
        setPassword("");
        onConnected(outcome.sessionId);
        return;
      case "hostUnknown":
        setPhase({ step: "unknownHost", outcome });
        return;
      case "hostChanged":
        setPhase({ step: "changedHost", outcome });
        return;
      case "authFailed":
        setPhase({ step: "password" });
        setProblem({
          title: t("connect.failed.title"),
          body: t("connect.authFailed"),
        });
        return;
      default:
        setPhase({ step: "password" });
        setProblem({
          title: t("connect.failed.title"),
          body: t("connect.failed.body", {
            stage: t(stageKey(outcome.stage)),
            detail: outcome.detail,
          }),
        });
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile.username.trim()) {
      setProblem({
        title: t("connect.failed.title"),
        body: t("connect.noUsername"),
      });
      return;
    }
    void attempt(password);
  }

  if (phase.step === "unknownHost") {
    const { host, port, algorithm, fingerprint } = phase.outcome;
    return (
      <HostFingerprintDialog
        fingerprint={presented(host, port, algorithm, fingerprint)}
        onTrustAndSave={() => {
          void (async () => {
            await ssh.trustHost(host, port, algorithm, fingerprint);
            // Trust is recorded, so the same attempt now gets past the check.
            await attempt(password);
          })();
        }}
        onCancel={onCancel}
      />
    );
  }

  if (phase.step === "changedHost") {
    const { host, port, algorithm, receivedFingerprint, expected } =
      phase.outcome;
    return (
      <HostKeyChangedDialog
        host={host}
        port={port}
        expectedFingerprint={presented(
          host,
          port,
          expected.algorithm,
          expected.fingerprint,
          {
            firstSeenAt: expected.firstTrustedAt,
            lastSeenAt: expected.lastSeenAt,
          },
        )}
        receivedFingerprint={presented(
          host,
          port,
          algorithm,
          receivedFingerprint,
        )}
        onAbort={onCancel}
        onAcceptRiskAndReplace={() => {
          void (async () => {
            await ssh.trustHost(host, port, algorithm, receivedFingerprint);
            await attempt(password);
          })();
        }}
      />
    );
  }

  const busy = phase.step === "connecting";

  return (
    <div className="scrim scrim--center" role="presentation" onMouseDown={onCancel}>
      <div
        className="dialog dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog__head">
          <span className="dialog__icon dialog__icon--inline" aria-hidden="true">
            <TerminalIcon size={18} />
          </span>
          <h2 className="dialog__title" id="connect-title">
            {t("connect.title", { name: profile.name })}
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

        <form className="dialog__stack" onSubmit={submit}>
          <p className="dialog__body mono">{connectionTarget(profile)}</p>

          {problem && (
            <Callout tone="warn" title={problem.title}>
              {problem.body}
            </Callout>
          )}

          <div className="field">
            <label className="field__label" htmlFor="connect-password">
              {t("connect.password")}
            </label>
            <input
              id="connect-password"
              ref={passwordRef}
              className="input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
            <p className="field__optional">{t("connect.passwordHint")}</p>
          </div>

          <div className="dialog__actions">
            <button
              type="button"
              className="button button--ghost"
              onClick={onCancel}
            >
              {t("common.cancel")}
            </button>
            <button type="submit" className="button button--primary" disabled={busy}>
              {busy ? t("connect.connecting") : t("connect.submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
