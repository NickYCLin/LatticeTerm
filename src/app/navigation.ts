/**
 * Primary navigation registry.
 *
 * `status` is what the interface promises: `available` areas do real work,
 * `planned` areas describe what is coming and never show a control that
 * pretends to act.
 */

import {
  ActivityIcon,
  ConnectionsIcon,
  SettingsIcon,
  TunnelIcon,
  VaultIcon,
  type IconProps,
} from "../components/icons";
import type { MessageKey } from "../i18n/messages/zh-TW";
import type { ReactElement } from "react";

export type ViewId =
  | "connections"
  | "tunnels"
  | "vault"
  | "activity"
  | "settings";

export interface NavigationItem {
  id: ViewId;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
  icon: (props: IconProps) => ReactElement;
  status: "available" | "planned";
}

export const navigationItems: NavigationItem[] = [
  {
    id: "connections",
    labelKey: "nav.connections",
    descriptionKey: "nav.connections.desc",
    icon: ConnectionsIcon,
    status: "available",
  },
  {
    id: "tunnels",
    labelKey: "nav.tunnels",
    descriptionKey: "nav.tunnels.desc",
    icon: TunnelIcon,
    status: "planned",
  },
  {
    id: "vault",
    labelKey: "nav.vault",
    descriptionKey: "nav.vault.desc",
    icon: VaultIcon,
    status: "available",
  },
  {
    id: "activity",
    labelKey: "nav.activity",
    descriptionKey: "nav.activity.desc",
    icon: ActivityIcon,
    status: "available",
  },
  {
    id: "settings",
    labelKey: "nav.settings",
    descriptionKey: "nav.settings.desc",
    icon: SettingsIcon,
    status: "available",
  },
];

export function findNavigationItem(id: ViewId): NavigationItem {
  return navigationItems.find((item) => item.id === id)!;
}
