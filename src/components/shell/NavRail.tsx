/**
 * Global navigation rail.
 *
 * Icon-only to keep horizontal space for real work; every button carries an
 * accessible name and a tooltip, and the current area is also named in the
 * view header, so the rail is never the only place a label appears.
 */

import { navigationItems, type ViewId } from "../../app/navigation";
import type { ThemeChoice } from "../../app/preferences";
import { LatticeMark, MoonIcon, SunIcon } from "../icons";

export function NavRail({
  current,
  onSelect,
  theme,
  resolvedTheme,
  onToggleTheme,
}: {
  current: ViewId;
  onSelect: (view: ViewId) => void;
  theme: ThemeChoice;
  resolvedTheme: "dark" | "light";
  onToggleTheme: () => void;
}) {
  const nextTheme = resolvedTheme === "dark" ? "light" : "dark";

  return (
    <nav className="rail" aria-label="Primary">
      <div className="rail__brand" title="LatticeTerm">
        <LatticeMark size={22} />
        <span className="visually-hidden">LatticeTerm</span>
      </div>

      <ul className="rail__items">
        {navigationItems.map((item) => {
          const Glyph = item.icon;
          const active = item.id === current;
          const planned = item.status === "planned";

          return (
            <li key={item.id}>
              <button
                type="button"
                className={`rail__item${active ? " is-active" : ""}`}
                aria-current={active ? "page" : undefined}
                onClick={() => onSelect(item.id)}
                data-tooltip={`${item.label}${planned ? " · Planned" : ""}`}
              >
                <Glyph size={18} />
                <span className="visually-hidden">
                  {item.label}
                  {planned ? " (planned)" : ""}
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
          className="rail__item rail__item--quiet"
          onClick={onToggleTheme}
          data-tooltip={`Switch to ${nextTheme} theme`}
          aria-label={`Switch to ${nextTheme} theme${
            theme === "system" ? ", overriding the system setting" : ""
          }`}
        >
          {resolvedTheme === "dark" ? <SunIcon size={18} /> : <MoonIcon size={18} />}
        </button>
      </div>
    </nav>
  );
}
