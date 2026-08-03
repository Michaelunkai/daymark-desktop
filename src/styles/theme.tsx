import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { getBrowserStorage } from "../core/storage";

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

export function readStoredPreference(
  storageKey: string,
  fallback: ThemePreference,
): ThemePreference {
  const storage = getBrowserStorage();
  if (!storage) return fallback;

  try {
    const stored = storage.getItem(storageKey);
    return stored === "light" || stored === "dark" || stored === "system"
      ? stored
      : fallback;
  } catch {
    return fallback;
  }
}

export function persistPreference(storageKey: string, preference: ThemePreference): void {
  const storage = getBrowserStorage();
  if (!storage) return;
  try {
    storage.setItem(storageKey, preference);
  } catch {
    // Theme changes remain session-local when browser storage is unavailable.
  }
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
  }, [preference]);

  const setPreference = useCallback(
    (nextPreference: ThemePreference) => {
      setPreferenceState(nextPreference);
      persistPreference(storageKey, nextPreference);
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
