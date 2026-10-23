"use client";

import { useTranslations } from "next-intl";
import { useScopeChange } from "@/features/workspace/useScopeChange";
import {
  scopeKey,
  type AdminScope,
  type AdminScopeOption,
} from "@/lib/admin-scope";

export function AdminScopeSelector({
  options,
  active,
  endpoint = "/api/v1/admin/scope",
  destination = "/admin",
}: {
  options: AdminScopeOption[];
  active: AdminScope;
  endpoint?: string;
  destination?: string;
}) {
  const t = useTranslations("centralAdmin");
  const { changeScope, pending, error, switching } = useScopeChange("admin", { active, endpoint, destination });

  return (
    <div className="space-y-1">
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        {t("scope")}
        <select
          aria-label={t("scope")}
          value={scopeKey(active)}
          disabled={pending || options.length < 2}
          onChange={(event) => void changeScope(event.target.value)}
          className="min-h-10 max-w-full rounded-md border border-input bg-background px-3 text-sm text-foreground disabled:opacity-80"
        >
          {options.map((option) => (
            <option key={scopeKey(option.scope)} value={scopeKey(option.scope)}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {t("scopeError")}
        </p>
      ) : null}
      {switching ? <ScopeSwitchingOverlay /> : null}
    </div>
  );
}

/** Covers the page while a new scope's server-authorized layout loads. */
export function ScopeSwitchingOverlay() {
  const t = useTranslations("centralAdmin");
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[100] grid place-items-center bg-background"
    >
      <p className="text-sm text-muted-foreground">{t("switchingScope")}</p>
    </div>
  );
}
