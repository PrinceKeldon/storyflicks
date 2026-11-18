"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { migrateLegacySupabaseSession } from "@/lib/supabase";

export default function AuthSessionProvider({ children }: { children: ReactNode }) {
  const [migrationIssue, setMigrationIssue] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let active = true;
    void migrateLegacySupabaseSession().then((result) => {
      if (!active) return;
      setMigrationIssue(Boolean(result.error));
      if (result.migrated) router.refresh();
    }).catch(() => {
      if (!active) return;
      setMigrationIssue(true);
    });
    return () => { active = false; };
  }, [router]);

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
