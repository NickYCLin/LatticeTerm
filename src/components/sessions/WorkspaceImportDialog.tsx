import type {
  PortableWorkspaceItem,
  WorkspaceTransferFile,
} from "../../app/workspaceTransfer";
import { useI18n } from "../../i18n/context";
import { Callout } from "../common/Callout";
import { ImportIcon } from "../icons";

interface WorkspaceImportGroup {
  groupKey: string;
  groupLabel: string;
  workingDirectory: string;
  items: PortableWorkspaceItem[];
}

function groupItems(items: readonly PortableWorkspaceItem[]): WorkspaceImportGroup[] {
  const groups = new Map<string, WorkspaceImportGroup>();
  for (const item of items) {
    const existing = groups.get(item.groupKey);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(item.groupKey, {
        groupKey: item.groupKey,
        groupLabel: item.groupLabel,
        workingDirectory: item.workingDirectory,
        items: [item],
      });
    }
  }
  return [...groups.values()];
}

export function WorkspaceImportDialog({
  transfer,
  unavailableCount,
  existingCount,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  transfer: WorkspaceTransferFile;
  unavailableCount: number;
  existingCount: number;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const groups = groupItems(transfer.items);
  const importableCount = Math.max(
    0,
    transfer.items.length - unavailableCount - existingCount,
  );
  const canImportLayout =
    transfer.sidebar.folders.length > 0 || existingCount > 0;

  return (
    <div
      className="scrim scrim--center"
      role="presentation"
      onMouseDown={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="dialog dialog--wide workspace-import"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="workspace-import-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog__head">
          <span className="dialog__icon dialog__icon--inline" aria-hidden="true">
            <ImportIcon size={18} />
          </span>
          <h2 className="dialog__title" id="workspace-import-title">
            {t("terminal.projects.importTitle")}
          </h2>
        </header>
        <div className="dialog__stack">
          <p className="dialog__body">
            {t("terminal.projects.importBody", {
              projects: new Set(transfer.items.map((item) => item.workingDirectory))
                .size,
              sessions: transfer.items.length,
              folders: transfer.sidebar.folders.length,
            })}
          </p>
          <div className="workspace-import__list">
            {groups.map((group) => (
              <div className="workspace-import__item" key={group.groupKey}>
                <strong className="truncate">{group.groupLabel}</strong>
                <span className="mono truncate" title={group.workingDirectory}>
                  {group.workingDirectory}
                </span>
                <small>
                  {group.items.map((item) => item.label).join(" · ")}
                </small>
              </div>
            ))}
          </div>
          {(unavailableCount > 0 || existingCount > 0) && (
            <Callout
              tone="warn"
              title={t("terminal.projects.importSkippedTitle")}
            >
              {t("terminal.projects.importSkipped", {
                unavailable: unavailableCount,
                existing: existingCount,
              })}
            </Callout>
          )}
          {error && (
            <Callout tone="danger" title={t("terminal.projects.importFailedTitle")}>
              <span className="mono">{error}</span>
            </Callout>
          )}
          <p className="dialog__body dialog__body--muted">
            {t("terminal.projects.importHint")}
          </p>
          <div className="dialog__actions">
            <button
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
              disabled={busy || (importableCount === 0 && !canImportLayout)}
              onClick={onConfirm}
            >
              {busy
                ? t("terminal.projects.importing")
                : importableCount > 0
                  ? t("terminal.projects.importAction", {
                      count: importableCount,
                    })
                  : canImportLayout
                    ? t("terminal.projects.importLayoutAction")
                    : t("terminal.projects.importAction", { count: 0 })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
