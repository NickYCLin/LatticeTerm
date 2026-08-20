/**
 * Icon set.
 *
 * Drawn in-house on a 16px grid with a 1.5px stroke so the whole interface
 * shares one weight, and so the repository carries no third-party icon
 * licence. Emoji are never used as functional icons.
 */

import type { ReactElement, ReactNode, SVGProps } from "react";

export type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  size?: number;
};

function Icon({
  size = 16,
  children,
  ...props
}: IconProps & { children?: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

type Glyph = (props: IconProps) => ReactElement;

export const LatticeMark = ({ size = 20, ...props }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <path
      d="M6 6L18 18M18 6L6 18"
      stroke="currentColor"
      strokeOpacity="0.45"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <rect
      x="6"
      y="6"
      width="12"
      height="12"
      rx="2"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <circle cx="6" cy="6" r="1.75" fill="currentColor" />
    <circle cx="18" cy="6" r="1.75" fill="currentColor" />
    <circle cx="6" cy="18" r="1.75" fill="currentColor" />
    <circle cx="18" cy="18" r="1.75" fill="currentColor" />
    <circle cx="12" cy="12" r="2" fill="currentColor" />
  </svg>
);

export const ConnectionsIcon: Glyph = (props) => (
  <Icon {...props}>
    <circle cx="4" cy="4" r="2.25" />
    <circle cx="12" cy="4" r="2.25" />
    <circle cx="8" cy="12" r="2.25" />
    <path d="M5.6 5.6 6.8 10M10.4 5.6 9.2 10" />
  </Icon>
);

export const TunnelIcon: Glyph = (props) => (
  <Icon {...props}>
    <rect x="2" y="3" width="12" height="10" rx="2" />
    <path d="M6 6.5 4.5 8 6 9.5M10 6.5l1.5 1.5L10 9.5M8 6v4" />
  </Icon>
);

export const VaultIcon: Glyph = (props) => (
  <Icon {...props}>
    <rect x="2.5" y="6" width="11" height="8" rx="1.5" />
    <path d="M5 6V4.5a3 3 0 0 1 6 0V6" />
    <circle cx="8" cy="10" r="1" fill="currentColor" />
  </Icon>
);

export const ActivityIcon: Glyph = (props) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.5v3.8l2.5 1.5" />
  </Icon>
);

export const SettingsIcon: Glyph = (props) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="2.25" />
    <path d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.6 3.6l1.05 1.05M11.35 11.35l1.05 1.05M3.6 12.4l1.05-1.05M11.35 4.65l1.05-1.05" />
  </Icon>
);

export const SearchIcon: Glyph = (props) => (
  <Icon {...props}>
    <circle cx="7" cy="7" r="4.25" />
    <path d="m10.25 10.25 3.5 3.5" />
  </Icon>
);

export const PlusIcon: Glyph = (props) => (
  <Icon {...props}>
    <path d="M8 3v10M3 8h10" />
  </Icon>
);

export const CloseIcon: Glyph = (props) => (
  <Icon {...props}>
    <path d="m3.5 3.5 9 9M12.5 3.5l-9 9" />
  </Icon>
);

export const ChevronDownIcon: Glyph = (props) => (
  <Icon {...props}>
    <path d="m4 6 4 4 4-4" />
  </Icon>
);

export const ChevronRightIcon: Glyph = (props) => (
  <Icon {...props}>
    <path d="m6 4 4 4-4 4" />
  </Icon>
);

export const StarIcon = ({
  size = 16,
  filled = false,
  ...props
}: IconProps & { filled?: boolean }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill={filled ? "currentColor" : "none"}
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <path d="m8 2 1.8 3.6 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4L2.2 6.2l4-.6L8 2z" />
  </svg>
);

export const SidebarIcon: Glyph = (props) => (
  <Icon {...props}>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <path d="M6 2.5v11" />
  </Icon>
);

export const EditIcon: Glyph = (props) => (
  <Icon {...props}>
    <path d="M3 13h2.5L13 5.5 10.5 3 3 10.5V13z" />
    <path d="m9.5 4 2.5 2.5" />
  </Icon>
);

