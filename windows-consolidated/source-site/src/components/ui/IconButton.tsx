import { type ButtonHTMLAttributes, type ReactNode } from "react";

import { Tooltip } from "./Tooltip";

export type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "aria-label"
> & {
  children: ReactNode;
  label: string;
  size?: "sm" | "md" | "lg";
  tooltip?: string;
  variant?: "ghost" | "subtle";
};

export function IconButton({
  children,
  className,
  label,
  size = "md",
  tooltip = label,
  type = "button",
  variant = "ghost",
  ...props
}: IconButtonProps) {
  const button = (
    <button
      {...props}
      aria-label={label}
      className={[
        "ui-icon-button",
        `ui-icon-button--${size}`,
        `ui-icon-button--${variant}`,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      type={type}
    >
      {children}
    </button>
  );

  return tooltip ? <Tooltip content={tooltip}>{button}</Tooltip> : button;
}
