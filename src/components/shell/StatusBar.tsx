/**
 * Status bar.
 *
 * Two facts a user should never have to open a menu to check: where their
 * connection data is being kept, and whether a credential store exists yet.
 * Both come from the running build rather than from hand-written copy.
 */

import { useI18n } from "../../i18n";
import { Kbd } from "../common/Callout";
import type { StorageState } from "../../app/useStorageStatus";

export function StatusBar({
  profileCount,
  visibleCount,
  filterActive,
  vaultReady,
  version,
  storage,
}: {
  profileCount: number;
  visibleCount: number;
  filterActive: boolean;
  vaultReady: boolean;
  version: string;
  storage: StorageState;
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

      <span className="statusbar__item statusbar__item--quiet">
        {t("status.palette")} <Kbd keys={["Ctrl", "K"]} />
      </span>

      <span className="statusbar__item statusbar__item--quiet">
        {t("common.appName")} {version}
      </span>
    </footer>
  );
}
