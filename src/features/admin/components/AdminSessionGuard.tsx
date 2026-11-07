"use client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { azureBrowserIdentityEnabled } from "@/lib/identity/provider";
import { supabaseBrowser } from "@/lib/supabase/client";
import { IDENTITY_CHANGED_EVENT, IDENTITY_SIGNED_OUT_KEY } from "@/lib/identity/browser-session";
import { safeInternalPath } from "@/lib/safe-internal-path";
import { routes } from "@/lib/routes";
import { captureSessionFocus, concealSessionPortals, restoreSessionFocus } from "@/lib/identity/session-concealment";

const SESSION_FRESHNESS_MS = 5 * 60 * 1000;

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
  const [state, setState] = useState<"ready" | "checking" | "unavailable" | "changed">("ready");
  const [discardedActor, setDiscardedActor] = useState<string | null>(null);
  const retry = useRef<(() => void) | null>(null);
  const status = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const savedFocus = useRef<{ actorId: string; value: NonNullable<ReturnType<typeof captureSessionFocus>> } | null>(null);
  useLayoutEffect(() => {
    if (state !== "ready" && status.current) return concealSessionPortals(status.current, content.current);
    if (state === "ready" && savedFocus.current) {
      const saved = savedFocus.current; savedFocus.current = null;
      if (saved.actorId === actorId) restoreSessionFocus(saved.value);
    }
  }, [state, actorId]);
  const router = useRouter();
  const t = useTranslations("centralAdmin");
  const errors = useTranslations("errors");
  useEffect(() => {
    if (azureBrowserIdentityEnabled()) {
      let active = true;
      const rememberFocus = () => {
        const value = captureSessionFocus(status.current);
        if (value) savedFocus.current = { actorId, value };
      };
      let checking = false;
      let actorChanged = false;
      let generation = 0;
      let checkingGeneration = 0;
      let backgrounded = false;
      let recheck = false;
      let validatedAt: number | null = null;
      const loginDestination = () => routes.auth.login({ next: safeInternalPath(`${window.location.pathname}${window.location.search}${window.location.hash}`, destination) });
      const check = async (conceal = false) => {
        if (!active) return;
        if (conceal && !actorChanged) { rememberFocus(); setState("checking"); }
        if (checking) { if (checkingGeneration !== generation) recheck = true; return; }
        checking = true;
        validatedAt = null;
        recheck = false;
        const started = generation;
        checkingGeneration = started;
        try {
          const response = await fetch('/api/v1/auth/session', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10000) });
          if (!active || started !== generation || backgrounded) return;
          if (response.status === 401) {
            actorChanged = true;
            savedFocus.current = null;
            setDiscardedActor(actorId);
            setState("changed");
            router.replace(loginDestination());
            router.refresh();
            return;
          }
          if (!response.ok) throw new Error('session_unavailable');
          const session = await response.json() as { userId?: string };
          if (!active || started !== generation || backgrounded) return;
          if (typeof session.userId !== 'string' || !session.userId) throw new Error('session_unavailable');
          if (session.userId !== actorId) {
            actorChanged = true;
            savedFocus.current = null;
            setDiscardedActor(actorId);
            setState("changed"); router.replace(destination); router.refresh();
          } else {
            if (!actorChanged) validatedAt = Date.now();
            setState(actorChanged ? "unavailable" : "ready");
          }
        } catch {
          // A transient outage conceals privileged data but must not start a
          // server render/login loop or destroy the still-valid session.
          if (active && started === generation) { rememberFocus(); setState("unavailable"); }
        } finally {
          checking = false;
          if (active && recheck && !backgrounded) { recheck = false; void check(true); }
        }
      };
      retry.current = () => { void check(true); };
      void check(true);
      const focus = () => {
        if (document.visibilityState !== 'visible') return;
        if (backgrounded) { generation++; backgrounded = false; }
        // Reuse only this tab's recent server validation. Identity hints and
        // failed/in-flight checks invalidate it; returning to a fresh tab is free.
        const age = validatedAt === null ? null : Date.now() - validatedAt;
        if (!actorChanged && age !== null && age >= 0 && age < SESSION_FRESHNESS_MS) return;
        void check(true);
      };
      const blur = () => {
        rememberFocus();
        generation++; backgrounded = true;
      };
      const visibility = () => {
        if (document.visibilityState === 'visible') focus(); else blur();
      };
      const invalidate = (signedOut: boolean) => {
        rememberFocus();
        generation++;
        validatedAt = null;
        // A logout hint cannot grant access or let an older successful response
        // uncover the old actor while server-side revocation is completing.
        if (signedOut) { actorChanged = true; savedFocus.current = null; setDiscardedActor(actorId); }
        setState(signedOut ? "changed" : "checking");
        if (checking) recheck = true; else void check(true);
      };
      const storage = (event: StorageEvent) => {
        if (!event.newValue) return;
        if (event.key === IDENTITY_SIGNED_OUT_KEY) invalidate(true);
        else if (event.key === IDENTITY_CHANGED_EVENT) invalidate(false);
      };
      const identityChanged = () => invalidate(false);
      window.addEventListener('focus', focus);
      window.addEventListener('blur', blur);
      document.addEventListener('visibilitychange', visibility);
      window.addEventListener('storage', storage);
      window.addEventListener(IDENTITY_CHANGED_EVENT, identityChanged);
      return () => {
        active = false; retry.current = null;
        window.removeEventListener('focus', focus);
        window.removeEventListener('blur', blur);
        document.removeEventListener('visibilitychange', visibility);
        window.removeEventListener('storage', storage);
        window.removeEventListener(IDENTITY_CHANGED_EVENT, identityChanged);
      };
    }
    const { data } = supabaseBrowser().auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => {
        if (session?.user.id !== actorId) {
          savedFocus.current = null;
          setDiscardedActor(actorId);
          setState("changed");
          router.replace(destination);
          router.refresh();
        }
      },
    );
    return () => data.subscription.unsubscribe();
  }, [actorId, destination, router]);
  return <>
    {discardedActor !== actorId && <div ref={content} hidden={state !== "ready"} inert={state !== "ready" || undefined} style={{ display: state === "ready" ? "contents" : "none" }}>{children}</div>}
    {state !== "ready" && <div
      ref={status}
      role="status"
      style={{ pointerEvents: "auto" }}
      className="fixed inset-0 z-[110] grid place-items-center bg-background text-sm text-muted-foreground"
    >
      {state === "unavailable" ? (
        <div className="grid gap-3 text-center">
          <p>{t("sessionUnavailable")}</p>
          <button type="button" className="min-h-11 rounded-md border px-4" onClick={() => retry.current?.()}>{errors("retry")}</button>
        </div>
      ) : t("sessionChecking")}
    </div>}
  </>;
}
