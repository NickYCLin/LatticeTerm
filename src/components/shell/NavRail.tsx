/**
 * Global navigation rail.
 *
 * Icon-only to leave the width for real work; every button carries an
 * accessible name and a tooltip, and the current area is named again in the
 * view header, so the rail is never the only place a label appears.
 */

import { navigationItems, type ViewId } from "../../app/navigation";
import { findTheme, oppositeTheme, type ThemeId } from "../../app/themes";
import { useI18n } from "../../i18n";
import { LatticeMark, MoonIcon, SunIcon } from "../icons";

export function NavRail({
  current,
  onSelect,
  activeTheme,
  onToggleTheme,
}: {
  current: ViewId;
  onSelect: (view: ViewId) => void;
  activeTheme: ThemeId;
  onToggleTheme: () => void;
}) {
  const { t } = useI18n();
  const next = oppositeTheme(activeTheme);
  const themeLabel = `${t("a11y.switchTheme")}: ${t(findTheme(next).labelKey)}`;

  return (
    <nav className="rail glass glass--sheen" aria-label={t("a11y.primaryNav")}>
      <div className="rail__brand" title={t("common.appName")}>
        <LatticeMark size={24} />
        <span className="visually-hidden">{t("common.appName")}</span>
      </div>

      <ul className="rail__items">
        {navigationItems.map((item) => {
          const Glyph = item.icon;
          const active = item.id === current;
          const planned = item.status === "planned";
          const label = t(item.labelKey);

          return (
            <li key={item.id}>
              <button
                type="button"
                className={`rail__item${active ? " is-active" : ""}`}
                aria-current={active ? "page" : undefined}
                onClick={() => onSelect(item.id)}
                data-tooltip={
                  planned ? `${label} · ${t("planned.badge")}` : label
                }
              >
                <Glyph size={19} />
                <span className="visually-hidden">
                  {planned ? `${label}（${t("planned.badge")}）` : label}
                </span>
                {planned && <span className="rail__flag" aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="rail__footer">
        <button
          type="button"
          className="rail__item"
          onClick={onToggleTheme}
          data-tooltip={themeLabel}
          aria-label={themeLabel}
        >
          {findTheme(activeTheme).isDark ? (
            <SunIcon size={19} />
          ) : (
            <MoonIcon size={19} />
          )}
        </button>
      </div>
    </nav>
  );
}
