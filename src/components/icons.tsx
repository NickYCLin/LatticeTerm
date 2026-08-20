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
      d="M6 6 18 18M18 6 6 18"
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
      stroke="currentColor"
      strokeOpacity="0.35"
      strokeWidth="1.5"
    />
    <circle cx="6" cy="6" r="2.5" fill="currentColor" />
    <circle cx="18" cy="6" r="2.5" fill="currentColor" />
    <circle cx="6" cy="18" r="2.5" fill="currentColor" />
    <circle cx="18" cy="18" r="2.5" fill="currentColor" />
  </svg>
);

export const TerminalIcon: Glyph = (props) => (
  <Icon {...props}>
    <path d="M3 4.5 6.5 8 3 11.5" />
    <path d="M8.5 12h4.5" />
  </Icon>
);

export const TransferIcon: Glyph = (props) => (
  <Icon {...props}>
    <path d="M4.5 13V4m0 0L2.25 6.25M4.5 4l2.25 2.25" />
    <path d="M11.5 3v9m0 0 2.25-2.25M11.5 12l-2.25-2.25" />
  </Icon>
);

export const DesktopIcon: Glyph = (props) => (
  <Icon {...props}>
    <rect x="1.75" y="2.75" width="12.5" height="8.5" rx="1.25" />
    <path d="M5.5 13.75h5" />
  </Icon>
);

export const ScreenShareIcon: Glyph = (props) => (
  <Icon {...props}>
    <rect x="1.75" y="2.75" width="12.5" height="8.5" rx="1.25" />
    <path d="M5.5 13.75h5M8 5.25v4M6 7.25h4" />
  </Icon>
);

export const ConnectionsIcon: Glyph = (props) => (
  <Icon {...props}>
    <rect x="2" y="2.25" width="12" height="4.25" rx="1.25" />
    <rect x="2" y="9.5" width="12" height="4.25" rx="1.25" />
    <path d="M4.5 4.375h.01M4.5 11.625h.01" />
  </Icon>
);

export const TunnelIcon: Glyph = (props) => (
  <Icon {...props}>
    <path d="M2.5 13V8a5.5 5.5 0 0 1 11 0v5" />
    <path d="M6 13V8a2 2 0 0 1 4 0v5" />
  </Icon>
);

export const VaultIcon: Glyph = (props) => (
  <Icon {...props}>
    <rect x="2.75" y="7" width="10.5" height="6.75" rx="1.5" />
    <path d="M5.25 7V5a2.75 2.75 0 0 1 5.5 0v2" />
    <path d="M8 9.75v1.5" />
  </Icon>
);

export const ActivityIcon: Glyph = (props) => (
  <Icon {...props}>
    <path d="M1.5 8h3l2-4.5 3 9 2-4.5h3" />
  </Icon>
);

export const SettingsIcon: Glyph = (props) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="2.25" />
    <path d="M8 1.5v1.75M8 12.75v1.75M14.5 8h-1.75M3.25 8H1.5M12.6 3.4l-1.25 1.25M4.65 11.35 3.4 12.6M12.6 12.6l-1.25-1.25M4.65 4.65 3.4 3.4" />
  </Icon>
);

export const SearchIcon: Glyph = (props) => (
  <Icon {...props}>
    <circle cx="7.25" cy="7.25" r="4.5" />
    <path d="m10.75 10.75 3 3" />
  </Icon>
);

export const PlusIcon: Glyph = (props) => (
  <Icon {...props}>
    <path d="M8 3.25v9.5M3.25 8h9.5" />
  </Icon>
);

export const StarIcon = ({ size = 16, filled = false, ...props }: IconProps & { filled?: boolean }) => (
  <Icon size={size} fill={filled ? "currentColor" : "none"} {...props}>
    <path d="M8 2.25 9.8 5.9l4.05.6-2.93 2.83.69 4.02L8 11.45 4.39 13.35l.69-4.02L2.15 6.5l4.05-.6z" />
  </Icon>
);

export const EditIcon: Glyph = (props) => (
  <Icon {...props}>
    <path d="M11.15 2.6a1.55 1.55 0 0 1 2.2 2.2l-7.3 7.3-2.9.7.7-2.9z" />
    <path d="M9.9 3.85 12.1 6.05" />
  </Icon>
);

export const DuplicateIcon: Glyph = (props) => (
  <Icon {...props}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5v-1a1.5 1.5 0 0 0-1.5-1.5H4a1.5 1.5 0 0 0-1.5 1.5v5A1.5 1.5 0 0 0 4 11h1" />
  </Icon>
);

export const TrashIcon: Glyph = (props) => (
  <Icon {...props}>
    <path d="M2.75 4.25h10.5" />
    <path d="M6.25 4.25V3a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 .75.75v1.25" />
    <path d="M3.9 4.25 4.5 13a.9.9 0 0 0 .9.85h5.2a.9.9 0 0 0 .9-.85l.6-8.75" />
    <path d="M6.6 6.75v4.5M9.4 6.75v4.5" />
  </Icon>
);

export const CloseIcon: Glyph = (props) => (
  <Icon {...props}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Icon>
);

export const CheckIcon: Glyph = (props) => (
  <Icon {...props}>
    <path d="m3 8.5 3.25 3.25L13 4.5" />
  </Icon>
);

export const ChevronRightIcon: Glyph = (props) => (
  <Icon {...props}>
    <path d="m6 3.5 4.5 4.5L6 12.5" />
  </Icon>
);

export const ChevronDownIcon: Glyph = (props) => (
  <Icon {...props}>
    <path d="m3.5 6 4.5 4.5L12.5 6" />
  </Icon>
);

export const SidebarIcon: Glyph = (props) => (
  <Icon {...props}>
    <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
    <path d="M6.25 2.75v10.5" />
  </Icon>
);

export const InfoIcon: Glyph = (props) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="6.25" />
    <path d="M8 7.25v4M8 4.9h.01" />
  </Icon>
);

export const ShieldIcon: Glyph = (props) => (
  <Icon {...props}>
    <path d="M8 1.75 13 3.6v4.15c0 3.05-2.05 5.5-5 6.5-2.95-1-5-3.45-5-6.5V3.6z" />
    <path d="m5.9 7.9 1.5 1.5 2.8-2.9" />
  </Icon>
);

export const AlertIcon: Glyph = (props) => (
  <Icon {...props}>
    <path d="M8 2.25 14.5 13.5h-13z" />
    <path d="M8 6.5v3M8 11.4h.01" />
  </Icon>
);

export const RoadmapIcon: Glyph = (props) => (
  <Icon {...props}>
    <circle cx="4" cy="4" r="1.75" />
    <circle cx="12" cy="12" r="1.75" />
    <path d="M4 5.75V10a2.25 2.25 0 0 0 2.25 2.25h4" />
  </Icon>
);

export const SunIcon: Glyph = (props) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1.5v1.25M8 13.25v1.25M14.5 8h-1.25M2.75 8H1.5M12.6 3.4l-.9.9M4.3 11.7l-.9.9M12.6 12.6l-.9-.9M4.3 4.3l-.9-.9" />
  </Icon>
);

export const MoonIcon: Glyph = (props) => (
  <Icon {...props}>
    <path d="M13 9.6A5.6 5.6 0 0 1 6.4 3a5.75 5.75 0 1 0 6.6 6.6" />
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
