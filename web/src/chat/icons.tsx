import type { ReactNode } from 'react';

/** Small line icons. They are decorative: the text next to them carries the meaning. */
function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      className="adn-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function HeartIcon() {
  return (
    <Icon>
      <path d="M12 20s-7.5-4.4-7.5-10.1A4.4 4.4 0 0 1 12 7.1a4.4 4.4 0 0 1 7.5 2.8C19.5 15.6 12 20 12 20Z" />
    </Icon>
  );
}

export function BackIcon() {
  return (
    <Icon size={18}>
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </Icon>
  );
}

export function RestartIcon() {
  return (
    <Icon size={18}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5" />
      <path d="M3.5 3.5v5h5" />
    </Icon>
  );
}

export function SendIcon() {
  return (
    <Icon>
      <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
    </Icon>
  );
}

export function ChevronIcon() {
  return (
    <Icon size={18}>
      <path d="m9 6 6 6-6 6" />
    </Icon>
  );
}

export function ExternalIcon() {
  return (
    <Icon size={18}>
      <path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
    </Icon>
  );
}
