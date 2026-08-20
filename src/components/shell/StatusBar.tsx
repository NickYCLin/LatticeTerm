/**
 * Status bar.
 *
 * Reports the two facts a user must be able to check without opening a menu:
 * where connection metadata is being kept, and whether a credential store
 * exists yet. Both are read from the running build, not hard-coded copy.
 */

import { Kbd } from "../common/Callout";
import { ShieldIcon, VaultIcon } from "../icons";

export function StatusBar({
  profileCount,
  visibleCount,
  filterActive,
  vaultReady,
  version,
}: {
  profileCount: number;
  visibleCount: number;
  filterActive: boolean;
  vaultReady: boolean;
  version: string;
}) {
  return (
    <footer className="statusbar">
      <span className="statusbar__item">
        {filterActive
          ? `${visibleCount} of ${profileCount} connections`
          : `${profileCount} connection${profileCount === 1 ? "" : "s"}`}
      </span>

      <span className="statusbar__divider" aria-hidden="true" />

      <span className="statusbar__item statusbar__item--warn">
        <ShieldIcon size={12} />
        In-memory only · not saved on exit
      </span>

      <span className="statusbar__divider" aria-hidden="true" />

      <span className="statusbar__item">
        <VaultIcon size={12} />
        Vault: {vaultReady ? "Unlocked" : "Not configured"}
      </span>

      <span className="statusbar__spacer" />

      <span className="statusbar__item statusbar__item--quiet">
        Command palette <Kbd keys={["Ctrl", "K"]} />
      </span>

      <span className="statusbar__divider" aria-hidden="true" />

      <span className="statusbar__item statusbar__item--quiet">
        LatticeTerm {version}
      </span>
    </footer>
  );
}
