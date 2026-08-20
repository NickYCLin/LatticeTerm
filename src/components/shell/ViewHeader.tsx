/** Header for the workspace column: area name, context and area actions. */

import type { ReactNode } from "react";
import { SidebarIcon } from "../icons";

export function ViewHeader({
  title,
  description,
  actions,
  onToggleSidebar,
  sidebarCollapsed,
  showSidebarToggle = true,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  onToggleSidebar: () => void;
  sidebarCollapsed: boolean;
  showSidebarToggle?: boolean;
}) {
  return (
    <header className="view-header">
      {showSidebarToggle && (
        <button
          type="button"
          className="icon-button"
          onClick={onToggleSidebar}
          aria-pressed={!sidebarCollapsed}
          aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          data-tooltip={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
        >
          <SidebarIcon />
        </button>
      )}

      <div className="view-header__text">
        <h1 className="view-header__title">{title}</h1>
        <p className="view-header__description">{description}</p>
      </div>

      {actions && <div className="view-header__actions">{actions}</div>}
    </header>
  );
}
