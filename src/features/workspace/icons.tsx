type IconProps = {
  size?: number;
};

function iconProps(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: 'false' as const,
  };
}

export function IconTrash({ size = 16 }: IconProps) {
  return (
    <svg {...iconProps(size)}>
      <path d="M2.5 4.5h11" />
      <path d="M5.5 4.5V3.2a.7.7 0 0 1 .7-.7h3.6a.7.7 0 0 1 .7.7v1.3" />
      <path d="M4.2 4.5l.5 8a.9.9 0 0 0 .9.85h4.8a.9.9 0 0 0 .9-.85l.5-8" />
      <path d="M6.6 7v3.8M9.4 7v3.8" />
    </svg>
  );
}

export function IconPause({ size = 16 }: IconProps) {
  return (
    <svg {...iconProps(size)}>
      <path d="M5.75 3.5v9" />
      <path d="M10.25 3.5v9" />
    </svg>
  );
}

export function IconPlay({ size = 16 }: IconProps) {
  return (
    <svg {...iconProps(size)}>
      <path d="M5.5 3.4v9.2l7-4.6z" />
    </svg>
  );
}

export function IconClock({ size = 16 }: IconProps) {
  return (
    <svg {...iconProps(size)}>
      <circle cx="8" cy="8" r="5.6" />
      <path d="M8 5.2V8l2 1.6" />
    </svg>
  );
}

export function IconGauge({ size = 16 }: IconProps) {
  return (
    <svg {...iconProps(size)}>
      <path d="M2.6 11.4a5.9 5.9 0 1 1 10.8 0" />
      <path d="M8 11.4L10.6 7" />
      <circle cx="8" cy="11.4" r="0.85" />
    </svg>
  );
}

// SLICE-DONE: graphics-specialist
