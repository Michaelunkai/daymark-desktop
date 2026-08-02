export type PublicCloudEnvironment = {
  url: string;
  anonKey: string;
};

export type PublicCloudEnvironmentSource = Partial<
  Record<"VITE_SUPABASE_URL" | "VITE_SUPABASE_ANON_KEY", string | undefined>
>;

export function readPublicCloudEnvironment(source: PublicCloudEnvironmentSource = viteEnvironment()): PublicCloudEnvironment {
  return validatePublicCloudEnvironment({
    url: source.VITE_SUPABASE_URL,
    anonKey: source.VITE_SUPABASE_ANON_KEY,
  });
}

export function validatePublicCloudEnvironment(value: {
  url?: string;
  anonKey?: string;
}): PublicCloudEnvironment {
  const url = value.url?.trim();
  const anonKey = value.anonKey?.trim();

  if (!url) throw new Error("VITE_SUPABASE_URL is required to enable cloud sync.");
  if (!anonKey) throw new Error("VITE_SUPABASE_ANON_KEY is required to enable cloud sync.");
  if (anonKey.toLowerCase().includes("service_role")) {
    throw new Error("A Supabase service-role secret must never be used in a browser client.");
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("VITE_SUPABASE_URL must be a valid absolute URL.");
  }

  const isLocalHttp = parsed.protocol === "http:" && /^(localhost|127\.0\.0\.1|::1)$/i.test(parsed.hostname);
  if (parsed.protocol !== "https:" && !isLocalHttp) {
    throw new Error("VITE_SUPABASE_URL must use HTTPS outside local development.");
  }

  return { url: parsed.toString().replace(/\/$/, ""), anonKey };
}

function viteEnvironment(): PublicCloudEnvironmentSource {
  if (typeof import.meta === "undefined") return {};
  const environment = (import.meta as ImportMeta & { env?: PublicCloudEnvironmentSource }).env;
  return environment ?? {};
}
