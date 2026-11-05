"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { azureBrowserIdentityEnabled } from "@/lib/identity/provider";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Conceal previously authorized data when another tab changes the signed-in actor. */
export function AdminSessionGuard({
  actorId,
  children,
  destination = "/admin",
}: {
  actorId: string;
  children: ReactNode;
  destination?: string;
}) {
  const [changed, setChanged] = useState(false);
  const router = useRouter();
  const t = useTranslations("centralAdmin");
  useEffect(() => {
    if (azureBrowserIdentityEnabled()) {
      let active = true;
      let checking = false;
      // A confirmed actor change requires a fresh authorized layout. A transient
      // outage may recover only after the original actor is revalidated.
      let actorChanged = false;
      const check = async () => {
        if (checking || !active) return;
        checking = true;
        try {
          const response = await fetch('/api/v1/auth/session', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10000) });
          if (!response.ok && response.status !== 401) throw new Error('session_unavailable');
          const session = response.ok ? await response.json() as { userId?: string } : null;
          if (!active) return;
          if (session?.userId !== actorId) {
            actorChanged = true;
            setChanged(true); router.replace(destination); router.refresh();
          } else if (!actorChanged) {
            setChanged(false);
          }
        } catch {
          // An unavailable session cannot keep previously authorized admin content visible.
          if (active) { setChanged(true); router.refresh(); }
        } finally { checking = false; }
      };
      void check();
      const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void check(); }, 15000);
      const focus = () => { void check(); };
      window.addEventListener('focus', focus);
      return () => { active = false; window.clearInterval(interval); window.removeEventListener('focus', focus); };
    }
    const { data } = supabaseBrowser().auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => {
        if (session?.user.id !== actorId) {
          setChanged(true);
          router.replace(destination);
          router.refresh();
        }
      },
    );
    return () => data.subscription.unsubscribe();
  }, [actorId, destination, router]);
  return changed ? (
    <div
      role="status"
      className="fixed inset-0 z-[110] grid place-items-center bg-background text-sm text-muted-foreground"
    >
      {t("switchingScope")}
    </div>
  ) : (
    children
  );
}
