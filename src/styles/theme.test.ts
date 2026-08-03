import { persistPreference, readStoredPreference } from "./theme";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const originalWindow = (globalThis as { window?: unknown }).window;
try {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: () => {
          throw new Error("Storage access blocked");
        },
        setItem: () => {
          throw new Error("Storage access blocked");
        },
      },
    },
  });

  assert(
    readStoredPreference("daymark.theme", "system") === "system",
    "Blocked theme reads should keep the fallback preference.",
  );
  persistPreference("daymark.theme", "dark");
} finally {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
}

console.log("THEME_STORAGE_TESTS_OK");
