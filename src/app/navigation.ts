/**
 * Primary navigation registry.
 *
 * `status` is what the interface promises the user: `available` areas do real
 * work, `planned` areas describe an upcoming milestone and never show controls
 * that pretend to act.
 */

import {
  ActivityIcon,
  ConnectionsIcon,
  SettingsIcon,
  TunnelIcon,
  VaultIcon,
  type IconProps,
} from "../components/icons";
import type { ReactElement } from "react";

export type ViewId =
  | "connections"
  | "tunnels"
  | "vault"
  | "activity"
  | "settings";

export interface NavigationItem {
  id: ViewId;
  label: string;
  /** Read by assistive technology and shown in the rail tooltip. */
  description: string;
  icon: (props: IconProps) => ReactElement;
  status: "available" | "planned";
  milestone?: number;
}

export const navigationItems: NavigationItem[] = [
  {
    id: "connections",
    label: "Connections",
    description: "Find, organise and edit remote hosts",
    icon: ConnectionsIcon,
    status: "available",
  },
  {
    id: "tunnels",
    label: "Tunnels",
    description: "Local, remote and dynamic port forwarding",
    icon: TunnelIcon,
    status: "planned",
    milestone: 4,
  },
  {
    id: "vault",
    label: "Key vault",
    description: "Keys, credentials and host trust",
    icon: VaultIcon,
    status: "planned",
    milestone: 2,
  },
  {
    id: "activity",
    label: "Activity",
    description: "Changes made in this workspace session",
    icon: ActivityIcon,
    status: "available",
  },
  {
    id: "settings",
    label: "Settings",
    description: "Appearance, security and network preferences",
    icon: SettingsIcon,
    status: "available",
  },
];

export function findNavigationItem(id: ViewId): NavigationItem {
  return navigationItems.find((item) => item.id === id)!;
}
