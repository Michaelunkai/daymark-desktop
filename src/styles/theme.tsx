import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

declare global {
  interface Window {
    DaymarkAndroid?: {
      setTheme?: (theme: "light" | "dark") => void;
    };
  }
}

export type ThemePreference = "light" | "dark" | "system";

type ThemeContextValue = {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export type ThemeProviderProps = PropsWithChildren<{
  defaultPreference?: ThemePreference;
  storageKey?: string;
}>;

function readStoredPreference(
  storageKey: string,
  fallback: ThemePreference,
): ThemePreference {
  if (typeof window === "undefined") {
    return fallback;
  }

  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(storageKey);
  } catch {
    stored = null;
  }
  return stored === "light" || stored === "dark" || stored === "system"
    ? stored
    : fallback;
}

export function ThemeProvider({
  children,
  defaultPreference = "system",
  storageKey = "todoist-replica-theme",
}: ThemeProviderProps) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    readStoredPreference(storageKey, defaultPreference),
  );

  useEffect(() => {
    document.documentElement.dataset.theme = preference;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const applyResolvedTheme = () => {
      const resolved = preference === "dark" || (preference === "system" && Boolean(media?.matches))
        ? "dark"
        : "light";
      document.documentElement.dataset.themeEffective = resolved;
      window.DaymarkAndroid?.setTheme?.(resolved);
    };
    applyResolvedTheme();
    media?.addEventListener?.("change", applyResolvedTheme);
    return () => media?.removeEventListener?.("change", applyResolvedTheme);
  }, [preference]);

  const setPreference = useCallback(
    (nextPreference: ThemePreference) => {
      setPreferenceState(nextPreference);
      try {
        window.localStorage.setItem(storageKey, nextPreference);
      } catch {
        // Theme remains active for the current session when storage is blocked.
      }
    },
    [storageKey],
  );

  const value = useMemo(
    () => ({ preference, setPreference }),
    [preference, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used inside ThemeProvider.");
  }

  return context;
}
