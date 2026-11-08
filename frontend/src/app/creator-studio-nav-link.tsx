"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function CreatorStudioNavLink() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let active = true;
    async function check() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
        if (!apiUrl) return;
        const response = await fetch(`${apiUrl}/account/access`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        });
        if (!response.ok) return;
        const access = await response.json() as { is_creator?: boolean };
        if (active) setVisible(Boolean(access.is_creator));
      } catch { /* Keep creator tools hidden if access cannot be verified. */ }
    }
    void check();
    return () => { active = false; };
  }, []);
  return visible ? <Link className="nav-link" href="/creator-studio">Creator Studio</Link> : null;
}
