"use client";

import { type ReactNode } from "react";
import { useTranslations } from "next-intl";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/classic";
import type { AdminScope } from "@/lib/admin-scope";

export type ApiEnvelope<T> = {
  data?: T;
  error?: { message?: string; code?: string };
};

export async function responseData<T>(response: Response): Promise<T> {
  const body = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || body.data === undefined)
    throw new Error(body.error?.message ?? "request_failed");
  return body.data;
}

export function scopedUrl(
  path: string,
  scope: AdminScope,
  params: Record<string, string | number | null | undefined> = {},
): string {
  const search = new URLSearchParams({
    scope: scope.kind === "central" ? "central" : `branch:${scope.branchId}`,
  });
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "")
      search.set(key, String(value));
  }
  return `${path}?${search.toString()}`;
}

export function RequestStatus({ children }: { children: string }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className="min-h-6 text-sm text-muted-foreground"
    >
      {children}
    </p>
  );
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("memberAdmin");
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm"
    >
      <span>{t("error")}</span>
      <Button
        className="bg-secondary text-secondary-foreground hover:bg-secondary/80"
        onClick={onRetry}
      >
        {t("retry")}
      </Button>
    </div>
  );
}

export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const t = useTranslations("memberAdmin");
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogPortal>
        <DialogOverlay className="fixed inset-0 z-50 bg-foreground/20" />
        <DialogContent className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6">
          <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-muted-foreground">
            {description}
          </DialogDescription>
          {children ? <div className="mt-4">{children}</div> : null}
          <div className="mt-6 flex justify-end gap-3">
            <Button
              className="bg-secondary text-secondary-foreground hover:bg-secondary/80"
              onClick={onCancel}
            >
              {t("cancel")}
            </Button>
            <Button onClick={onConfirm}>{confirmLabel ?? t("confirm")}</Button>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

export function scopeLabel(
  scope: AdminScope,
  branches: { id: string; name: string }[],
): string {
  return scope.kind === "central"
    ? "Central"
    : (branches.find((branch) => branch.id === scope.branchId)?.name ??
        scope.branchId);
}

/** Effective status in the visible workspace, independent from a global account label. */
/** Built-in roles are named in the UI language; custom roles keep the name their author gave. */
export function useRoleDisplayName() {
  const t = useTranslations("staffUi.admin.org.roles.builtInNames");
  return (roleId: string | null | undefined, fallback: string) =>
    roleId && t.has(roleId) ? t(roleId) : fallback;
}

export function memberStatus(
  member: {
    accountStatus: "active" | "suspended";
    memberships: { branchId: string; status: "active" | "suspended" }[];
  },
  scope: AdminScope,
) {
  if (member.accountStatus === "suspended") return "suspended";
  return scope.kind === "branch"
    ? (member.memberships.find((m) => m.branchId === scope.branchId)?.status ??
        "active")
    : member.accountStatus;
}

const HAS_LETTER = /[\p{L}\p{N}]/u;

/**
 * Avatar initials, following the staff user-menu convention: Vietnamese names put the
 * given name last ("Nguyễn Minh Anh" → "MA"), so a multi-word name uses its last two words.
 * Mirrors actorInitials in src/features/admin/actor-directory.ts, which is server-only.
 */
export function memberInitials(name: string): string {
  const words = name
    .normalize("NFC")
    .trim()
    .split(/[\s._+-]+/u)
    .filter((word) => HAS_LETTER.test(word));
  const picked = words.length > 1 ? words.slice(-2) : words;
  const initials = picked
    .map((word) => Array.from(word).find((char) => HAS_LETTER.test(char)) ?? "")
    .join("")
    .toLocaleUpperCase("vi");
  return initials || "?";
}
