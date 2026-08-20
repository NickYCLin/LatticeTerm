/**
 * Badges.
 *
 * Every badge pairs its colour with a label or an icon, so no state in the
 * interface is communicated by colour alone.
 */

import {
  environmentLabelKey,
  findProtocol,
  protocolLabelKey,
  type Environment,
  type Protocol,
} from "../../domain/connection";
import { useI18n } from "../../i18n";
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
  lattice: ScreenShareIcon,
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

/** The rounded protocol marker that anchors each card. */
export function ProtocolTile({
  protocol,
  size = "md",
}: {
  protocol: Protocol;
  size?: "sm" | "md" | "lg";
}) {
  const { t } = useI18n();

  return (
    <span
      className={`protocol-tile protocol-tile--${size} protocol-${protocol}`}
      title={t(protocolLabelKey(protocol))}
    >
      <ProtocolIcon
        protocol={protocol}
        size={size === "lg" ? 22 : size === "sm" ? 14 : 18}
      />
    </span>
  );
}

export function ProtocolBadge({ protocol }: { protocol: Protocol }) {
  return (
    <span className={`badge protocol-${protocol}`}>
      <ProtocolIcon protocol={protocol} size={12} />
      {findProtocol(protocol).acronym}
    </span>
  );
}

export function EnvironmentBadge({ environment }: { environment: Environment }) {
  const { t } = useI18n();

  return (
    <span className={`badge env-${environment}`}>
      <span className="badge__dot" aria-hidden="true" />
      {t(environmentLabelKey(environment))}
    </span>
  );
}

export function TagChip({ label }: { label: string }) {
  return <span className="badge badge--tag">{label}</span>;
}

export type ChipTone =
  | "neutral"
  | "accent"
  | "ok"
  | "info"
  | "warn"
  | "danger"
  | "planned";

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
    <span className={`badge tone-${tone}`}>
      {icon}
      {children}
    </span>
  );
}

/**
 * The label for capability that does not exist yet, used instead of a disabled
 * button — which would imply the feature is merely unavailable right now.
 */
export function PlannedChip() {
  const { t } = useI18n();
  return <Chip tone="planned">{t("planned.badge")}</Chip>;
}
