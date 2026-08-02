import { useEffect, useState, type ComponentPropsWithoutRef, type ElementType } from "react";

export const focusRingClassName = "ui-focus-ring";

export function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);

    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  return prefersReducedMotion;
}

type VisuallyHiddenProps<T extends ElementType> = {
  as?: T;
} & ComponentPropsWithoutRef<T>;

export function VisuallyHidden<T extends ElementType = "span">({
  as,
  style,
  ...props
}: VisuallyHiddenProps<T>) {
  const Component = as ?? "span";

  return (
    <Component
      {...props}
      style={{
        border: 0,
        clip: "rect(0 0 0 0)",
        height: 1,
        margin: -1,
        overflow: "hidden",
        padding: 0,
        position: "absolute",
        whiteSpace: "nowrap",
        width: 1,
        ...style,
      }}
    />
  );
}