export const DuplicateIcon: Glyph = (props) => (
  <Icon {...props}>
    <rect x="5" y="5" width="8" height="8" rx="1.5" />
    <path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H11" />
  </Icon>
);

export const TrashIcon: Glyph = (props) => (
  <Icon {...props}>
    <path d="M2.5 4h11M5.5 4V2.5A1.5 1.5 0 0 1 7 1h2a1.5 1.5 0 0 1 1.5 1.5V4M4 4v9a1.5 1.5 0 0 0 1.5 1.5h5A1.5 1.5 0 0 0 12 13V4" />
  </Icon>
);

export const SunIcon: Glyph = (props) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
  </Icon>
);

export const MoonIcon: Glyph = (props) => (
  <Icon {...props}>
    <path d="M13.2 9.8A5.5 5.5 0 1 1 6.2 2.8 4.75 4.75 0 0 0 13.2 9.8z" />
  </Icon>
);

export const ShieldIcon: Glyph = (props) => (
  <Icon {...props}>
    <path d="M8 2 3 4.2v4.3c0 3.2 2.5 5.3 5 6 2.5-.7 5-2.8 5-6V4.2L8 2z" />
  </Icon>
);

export const KeyIcon: Glyph = (props) => (
  <Icon {...props}>
    <circle cx="5.5" cy="8" r="3" />
    <path d="M8.5 8H14M11.5 8V10M13.5 8v1.5" />
  </Icon>
);

export const TerminalIcon: Glyph = (props) => (
  <Icon {...props}>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <path d="m5 6 2 2-2 2M9 10h2.5" />
  </Icon>
);

export const FolderIcon: Glyph = (props) => (
  <Icon {...props}>
    <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.5 1.5h4.9A1.5 1.5 0 0 1 14 6v6.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-8z" />
  </Icon>
);

export const DesktopIcon: Glyph = (props) => (
  <Icon {...props}>
    <rect x="2" y="2.5" width="12" height="8.5" rx="1.5" />
    <path d="M5.5 13.5h5M8 11v2.5" />
  </Icon>
);

export const CheckIcon: Glyph = (props) => (
  <Icon {...props}>
    <path d="m3 8.5 3.5 3.5L13 4" />
  </Icon>
);

export const AlertIcon: Glyph = (props) => (
  <Icon {...props}>
    <path d="M8 2.2 1.8 13h12.4L8 2.2z" />
    <path d="M8 6.5v3M8 11.5v.01" />
  </Icon>
);

export const PlayIcon: Glyph = (props) => (
  <Icon {...props}>
    <path d="m4.5 3 8 5-8 5V3z" />
  </Icon>
);

export const TagIcon: Glyph = (props) => (
  <Icon {...props}>
    <path d="M2.5 8.5 8 3h4.5v4.5l-5.5 5.5a1.4 1.4 0 0 1-2 0l-3-3a1.4 1.4 0 0 1 0-2z" />
    <circle cx="10" cy="5.5" r=".75" fill="currentColor" />
  </Icon>
);

export const InfoIcon: Glyph = (props) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 7v4M8 5v.01" />
  </Icon>
);

export const RoadmapIcon: Glyph = (props) => (
  <Icon {...props}>
    <circle cx="4" cy="4" r="1.75" />
    <circle cx="12" cy="12" r="1.75" />
    <path d="M4 5.75V10a2.25 2.25 0 0 0 2.25 2.25h4" />
  </Icon>
);

export const KeyboardIcon: Glyph = (props) => (
  <Icon {...props}>
    <rect x="1.5" y="3.75" width="13" height="8.5" rx="1.5" />
    <path d="M4.25 6.5h.01M6.75 6.5h.01M9.25 6.5h.01M11.75 6.5h.01M5 9.5h6" />
  </Icon>
);

export const ImportIcon: Glyph = (props) => (
  <Icon {...props}>
    <path d="M8 2.25v7.5m0 0L5.5 7.25M8 9.75l2.5-2.5" />
    <path d="M2.75 11.25v1.25a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5v-1.25" />
  </Icon>
);

