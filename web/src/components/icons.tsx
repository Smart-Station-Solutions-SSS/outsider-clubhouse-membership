import type { SVGProps } from 'react';

// Minimal stroke icon set (24px grid, currentColor).

type P = SVGProps<SVGSVGElement>;
const base = (p: P) => ({
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...p,
});

export const Check = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
export const Arrow = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
export const Shield = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);
export const IdCard = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <circle cx="9" cy="11" r="2" />
    <path d="M6 16c.7-1.4 1.8-2 3-2s2.3.6 3 2M14.5 10h3.5M14.5 13.5h3.5" />
  </svg>
);
export const CardIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="M3 10h18M7 15h3" />
  </svg>
);
export const Qr = (p: P) => (
  <svg {...base(p)}>
    <rect x="4" y="4" width="6" height="6" rx="1" />
    <rect x="14" y="4" width="6" height="6" rx="1" />
    <rect x="4" y="14" width="6" height="6" rx="1" />
    <path d="M14 14h2v2h-2zM18 14h2M14 18h2M18 18h2v2M16 16h2v2" />
  </svg>
);
export const Calendar = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
);
export const Users = (p: P) => (
  <svg {...base(p)}>
    <circle cx="9" cy="8.5" r="3.5" />
    <path d="M2.5 20c.8-3.4 3.4-5.5 6.5-5.5s5.7 2.1 6.5 5.5" />
    <path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14.8c1.8.8 3 2.6 3.5 5.2" />
  </svg>
);
export const Sparkle = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
    <path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z" />
  </svg>
);
export const Waves = (p: P) => (
  <svg {...base(p)}>
    <path d="M2 15c2 0 2-1.5 4-1.5S8 15 10 15s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M2 19c2 0 2-1.5 4-1.5S8 19 10 19s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5" />
    <path d="M8 11V5a2 2 0 0 1 4 0M16 11V5a2 2 0 0 0-4 0M8 8h8" />
  </svg>
);
export const Dumbbell = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 7v10M3.5 9.5v5M18 7v10M20.5 9.5v5M6 12h12" />
  </svg>
);
export const Sun = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
export const Camera = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);
export const Lock = (p: P) => (
  <svg {...base(p)}>
    <rect x="5" y="10.5" width="14" height="10" rx="2" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
  </svg>
);
export const Clock = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);
export const X = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const Logo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 40 40" className={className} aria-hidden>
    <circle cx="20" cy="20" r="19" fill="#062a1f" stroke="#d8b770" strokeWidth="1.5" />
    <path d="M20 8c-5 5-9 9-9 15a9 9 0 0 0 18 0c0-6-4-10-9-15z" fill="none" stroke="#d8b770" strokeWidth="2" />
    <path d="M20 17v14" stroke="#d8b770" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
