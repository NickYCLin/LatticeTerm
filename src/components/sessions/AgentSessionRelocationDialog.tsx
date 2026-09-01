import { useEffect, useRef } from "react";
import type { AgentRelocationSummary } from "../../app/agentSessionRelocation";
import { displayPath } from "../../app/displayPath";
import { useI18n } from "../../i18n/context";
import { Callout } from "../common/Callout";
import { FolderIcon } from "../icons";
import { useModalFocus } from "../overlays/modalFocus";

export function AgentSessionRelocationDialog({
  name,
  sessionCount,
  fromDirectory,
  toDirectory,
  summary,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  name: string;
  sessionCount: number;
  fromDirectory: string;
  toDirectory: string;
  summary: AgentRelocationSummary;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const blocked = summary.unsupported > 0;
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useModalFocus({
    dialogRef,
    getInitialFocus: () => cancelRef.current,
    onEscape: onCancel,
    escapeDisabled: busy,
  });

  useEffect(() => {
    if (busy) dialogRef.current?.focus();
  }, [busy]);

  return (
    <div
      className="scrim scrim--center"
      role="presentation"
      onMouseDown={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="dialog dialog--wide"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="session-relocation-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog__head">
          <span className="dialog__icon dialog__icon--inline" aria-hidden="true">
            <FolderIcon size={18} />
          </span>
          <h2 className="dialog__title" id="session-relocation-title">
            {t("terminal.directory.dialogTitle", { name })}
          </h2>
        </header>
        <div className="dialog__stack">
          <p className="dialog__body">
            {t("terminal.directory.body", { count: sessionCount })}
          </p>
          <div className="session-relocation__paths">
            <div>
              <span className="field__label">
                {t("terminal.directory.current")}
              </span>
              <p className="dialog__body mono project-launcher__path">
                {displayPath(fromDirectory)}
              </p>
            </div>
            <div>
              <span className="field__label">
                {t("terminal.directory.next")}
              </span>
              <p className="dialog__body mono project-launcher__path">
                {displayPath(toDirectory)}
              </p>
            </div>
          </div>
          <Callout
            tone={blocked ? "danger" : "info"}
            title={
              blocked
                ? t("terminal.directory.unsupportedTitle")
                : t("terminal.directory.continuityTitle")
            }
          >
            {blocked
              ? t("terminal.directory.unsupportedBody")
              : t("terminal.directory.continuityBody", {
                  native: summary.native,
                  handoff: summary.handoff,
                  restart: summary.restart,
                })}
          </Callout>
          {error && (
            <Callout tone="danger" title={t("terminal.directory.failedTitle")}>
              <span className="mono">{error}</span>
            </Callout>
          )}
          <div className="dialog__actions">
            <button
              ref={cancelRef}
              type="button"
              className="button button--ghost"
              disabled={busy}
              onClick={onCancel}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={busy || blocked}
              onClick={onConfirm}
            >
              {busy
                ? t("terminal.directory.changing")
                : t("terminal.directory.confirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
