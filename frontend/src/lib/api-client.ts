import { getSupabaseBrowserClient } from "./supabase";

/** Resolve after `ms` with a rejection, so a stuck call can never leave a page on a loading screen forever. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

/** Access token for the signed-in reader, or null when signed out. Never hangs. */
export async function getAccessToken(timeoutMs = 10000): Promise<string | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  try {
    const { data } = await withTimeout(supabase.auth.getSession(), timeoutMs, "Checking your session took too long.");
    return data.session?.access_token ?? null;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Checking your session")) throw error;
    return null;
  }
}

/** fetch with a deadline; rejects with a readable message instead of waiting indefinitely. */
export async function fetchWithTimeout(input: string, init: RequestInit = {}, timeoutMs = 20000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("The server took too long to respond. Please try again.");
    throw new Error("We couldn’t reach STORYFLICKS. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }
}

/** Human-readable message for a failed API response (including the rate limiter's 429). */
export async function apiErrorMessage(response: Response, fallback: string): Promise<string> {
  if (response.status === 429) {
    const wait = Number(response.headers.get("retry-after"));
    return `You’re going a little fast. Please wait ${Number.isFinite(wait) && wait > 0 ? `${Math.min(wait, 120)} seconds` : "a moment"} and try again.`;
  }
  const body = await response.json().catch(() => ({})) as { detail?: unknown };
  return typeof body.detail === "string" && body.detail ? body.detail : fallback;
}
