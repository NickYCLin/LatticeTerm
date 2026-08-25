/**
 * Status bar.
 *
 * Two facts a user should never have to open a menu to check: where their
 * connection data is being kept, and whether a credential store exists yet.
 * Both come from the running build rather than from hand-written copy.
 */

import { useI18n } from "../../i18n/context";
import { Kbd } from "../common/Callout";
import type { StorageState } from "../../app/useStorageStatus";
import type { AppUpdater } from "../../app/useAppUpdater";

function updaterLabel(updater: AppUpdater, t: ReturnType<typeof useI18n>["t"]) {
  switch (updater.status) {
    case "checking":
      return t("status.updater.checking");
    case "up-to-date":
      return t("status.updater.upToDate");
    case "available":
      return t("status.updater.available", {
        version: updater.availableVersion ?? "",
      });
    case "downloading":
      return t("status.updater.downloading");
    case "installing":
      return t("status.updater.installing");
    case "downloaded":
      return t("status.updater.downloaded");
    case "error":
      return t("status.updater.error");
    default:
      return t("status.updater.idle");
  }
}

export function StatusBar({
  profileCount,
  visibleCount,
  filterActive,
  vaultReady,
  version,
  storage,
  updater,
  onUpdateClick,
}: {
  profileCount: number;
  visibleCount: number;
  filterActive: boolean;
  vaultReady: boolean;
  version: string;
  storage: StorageState;
  updater?: AppUpdater;
  onUpdateClick?: () => void;
}) {
  const { t } = useI18n();

  return (
    <footer className="statusbar">
      <span className="statusbar__item">
        {filterActive
          ? t("status.connectionsFiltered", {
              visible: visibleCount,
              total: profileCount,
            })
          : t("status.connections", { count: profileCount })}
      </span>

      <span
        className="statusbar__item statusbar__item--quiet"
        title={storage.status?.path}
      >
        {storage.mode === "persistent"
          ? t("status.savedLocally")
          : t("status.notSaved")}
      </span>

      <span className="statusbar__item statusbar__item--quiet">
        {t("status.vault", {
          state: vaultReady ? t("status.vault.ready") : t("status.vault.locked"),
        })}
      </span>

      <span className="statusbar__spacer" />

      {updater && (
        <button
          type="button"
          className={`statusbar__item statusbar__item--quiet statusbar__action statusbar__update--${updater.status}`}
          onClick={onUpdateClick}
          disabled={updater.status === "checking" || updater.status === "downloading" || updater.status === "installing"}
          title={updater.error ?? t("settings.updater.autoCheckHint")}
          aria-live="polite"
        >
          {updaterLabel(updater, t)}
        </button>
      )}

      <span className="statusbar__item statusbar__item--quiet">
        {t("status.palette")} <Kbd keys={["Ctrl", "K"]} />
      </span>

      <span className="statusbar__item statusbar__item--quiet">
        {t("common.appName")} {version}
      </span>
    </footer>
  );
}