export const ExportIcon: Glyph = (props) => (
  <Icon {...props}>
    <path d="M8 9.75V2.25m0 0L5.5 4.75M8 2.25l2.5 2.5" />
    <path d="M2.75 11.25v1.25a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5v-1.25" />
  </Icon>
);

export const CopyIcon: Glyph = (props) => (
  <Icon {...props}>
    <rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.5" />
    <path d="M3.5 10.5V3.5A1.5 1.5 0 0 1 5 2h7" />
  </Icon>
);

export const ScreenShareIcon: Glyph = (props) => (
  <Icon {...props}>
    <rect x="2" y="2.5" width="12" height="9" rx="1.5" />
    <path d="M5.5 14h5M8 11.5V14" />
  </Icon>
);

export const TransferIcon: Glyph = (props) => (
  <Icon {...props}>
    <path d="m4.5 4.5 7 7M11.5 4.5v7h-7" />
  </Icon>
);

export const MemoryIcon: Glyph = (props) => (
  <Icon {...props}>
    <rect x="1.75" y="4.75" width="12.5" height="6.5" rx="1.25" />
    <path d="M4.75 7.25v1.5M8 7.25v1.5M11.25 7.25v1.5" />
  </Icon>
);

export const DiskIcon: Glyph = (props) => (
  <Icon {...props}>
    <ellipse cx="8" cy="4.25" rx="5.25" ry="2.25" />
    <path d="M2.75 4.25v7.5c0 1.24 2.35 2.25 5.25 2.25s5.25-1.01 5.25-2.25v-7.5" />
    <path d="M2.75 8c0 1.24 2.35 2.25 5.25 2.25s5.25-1.01 5.25-2.25" />
  </Icon>
);

export const CpuIcon: Glyph = (props) => (
  <Icon {...props}>
    <rect x="4.25" y="4.25" width="7.5" height="7.5" rx="1.25" />
    <path d="M6.5 1.75v2.5M9.5 1.75v2.5M6.5 11.75v2.5M9.5 11.75v2.5M1.75 6.5h2.5M1.75 9.5h2.5M11.75 6.5h2.5M11.75 9.5h2.5" />
  </Icon>
);

export const DatabaseIcon: Glyph = (props) => (
  <Icon {...props}>
    <ellipse cx="8" cy="4.25" rx="5.25" ry="2.25" />
    <path d="M2.75 4.25v7.5c0 1.24 2.35 2.25 5.25 2.25s5.25-1.01 5.25-2.25v-7.5" />
    <path d="M2.75 8c0 1.24 2.35 2.25 5.25 2.25s5.25-1.01 5.25-2.25" />
  </Icon>
);

export const RefreshIcon: Glyph = (props) => (
  <Icon {...props}>
    <path d="M13.25 8a5.25 5.25 0 1 1-1.6-3.77" />
    <path d="M13.25 2.5V5h-2.5" />
  </Icon>
);

export const GlobeIcon: Glyph = (props) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="6.25" />
    <path d="M1.9 6.25h12.2M1.9 9.75h12.2" />
    <path d="M8 1.75c1.8 2 2.7 4.1 2.7 6.25S9.8 12.25 8 14.25c-1.8-2-2.7-4.1-2.7-6.25S6.2 3.75 8 1.75z" />
  </Icon>
);

export const PaletteIcon: Glyph = (props) => (
  <Icon {...props}>
    <path d="M8 1.75a6.25 6.25 0 0 0 0 12.5c.9 0 1.35-.6 1.35-1.25 0-.7-.5-1.05-.5-1.65 0-.5.4-.9.95-.9h1.2a3.25 3.25 0 0 0 3.25-3.25c0-3-2.8-5.45-6.25-5.45z" />
    <path d="M5 7.25h.01M7.25 4.75h.01M10.25 5.75h.01" />
  </Icon>
);

export const ClockIcon: Glyph = (props) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="6.25" />
    <path d="M8 4.5V8l2.25 1.5" />
  </Icon>
);
