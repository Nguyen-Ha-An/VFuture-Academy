"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
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
