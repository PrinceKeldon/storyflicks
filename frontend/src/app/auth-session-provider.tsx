"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { migrateLegacySupabaseSession } from "@/lib/supabase";

export default function AuthSessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [migrationIssue, setMigrationIssue] = useState(false);

  useEffect(() => {
    let active = true;
    void migrateLegacySupabaseSession().then((result) => {
      if (!active) return;
      setMigrationIssue(Boolean(result.error));
      setReady(true);
    }).catch(() => {
      if (!active) return;
      setMigrationIssue(true);
      setReady(true);
    });
    return () => { active = false; };
  }, []);

  if (!ready) {
    return (
      <main className="reader-state" aria-live="polite">
        <span className="reader-state-mark">SF.</span>
        <p>Restoring your STORYFLICKS session…</p>
      </main>
    );
  }

  return (
    <>
      {migrationIssue ? (
        <div role="status" className="auth-migration-notice">
          We couldn’t restore this browser session. Please <Link href="/sign-in">sign in again</Link> to continue.
        </div>
      ) : null}
      {children}
    </>
  );
}
