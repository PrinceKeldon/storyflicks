import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

function getProjectStorageKey() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    const projectRef = new URL(url).hostname.split(".")[0];
    return projectRef ? `sb-${projectRef}-auth-token` : null;
  } catch {
    return null;
  }
}

export function getSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey || typeof window === "undefined") return null;
  if (!browserClient) {
    browserClient = createBrowserClient(url, anonKey, {
      cookieOptions: {
        path: "/",
        sameSite: "lax",
        secure: window.location.protocol === "https:",
      },
    });
  }
  return browserClient;
}

/**
 * Transfers an existing supabase-js localStorage session into the SSR cookie
 * store. The legacy entry is retained unless Supabase accepts and verifies
 * the transferred session.
 */
export async function migrateLegacySupabaseSession() {
  const client = getSupabaseBrowserClient();
  if (!client) return { migrated: false, error: new Error("Supabase is not configured.") };

  const { data: current } = await client.auth.getSession();
  if (current.session) return { migrated: false, error: null };

  const storageKey = getProjectStorageKey();
  if (!storageKey) return { migrated: false, error: null };

  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(storageKey);
  } catch {
    return { migrated: false, error: new Error("Browser storage is unavailable.") };
  }
  if (!raw) return { migrated: false, error: null };

  try {
    const parsed = JSON.parse(raw) as {
      access_token?: string;
      refresh_token?: string;
      currentSession?: { access_token?: string; refresh_token?: string };
    };
    const legacy = parsed.currentSession ?? parsed;
    if (!legacy.access_token || !legacy.refresh_token) {
      return { migrated: false, error: new Error("The saved session could not be read.") };
    }

    const { error: setError } = await client.auth.setSession({
      access_token: legacy.access_token,
      refresh_token: legacy.refresh_token,
    });
    if (setError) return { migrated: false, error: setError };

    const { data: verified, error: verifyError } = await client.auth.getUser();
    if (verifyError || !verified.user) {
      return { migrated: false, error: verifyError ?? new Error("The saved session could not be verified.") };
    }

    window.localStorage.removeItem(storageKey);
    return { migrated: true, error: null };
  } catch (error) {
    return { migrated: false, error: error instanceof Error ? error : new Error("Session migration failed.") };
  }
}
