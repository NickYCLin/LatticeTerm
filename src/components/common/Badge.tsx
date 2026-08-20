/**
 * Badges.
 *
 * Every badge pairs its colour with a text label or an icon, so no state in
 * the interface is communicated by colour alone.
 */

import {
  findEnvironment,
  findProtocol,
  type Environment,
  type Protocol,
} from "../../domain/connection";
import {
  DesktopIcon,
  ScreenShareIcon,
  TerminalIcon,
  TransferIcon,
  type IconProps,
} from "../icons";
import type { ReactElement, ReactNode } from "react";

const protocolIcons: Record<Protocol, (props: IconProps) => ReactElement> = {
  ssh: TerminalIcon,
  sftp: TransferIcon,
  rdp: DesktopIcon,
  vnc: ScreenShareIcon,
};

export function ProtocolIcon({
  protocol,
  size = 16,
}: {
  protocol: Protocol;
  size?: number;
}) {
  const Glyph = protocolIcons[protocol];
  return <Glyph size={size} />;
}

/** The square protocol marker that anchors each connection row. */
export function ProtocolTile({
  protocol,
  size = "md",
}: {
  protocol: Protocol;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <span
      className={`protocol-tile protocol-tile--${size} protocol-${protocol}`}
      title={findProtocol(protocol).name}
    >
      <ProtocolIcon protocol={protocol} size={size === "lg" ? 20 : 16} />
    </span>
  );
}

export function ProtocolBadge({ protocol }: { protocol: Protocol }) {
  const definition = findProtocol(protocol);
  return (
    <span className={`badge badge--protocol protocol-${protocol}`}>
      <ProtocolIcon protocol={protocol} size={12} />
      {definition.name}
    </span>
  );
}

export function EnvironmentBadge({
  environment,
}: {
  environment: Environment;
}) {
  const definition = findEnvironment(environment);
  return (
    <span className={`badge badge--env env-${environment}`}>
      <span className="badge__dot" aria-hidden="true" />
      {definition.label}
    </span>
  );
}

export function TagChip({ label }: { label: string }) {
  return <span className="badge badge--tag">{label}</span>;
}

export type ChipTone = "neutral" | "accent" | "ok" | "info" | "warn" | "danger" | "planned";

export function Chip({
  tone = "neutral",
  icon,
  children,
}: {
  tone?: ChipTone;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span className={`badge badge--tone tone-${tone}`}>
      {icon}
      {children}
    </span>
  );
}

/**
 * The label for capability that does not exist yet. Used instead of a disabled
 * button, which would imply the feature is merely unavailable right now.
 */
export function PlannedChip({ milestone }: { milestone?: number }) {
  return (
    <span className="badge badge--tone tone-planned">
      Planned{milestone ? ` · Milestone ${milestone}` : ""}
    </span>
  );
}
