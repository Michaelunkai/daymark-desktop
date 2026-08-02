import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

export function ListIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" {...props}>
      <path d="M4 5h12M4 10h12M4 15h12" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
      <path d="M2.7 5h.1M2.7 10h.1M2.7 15h.1" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" />
    </svg>
  );
}

export function BoardIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" {...props}>
      <rect height="12" rx="1.4" stroke="currentColor" strokeWidth="1.5" width="4" x="2.5" y="4" />
      <rect height="8" rx="1.4" stroke="currentColor" strokeWidth="1.5" width="4" x="8" y="4" />
      <rect height="10" rx="1.4" stroke="currentColor" strokeWidth="1.5" width="4" x="13.5" y="4" />
    </svg>
  );
}

export function MoreIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" {...props}>
      <circle cx="4" cy="10" r="1.2" />
      <circle cx="10" cy="10" r="1.2" />
      <circle cx="16" cy="10" r="1.2" />
    </svg>
  );
}

export function GripIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" {...props}>
      <circle cx="7" cy="5" r="1" />
      <circle cx="13" cy="5" r="1" />
      <circle cx="7" cy="10" r="1" />
      <circle cx="13" cy="10" r="1" />
      <circle cx="7" cy="15" r="1" />
      <circle cx="13" cy="15" r="1" />
    </svg>
  );
}
