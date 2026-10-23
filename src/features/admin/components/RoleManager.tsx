"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRightIcon, PlusIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type {
  ManagementOptions,
  ManagedRoleDefinition,
} from "@/features/admin/management-contracts";
import { DataCard, EmptyState, RowActions, type RowAction } from "@/features/staff-ui/components";
import {
  CENTRAL_ONLY_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_DEFINITIONS,
  type Permission,
} from "@/lib/authorization";
import type { AdminScope } from "@/lib/admin-scope";
import { withQuery } from "@/lib/routes";
import { StaffPageHeader } from "@/features/workspace/ui/StaffPageHeader";
import {
  ErrorState,
  RequestStatus,
  responseData,
  scopedUrl,
  useRoleDisplayName,
} from "./member-admin-ui";

type PermissionGroup = (typeof PERMISSION_DEFINITIONS)[Permission]["group"];

/** Message keys cannot contain dots, so `role.definition.read` reads `permissionLabels.role_definition_read`. */
export function permissionMessageKey(permission: Permission): string {
  return permission.replaceAll(".", "_");
}

/** `legacy-content` → `legacyContent` under `permissionGroups`. */
export function permissionGroupMessageKey(group: PermissionGroup): string {
  return group.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/** Groups permissions in catalogue order (PERMISSIONS), keeping only the given ones. */
export function groupPermissions(permissions: readonly Permission[]) {
  const wanted = new Set(permissions);
  const groups = new Map<PermissionGroup, Permission[]>();
  for (const permission of PERMISSIONS) {
    if (!wanted.has(permission)) continue;
    const group = PERMISSION_DEFINITIONS[permission].group;
    groups.set(group, [...(groups.get(group) ?? []), permission]);
  }
  return [...groups.entries()].map(([group, items]) => ({ group, permissions: items }));
}

type Draft = {
  id?: string;
  name: string;
  description: string;
  scopeKind: "central" | "branch";
  permissions: Permission[];
  grantableBySchool: boolean;
  version?: number;
};
const blankDraft: Draft = {
  name: "",
  description: "",
  scopeKind: "branch",
  permissions: [],
  grantableBySchool: false,
};

export function RoleManager({
  scope,
  actorId,
}: {
  scope: AdminScope;
  actorId?: string;
}) {
  const t = useTranslations("memberAdmin");
  const tr = useTranslations("staffUi.admin.org.roles");
  const tp = useTranslations("staffUi.admin.org");
  const formId = useId();
  const urlFor = useCallback(
    (
      path: string,
      params: Record<string, string | number | null | undefined> = {},
    ) => scopedUrl(path, scope, { ...params, actorId }),
    [scope, actorId],
  );
  const [roles, setRoles] = useState<ManagedRoleDefinition[]>([]);
  const [options, setOptions] = useState<ManagementOptions | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [viewing, setViewing] = useState<ManagedRoleDefinition | null>(null);
  const roleName = useRoleDisplayName();
  const [confirming, setConfirming] = useState<Draft | null>(null);
  const [error, setError] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const requestSequence = useRef(0);

  const load = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const sequence = ++requestSequence.current;
    setError(false);
    setLoading(true);
    try {
      const [nextOptions, nextRoles] = await Promise.all([
        responseData<ManagementOptions>(
          await fetch(urlFor("/api/v1/admin/options"), {
            signal: controller.signal,
          }),
        ),
        responseData<ManagedRoleDefinition[]>(
          await fetch(urlFor("/api/v1/admin/roles"), {
            signal: controller.signal,
          }),
        ),
      ]);
      if (sequence !== requestSequence.current) return;
      setOptions(nextOptions);
      setRoles(nextRoles);
    } catch (caught) {
      if (
        (caught as Error).name !== "AbortError" &&
        sequence === requestSequence.current
      )
        setError(true);
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [urlFor]);
  useEffect(() => {
    void load();
    return () => requestRef.current?.abort();
  }, [load]);

  const permissionLabel = (permission: Permission) => {
    const key = `permissionLabels.${permissionMessageKey(permission)}`;
    return tp.has(key) ? tp(key) : permission;
  };
  const groupLabel = (group: PermissionGroup) => {
    const key = `permissionGroups.${permissionGroupMessageKey(group)}`;
    return tp.has(key) ? tp(key) : group;
  };
  const scopeName = (kind: Draft["scopeKind"]) =>
    kind === "central" ? t("central") : t("branch");

  function openSheet(next: Draft) {
    setDraft(next);
    setConfirming(null);
    setSaveFailed(false);
    setSheetOpen(true);
  }
  function closeSheet() {
    if (saving) return;
    setSheetOpen(false);
    setConfirming(null);
  }
  function editRole(role: ManagedRoleDefinition) {
    openSheet({
      id: role.id,
      name: role.name,
      description: role.description,
      scopeKind: role.scopeKind,
      permissions: role.permissions,
      grantableBySchool: role.grantableBySchool,
      version: role.version,
    });
  }
  function togglePermission(permission: Permission) {
    setDraft((current) => ({
      ...current,
      permissions: current.permissions.includes(permission)
        ? current.permissions.filter((item) => item !== permission)
        : [...current.permissions, permission],
    }));
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.name.trim()) return;
    setSaveFailed(false);
    setConfirming({ ...draft, name: draft.name.trim() });
  }
  async function save(draftToSave: Draft) {
    if (saving) return;
    setSaving(true);
    setSaveFailed(false);
    const payload = {
      name: draftToSave.name,
      description: draftToSave.description,
      scopeKind: draftToSave.scopeKind,
      permissions: draftToSave.permissions,
      grantableBySchool: draftToSave.grantableBySchool,
    };
    try {
      const saved = await responseData<ManagedRoleDefinition>(
        await fetch(
          urlFor(
            draftToSave.id
              ? `/api/v1/admin/roles/${encodeURIComponent(draftToSave.id)}`
              : "/api/v1/admin/roles",
          ),
          {
            method: draftToSave.id ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              draftToSave.id
                ? { ...payload, version: draftToSave.version }
                : payload,
            ),
          },
        ),
      );
      setRoles((current) =>
        draftToSave.id
          ? current.map((role) => (role.id === saved.id ? saved : role))
          : [...current, saved],
      );
      setDraft(blankDraft);
      setConfirming(null);
      setSheetOpen(false);
    } catch {
      // Stay in the sheet: the confirm step keeps the draft so the admin can retry.
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  }

  const canManage =
    options?.permissions.includes("role.definition.manage") ?? false;
  // /admin/users needs member.read; without it the count is plain text, not a dead-end link.
  const canReadMembers = options?.permissions.includes("member.read") ?? false;
  const displayName = (role: ManagedRoleDefinition) =>
    role.builtIn ? roleName(role.id, role.name) : role.name;
  const membersHref = (role: ManagedRoleDefinition) =>
    withQuery("/admin/users", { memberRole: role.id });
  const rowActions = (role: ManagedRoleDefinition): RowAction[] => [
    { label: tr("showPermissions"), onSelect: () => setViewing(role) },
    ...(canManage && !role.builtIn
      ? [{ label: tr("edit"), onSelect: () => editRole(role) }]
      : []),
    ...(canReadMembers ? [{ label: tr("viewMembers"), href: membersHref(role) }] : []),
  ];
  const visiblePermissions = (options?.permissions ?? []).filter(
    (permission) =>
      draft.scopeKind === "central" ||
      !CENTRAL_ONLY_PERMISSIONS.includes(permission),
  );
  const editing = Boolean(draft.id);
  const confirmAssignments = confirming?.id
    ? (roles.find((role) => role.id === confirming.id)?.assignmentCount ?? 0)
    : 0;

  return (
    <section className="space-y-6" aria-label={t("rolesPermissions")}>
      <StaffPageHeader
        title={t("rolesPermissions")}
        eyebrow={t("administration")}
        actions={
          canManage ? (
            <Button onClick={() => openSheet(blankDraft)}>
              <PlusIcon aria-hidden="true" />
              {tr("newRole")}
            </Button>
          ) : null
        }
      />
      {error ? <ErrorState onRetry={() => void load()} /> : null}
      <DataCard
        title={t("roleDefinitions")}
        description={options && !canManage ? t("readOnly") : undefined}
      >
        {!loading && !error && roles.length === 0 ? (
          <div className="p-6">
            <EmptyState title={tr("emptyTitle")} description={tr("emptyDescription")} />
          </div>
        ) : roles.length ? (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead scope="col">{tr("columns.role")}</TableHead>
                <TableHead scope="col" className="hidden md:table-cell">{tr("columns.scope")}</TableHead>
                <TableHead scope="col" className="hidden md:table-cell">{tr("columns.type")}</TableHead>
                <TableHead scope="col">{tr("columns.permissions")}</TableHead>
                <TableHead scope="col" className="hidden text-right md:table-cell">{tr("columns.assignments")}</TableHead>
                <TableHead scope="col" className="w-12">
                  <span className="sr-only">{tr("columns.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.map((role) => (
                <TableRow key={role.id}>
                  <TableCell className="min-w-40 py-3 whitespace-normal">
                    <span className="block font-medium leading-normal">{displayName(role)}</span>
                    {role.description ? (
                      <span className="hidden text-sm leading-normal text-muted-foreground md:block">{role.description}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden py-3 text-muted-foreground md:table-cell">{scopeName(role.scopeKind)}</TableCell>
                  <TableCell className="hidden py-3 md:table-cell">
                    {role.builtIn ? (
                      <Badge variant="neutral">{t("builtIn")}</Badge>
                    ) : (
                      <Badge variant="outline">{tr("custom")}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="py-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-ml-3 tabular-nums"
                      onClick={() => setViewing(role)}
                      aria-haspopup="dialog"
                    >
                      {tr("permissionCount", { count: role.permissions.length })}
                      <ChevronRightIcon aria-hidden="true" className="text-muted-foreground" />
                    </Button>
                  </TableCell>
                  <TableCell className="hidden py-3 text-right tabular-nums md:table-cell">
                    {canReadMembers ? (
                      <Link
                        href={membersHref(role)}
                        aria-label={`${t("assignmentCount", { count: role.assignmentCount })} · ${tr("viewAssignments", { name: displayName(role) })}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {t("assignmentCount", { count: role.assignmentCount })}
                      </Link>
                    ) : (
                      t("assignmentCount", { count: role.assignmentCount })
                    )}
                  </TableCell>
                  <TableCell className="py-3 text-right">
                    <RowActions
                      label={tr("actionsFor", { name: displayName(role) })}
                      items={rowActions(role)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </DataCard>
      <RequestStatus>{loading ? t("loading") : ""}</RequestStatus>

      <Sheet open={viewing !== null} onOpenChange={(open) => { if (!open) setViewing(null); }}>
        <SheetContent className="w-full sm:max-w-md" closeLabel={tr("close")}>
          <SheetHeader className="pr-12">
            <SheetTitle>{viewing ? displayName(viewing) : ""}</SheetTitle>
            <SheetDescription>
              {viewing ? `${scopeName(viewing.scopeKind)} · ${tr("permissionCount", { count: viewing.permissions.length })}` : tr("detailsDescription")}
            </SheetDescription>
          </SheetHeader>
          <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-6 pb-6">
            {viewing?.description ? (
              <p className="text-sm leading-normal text-muted-foreground">{viewing.description}</p>
            ) : null}
            {viewing ? groupPermissions(viewing.permissions).map(({ group, permissions }) => (
              <section key={group} aria-label={groupLabel(group)} className="grid gap-2">
                <h3 className="text-xs font-semibold leading-normal text-muted-foreground">{groupLabel(group)}</h3>
                <ul className="grid gap-2">
                  {permissions.map((permission) => (
                    <li key={permission} className="grid text-sm leading-normal">
                      <span>{permissionLabel(permission)}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{permission}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )) : null}
          </div>
          {viewing && (canReadMembers || (canManage && !viewing.builtIn)) ? (
            <SheetFooter className="flex-row flex-wrap justify-end">
              {canReadMembers ? (
                <Button asChild variant="outline">
                  <Link href={membersHref(viewing)}>{tr("viewMembers")}</Link>
                </Button>
              ) : null}
              {canManage && !viewing.builtIn ? (
                <Button onClick={() => { const role = viewing; setViewing(null); editRole(role); }}>
                  {tr("edit")}
                </Button>
              ) : null}
            </SheetFooter>
          ) : null}
        </SheetContent>
      </Sheet>

      <Sheet open={sheetOpen} onOpenChange={(open) => { if (!open) closeSheet(); }}>
        <SheetContent className="w-full sm:max-w-xl" closeLabel={tr("close")}>
          <SheetHeader>
            <SheetTitle>{editing ? t("updateRole") : t("createRole")}</SheetTitle>
            <SheetDescription>{editing ? tr("editDescription") : tr("createDescription")}</SheetDescription>
          </SheetHeader>
          <form
            id={formId}
            onSubmit={submit}
            className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto px-6 pb-2"
            aria-label={editing ? t("updateRole") : t("createRole")}
          >
            <fieldset disabled={confirming !== null} className="grid gap-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-medium leading-normal">
                  {t("roleName")}
                  <Input
                    value={draft.name}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    required
                    maxLength={100}
                  />
                </label>
                <label className="grid gap-2 text-sm font-medium leading-normal">
                  {t("scopeKind")}
                  <NativeSelect
                    disabled={editing}
                    value={draft.scopeKind}
                    wrapperClassName="w-full"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        scopeKind: event.target.value as Draft["scopeKind"],
                        grantableBySchool:
                          event.target.value === "branch" &&
                          current.grantableBySchool,
                        permissions:
                          event.target.value === "branch"
                            ? current.permissions.filter(
                                (permission) =>
                                  !CENTRAL_ONLY_PERMISSIONS.includes(permission),
                              )
                            : current.permissions,
                      }))
                    }
                  >
                    <NativeSelectOption value="branch">{t("branch")}</NativeSelectOption>
                    <NativeSelectOption value="central">{t("central")}</NativeSelectOption>
                  </NativeSelect>
                </label>
              </div>
              <label className="grid gap-2 text-sm font-medium leading-normal">
                {t("description")}
                <Textarea
                  value={draft.description}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  className="min-h-20"
                  maxLength={600}
                />
              </label>
              <fieldset className="grid gap-3">
                <legend className="flex w-full items-center justify-between gap-3 text-sm font-medium leading-normal">
                  <span>{t("permissions")}</span>
                  <span className="text-xs font-normal text-muted-foreground tabular-nums">
                    {tr("selectedCount", { count: draft.permissions.length })}
                  </span>
                </legend>
                {groupPermissions(visiblePermissions).map(({ group, permissions }) => (
                  <fieldset key={group} className="grid gap-2 rounded-md border border-border p-3">
                    <legend className="px-1 text-xs font-semibold leading-normal text-muted-foreground">{groupLabel(group)}</legend>
                    {permissions.map((permission) => (
                      <label key={permission} className="flex items-start gap-3 text-sm leading-normal">
                        <Checkbox
                          className="mt-0.5 size-4"
                          checked={draft.permissions.includes(permission)}
                          onChange={() => togglePermission(permission)}
                        />
                        <span className="grid">
                          <span>{permissionLabel(permission)}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">{permission}</span>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                ))}
              </fieldset>
              <label className="flex items-center gap-3 text-sm leading-normal">
                <Checkbox
                  className="size-4"
                  disabled={draft.scopeKind === "central"}
                  checked={draft.grantableBySchool}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      grantableBySchool: event.target.checked,
                    }))
                  }
                />
                {t("grantableBySchool")}
              </label>
            </fieldset>
          </form>
          <SheetFooter>
            {confirming ? (
              <section aria-labelledby={`${formId}-confirm`} className="grid gap-3">
                <h3 id={`${formId}-confirm`} className="text-sm font-semibold leading-normal">{t("confirmChange")}</h3>
                <p className="text-sm leading-normal text-muted-foreground">{tr("confirmHint")}</p>
                <p className="text-sm leading-normal">
                  {[
                    confirming.name,
                    scopeName(confirming.scopeKind),
                    confirming.permissions.map(permissionLabel).join(", ") || tr("permissionCount", { count: 0 }),
                  ].join(" · ")}
                </p>
                <p className="text-sm leading-normal text-muted-foreground tabular-nums">
                  {t("assignmentCount", { count: confirmAssignments })}
                </p>
                {saveFailed ? (
                  <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm leading-normal text-destructive-soft-foreground">
                    {t("error")}
                  </p>
                ) : null}
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" disabled={saving} onClick={() => setConfirming(null)}>
                    {tr("backToEditing")}
                  </Button>
                  <Button disabled={saving} aria-busy={saving || undefined} onClick={() => void save(confirming)}>
                    {saving ? t("loading") : t("confirm")}
                  </Button>
                </div>
              </section>
            ) : (
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={closeSheet}>
                  {t("cancel")}
                </Button>
                <Button type="submit" form={formId}>
                  {editing ? t("updateRole") : t("createRole")}
                </Button>
              </div>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </section>
  );
}
