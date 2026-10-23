import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AuditLogQuerySchema, type AuditLogQuery } from "@/features/admin/audit-log";
import {
  formatStaffAuditAction,
  formatStaffAuditTarget,
} from "@/features/admin/audit-format";
import { adminPageContext } from "@/features/admin/context";
import { routes } from "@/lib/routes";
import { AuditView, type AuditViewRow } from "./AuditView";
import { AUDIT_ACTION_FAMILIES, auditLogPage, familyFilterValue } from "./data";

type Filters = Partial<Pick<AuditLogQuery, "actor" | "action" | "target">>;

function auditHref(filters: Filters, page = 1) {
  return routes.admin.audit({ ...filters, page: page > 1 ? page : undefined });
}

export default function AuditPage(): Promise<React.JSX.Element>;
export default function AuditPage(props: { searchParams: Promise<Record<string, string | undefined>> }): Promise<React.JSX.Element>;
export default async function AuditPage(
  {
    searchParams,
  }: { searchParams: Promise<Record<string, string | undefined>> } = {
    searchParams: Promise.resolve({}),
  },
) {
  const context = await adminPageContext("audit.read");
  const params = await searchParams;
  const parsed = AuditLogQuerySchema.safeParse(params);
  if (!parsed.success) notFound();
  const input = parsed.data;
  const page = input.page;
  const [{ rows, actors, targetName, hasMore }, t, to, locale] = await Promise.all([
    auditLogPage(context, input),
    getTranslations("centralAdmin"),
    getTranslations("staffUi.admin.org.audit"),
    getLocale(),
  ]);
  const filters: Filters = { actor: input.actor, action: input.action, target: input.target };
  const filtered = Boolean(input.actor || input.action || input.target);
  const time = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  const familyOptions: { value: string; label: string }[] = AUDIT_ACTION_FAMILIES.map((family) => ({
    value: familyFilterValue(family),
    label: to(`families.${family}`),
  }));
  // A free-text action filter from an older link stays selectable so the form does not drop it.
  if (input.action && !familyOptions.some((option) => option.value === input.action))
    familyOptions.push({ value: input.action, label: input.action });

  const actorName = (id: string) => actors.get(id.toLowerCase())?.name;
  const viewRows: AuditViewRow[] = rows.map((row) => {
    const name = row.actorId ? actorName(row.actorId) : undefined;
    return {
      id: row.id,
      at: row.at,
      time: time.format(new Date(row.at)),
      action: formatStaffAuditAction(row.action, locale),
      actor: row.actorId
        ? {
            name: name ?? row.actorId,
            isId: !name,
            href: auditHref({ ...filters, actor: row.actorId }),
            filterLabel: to("filterByActor", { name: name ?? to("unknownActor") }),
          }
        : null,
      target: { label: formatStaffAuditTarget(row.targetType, locale), id: row.targetId, name: targetName(row.targetType, row.targetId) ?? null },
    };
  });

  return (
    <AuditView
      title={t("history")}
      description={t("auditScopeHint")}
      filters={{ action: input.action ?? "", target: input.target ?? "", actor: input.actor ?? "" }}
      familyOptions={familyOptions}
      actorFilter={input.actor ? {
        label: to("filteredByActor", { name: actorName(input.actor) ?? input.actor }),
        clearHref: auditHref({ ...filters, actor: undefined }),
        clearLabel: to("clearActor"),
      } : undefined}
      clearHref={filtered ? routes.admin.audit() : undefined}
      rows={viewRows}
      page={page}
      hasMore={hasMore}
      previousHref={page > 1 ? auditHref(filters, page - 1) : null}
      nextHref={hasMore ? auditHref(filters, page + 1) : null}
      labels={{
        family: to("familyLabel"),
        allFamilies: to("allFamilies"),
        target: t("target"),
        targetPlaceholder: to("targetPlaceholder"),
        apply: to("apply"),
        clearFilters: to("clearFilters"),
        listTitle: to("listTitle"),
        time: to("columns.time"),
        action: to("columns.action"),
        actor: to("columns.actor"),
        targetColumn: to("columns.target"),
        system: to("system"),
        pagination: to("pagination"),
        emptyTitle: filtered ? to("emptyTitle") : t("noActivity"),
        emptyDescription: filtered ? to("emptyFiltered") : t("auditScopeHint"),
      }}
    />
  );
}
