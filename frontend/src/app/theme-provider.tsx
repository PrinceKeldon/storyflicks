"use client";

import { useEffect } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type Theme = "dark" | "light";
const STORAGE_KEY = "storyflicks-theme";

function validTheme(value: unknown): value is Theme {
  return value === "dark" || value === "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export default function ThemeProvider() {
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let active = true;

    const applyForSession = async () => {
      if (!supabase) {
        const local = window.localStorage.getItem(STORAGE_KEY);
        applyTheme(validTheme(local) ? local : "dark");
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!active) return;

      const accountTheme = session?.user?.user_metadata?.theme_preference;
      if (validTheme(accountTheme)) {
        applyTheme(accountTheme);
        window.localStorage.setItem(STORAGE_KEY, accountTheme);
        return;
      }

      const local = window.localStorage.getItem(STORAGE_KEY);
      const fallback: Theme = validTheme(local) ? local : "dark";
      applyTheme(fallback);

      // Carry an existing browser choice into the account on first sign-in.
      if (session?.user && validTheme(local)) {
        await supabase.auth.updateUser({ data: { theme_preference: local } });
      }
    };

    void applyForSession();

    const { data: { subscription } } = supabase?.auth.onAuthStateChange(() => {
      // Defer auth reads until the auth event has completed.
      window.setTimeout(() => { if (active) void applyForSession(); }, 0);
    }) ?? { data: { subscription: { unsubscribe: () => undefined } } };

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return null;
}
