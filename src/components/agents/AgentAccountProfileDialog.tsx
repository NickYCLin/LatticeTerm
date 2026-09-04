import { open } from "@tauri-apps/plugin-dialog";
import { useRef, useState } from "react";
import { displayPath } from "../../app/displayPath";
import { useI18n } from "../../i18n/context";
import { AgentIcon, CloseIcon, FolderIcon } from "../icons";
import { useModalFocus } from "../overlays/modalFocus";

export function AgentAccountProfileDialog({
  agentLabel,
  onSave,
  onCancel,
}: {
  agentLabel: string;
  /** `configDirectory` is null when LatticeTerm should create one. */
  onSave: (name: string, configDirectory: string | null) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [configDirectory, setConfigDirectory] = useState("");
  const [useExisting, setUseExisting] = useState(false);
  const [choosingDirectory, setChoosingDirectory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmedName = name.trim();

  useModalFocus({
    dialogRef,
    getInitialFocus: () => nameRef.current,
    onEscape: onCancel,
    escapeDisabled: choosingDirectory,
  });

  async function chooseDirectory() {
    setChoosingDirectory(true);
    setError(null);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("agents.account.chooseProfileDirectory"),
      });
      if (typeof selected === "string") setConfigDirectory(selected);
    } catch (reason) {
      setError(t("agents.account.profileFailed", {
        detail: reason instanceof Error ? reason.message : String(reason),
      }));
    } finally {
      setChoosingDirectory(false);
    }
  }

  return (
    <div
      className="scrim scrim--center"
      role="presentation"
      onMouseDown={() => {
        if (!choosingDirectory) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="dialog dialog--wide agent-account-profile-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-account-profile-title"
        aria-describedby="agent-account-profile-body"
        aria-busy={choosingDirectory || undefined}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog__head">
          <span className="dialog__icon dialog__icon--inline" aria-hidden="true">
            <AgentIcon size={18} />
          </span>
          <div>
            <h2 className="dialog__title" id="agent-account-profile-title">
              {t("agents.account.dialogTitle", { name: agentLabel })}
            </h2>
            <p className="dialog__body" id="agent-account-profile-body">
              {t("agents.account.dialogBody")}
            </p>
          </div>
          <button
            type="button"
            className="icon-button icon-button--sm"
            disabled={choosingDirectory}
            onClick={onCancel}
            aria-label={t("common.close")}
            style={{ marginLeft: "auto" }}
          >
            <CloseIcon size={14} />
          </button>
        </header>

        <div className="dialog__stack">
          <label className="field" htmlFor="agent-account-profile-name">
            <span className="field__label">{t("agents.account.profileName")}</span>
            <input
              ref={nameRef}
              id="agent-account-profile-name"
              className="input"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder={t("agents.account.profileNamePlaceholder")}
              maxLength={64}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>

          <p className="field__hint">{t("agents.account.profileHint")}</p>

          <details
            className="agent-account-profile-dialog__advanced"
            open={useExisting}
            onToggle={(event) => setUseExisting(event.currentTarget.open)}
          >
            <summary>{t("agents.account.advancedDirectory")}</summary>
            <div className="field">
              <span className="field__label">{t("agents.account.profileDirectory")}</span>
              <div className="agent-account-profile-dialog__directory">
                <button
                  type="button"
                  className="button button--secondary"
                  disabled={choosingDirectory}
                  onClick={() => void chooseDirectory()}
                >
                  <FolderIcon size={14} />
                  {configDirectory
                    ? t("agents.account.changeProfileDirectory")
                    : t("agents.account.chooseProfileDirectoryAction")}
                </button>
                <span className="agent-account-profile-dialog__path" title={configDirectory}>
                  {configDirectory
                    ? displayPath(configDirectory)
                    : t("agents.account.autoDirectory")}
                </span>
              </div>
              <p className="field__hint">{t("agents.account.existingDirectoryHint")}</p>
            </div>
          </details>

          {error && <p className="field__error" role="alert">{error}</p>}
        </div>

        <div className="dialog__actions">
          <button
            type="button"
            className="button button--ghost"
            disabled={choosingDirectory}
            onClick={onCancel}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={choosingDirectory || !trimmedName}
            onClick={() => onSave(trimmedName, useExisting && configDirectory ? configDirectory : null)}
          >
            {t("agents.account.saveProfile")}
          </button>
        </div>
      </div>
    </div>
  );
}
