import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

export function ChevronIcon({ direction = "down", ...props }: IconProps & { direction?: "down" | "right" }) {
  const path = direction === "right" ? "M6 4.5 11.5 10 6 15.5" : "m4.5 7 5.5 5.5L15.5 7";
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" {...props}>
      <path d={path} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" {...props}>
      <path d="M10 4v12M4 10h12" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

export function StarIcon({ filled = false, ...props }: IconProps & { filled?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill={filled ? "currentColor" : "none"} {...props}>
      <path
        d="m10 2.8 2.1 4.35 4.8.7-3.45 3.36.81 4.77L10 13.73l-4.26 2.25.81-4.77L3.1 7.85l4.8-.7L10 2.8Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.45"
      />
    </svg>
  );
}

export function LayersIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" {...props}>
      <path d="m10 3 7 3.5-7 3.5-7-3.5L10 3Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
      <path d="m4 9.5 6 3 6-3M4 13l6 3 6-3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
    </svg>
  );
}
