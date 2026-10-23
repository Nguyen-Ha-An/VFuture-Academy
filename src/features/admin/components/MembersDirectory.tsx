"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";

import { GraduationCap, Mail, SearchIcon, UserPlus, Users, UserX } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Sheet,
  SheetClose,
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
import type {
  ManagementOptions,
  ManagedInvitation,
  MemberPage,
} from "@/features/admin/management-contracts";
import type { MemberStats } from "@/features/admin/member-stats";
import {
  DataCard,
  DataPagination,
  EmptyState,
  RowActions,
  StatCard,
  StatGrid,
  StatusBadge,
  type StatCardProps,
} from "@/features/staff-ui/components";
import { StaffPageHeader } from "@/features/workspace/ui/StaffPageHeader";
import type { AdminScope } from "@/lib/admin-scope";
import {
  ErrorState,
  RequestStatus,
  responseData,
  scopedUrl,
  scopeLabel,
  memberInitials,
  memberStatus,
  useRoleDisplayName,
} from "./member-admin-ui";

type Filters = { query: string; status: string; roleId: string; kind: string };

/** `?invite=1` (the admin overview's "Invite member" action) opens the invite sheet once. */
const INVITE_PARAM = "invite";

function dropInviteParam() {
  const search = new URLSearchParams(window.location.search);
  if (!search.has(INVITE_PARAM)) return;
  search.delete(INVITE_PARAM);
  const query = search.toString();
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
  );
}

function filtersFromSearch(search: URLSearchParams): Filters {
  return {
    query: search.get("memberQuery") ?? "",
    status: search.get("memberStatus") ?? "",
    roleId: search.get("memberRole") ?? "",
    kind: search.get("memberKind") ?? "",
  };
}

function writeCommittedFilters(filters: Filters, page: number) {
  const search = new URLSearchParams(window.location.search);
  const values = {
    memberQuery: filters.query,
    memberStatus: filters.status,
    memberRole: filters.roleId,
    memberKind: filters.kind,
    memberPage: page > 1 ? String(page) : "",
  };
  for (const [key, value] of Object.entries(values)) {
    if (value) search.set(key, value);
    else search.delete(key);
  }
  const query = search.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
  if (`${window.location.pathname}${window.location.search}` === nextUrl) return;
  window.history.replaceState(
    window.history.state,
    "",
    nextUrl,
  );
}

function memberRequestKey(
  filters: Filters,
  page: number,
  scope: AdminScope,
  actorId?: string,
) {
  return JSON.stringify([
    scope.kind,
    scope.kind === "branch" ? scope.branchId : null,
    actorId ?? null,
    filters.query,
    filters.status,
    filters.roleId,
    filters.kind,
    page,
  ]);
}

function memberDetailsUrl(
  id: string,
  currentSearch: string,
  filters: Filters,
  page: number,
) {
  const search = new URLSearchParams(currentSearch);
  // The invite sheet is a one-time entry point; returning from a profile must not reopen it.
  search.delete(INVITE_PARAM);
  const values = {
    memberQuery: filters.query,
    memberStatus: filters.status,
    memberRole: filters.roleId,
    memberKind: filters.kind,
    memberPage: page > 1 ? String(page) : "",
  };
  for (const [key, value] of Object.entries(values)) {
    if (value) search.set(key, value);
    else search.delete(key);
  }
  const query = search.toString();
  return `/admin/users/${encodeURIComponent(id)}${query ? `?${query}` : ""}`;
}

export function MembersDirectory({
  scope,
  actorId,
  stats,
}: {
  scope: AdminScope;
  actorId?: string;
  /** Server-read KPI row (member-stats.ts); omitted in harnesses, where no row renders. */
  stats?: MemberStats;
}) {
  const t = useTranslations("memberAdmin");
  const tm = useTranslations("staffUi.admin.members");
  const searchParams = useSearchParams();
  const searchKey = searchParams?.toString() ?? "";
  const initialFilters = useMemo(
    () => filtersFromSearch(new URLSearchParams(searchKey)),
    [searchKey],
  );
  const initialPage = useMemo(
    () =>
      Math.max(
        1,
        Number.parseInt(
          new URLSearchParams(searchKey).get("memberPage") ?? "1",
          10,
        ) || 1,
      ),
    [searchKey],
  );
  const urlFor = useCallback(
    (
      path: string,
      params: Record<string, string | number | null | undefined> = {},
    ) => scopedUrl(path, scope, { ...params, actorId }),
    [scope, actorId],
  );
  const format = useFormatter();
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [committedFilters, setCommittedFilters] =
    useState<Filters>(initialFilters);
  const [page, setPage] = useState<MemberPage | null>(null);
  const [options, setOptions] = useState<ManagementOptions | null>(null);
  const [invitations, setInvitations] = useState<ManagedInvitation[]>([]);
  // Invites created or revoked on this page since the server counted pending invitations, so
  // the KPI and the invitations card never disagree.
  const [pendingDelta, setPendingDelta] = useState(0);
  const roleName = useRoleDisplayName();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteStatus, setInviteStatus] = useState("");
  const inviteAutoOpenedRef = useRef(false);
  const inviteRequested =
    new URLSearchParams(searchKey).get(INVITE_PARAM) === "1";
  const [invitationAction, setInvitationAction] = useState<string | null>(null);
  const invitationActionRef = useRef<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const supportingRequestRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const acceptedMemberRequestKeyRef = useRef<string | null>(null);

  const loadMembers = useCallback(
    async (nextPage: number, nextFilters: Filters) => {
      const nextRequestKey = memberRequestKey(
        nextFilters,
        nextPage,
        scope,
        actorId,
      );
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      const generation = ++generationRef.current;
      setLoading(true);
      setError(false);
      try {
        const result = await responseData<MemberPage>(
          await fetch(
            urlFor("/api/v1/admin/users", {
              query: nextFilters.query,
              status: nextFilters.status,
              roleId: nextFilters.roleId,
              kind: nextFilters.kind,
              page: nextPage,
              pageSize: 20,
            }),
            { signal: controller.signal },
          ),
        );
        if (generation !== generationRef.current) return;
        acceptedMemberRequestKeyRef.current = nextRequestKey;
        setPage(result);
        setCommittedFilters(nextFilters);
        writeCommittedFilters(nextFilters, nextPage);
        setStatus(result.items.length ? "" : t("empty"));
      } catch (caught) {
        if (
          (caught as Error).name === "AbortError" ||
          generation !== generationRef.current
        )
          return;
        setError(true);
        setStatus("");
      } finally {
        if (generation === generationRef.current) setLoading(false);
      }
    },
    [actorId, scope, t, urlFor],
  );

  const loadSupportingData = useCallback(async () => {
    supportingRequestRef.current?.abort();
    const controller = new AbortController();
    supportingRequestRef.current = controller;
    try {
      const nextOptions = await responseData<ManagementOptions>(
        await fetch(urlFor("/api/v1/admin/options"), {
          signal: controller.signal,
        }),
      );
      if (controller.signal.aborted) return;
      setOptions(nextOptions);
      const nextInvitations = nextOptions.permissions.includes(
        "membership.manage",
      )
        ? await responseData<ManagedInvitation[]>(
            await fetch(urlFor("/api/v1/admin/invitations"), {
              signal: controller.signal,
            }),
          )
        : [];
      if (!controller.signal.aborted) setInvitations(nextInvitations);
    } catch (caught) {
      if ((caught as Error).name !== "AbortError") setError(true);
    }
  }, [urlFor]);

  useEffect(() => {
    setFilters(initialFilters);
    setCommittedFilters(initialFilters);
    const nextRequestKey = memberRequestKey(
      initialFilters,
      initialPage,
      scope,
      actorId,
    );
    if (acceptedMemberRequestKeyRef.current !== nextRequestKey) {
      void loadMembers(initialPage, initialFilters);
    }
    return () => requestRef.current?.abort();
  }, [actorId, initialFilters, initialPage, loadMembers, scope]);

  useEffect(() => {
    void loadSupportingData();
    return () => supportingRequestRef.current?.abort();
  }, [loadSupportingData]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadMembers(1, filters);
  }

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (invitationActionRef.current) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    invitationActionRef.current = "create";
    setInvitationAction("create");
    try {
      const invitation = await postInvite({
        email: String(values.get("email") ?? ""),
        branchId: String(values.get("branchId") ?? ""),
        roleId: String(values.get("roleId") ?? "") || null,
      });
      setInvitations((current) => [invitation, ...current]);
      if (invitation.status === "pending") setPendingDelta((delta) => delta + 1);
      setInviteUrl(invitation.inviteUrl);
      setInviteStatus(t("inviteCreated"));
      form.reset();
    } catch {
      setInviteStatus(t("error"));
    } finally {
      invitationActionRef.current = null;
      setInvitationAction(null);
    }
  }

  async function postInvite(input: {
    email: string;
    branchId: string;
    roleId: string | null;
  }): Promise<ManagedInvitation & { inviteUrl: string }> {
    setInviteStatus("");
    setInviteUrl(null);
    return responseData<ManagedInvitation & { inviteUrl: string }>(
      await fetch(urlFor("/api/v1/admin/invitations"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
  }

  async function revokeInvitation(id: string) {
    if (invitationActionRef.current) return;
    invitationActionRef.current = id;
    setInvitationAction(id);
    try {
      await responseData<{ revoked: true }>(
        await fetch(
          urlFor(`/api/v1/admin/invitations/${encodeURIComponent(id)}/revoke`),
          { method: "POST" },
        ),
      );
      const wasPending = invitations.find((invitation) => invitation.id === id)?.status === "pending";
      setInvitations((current) =>
        current.map((invitation) =>
          invitation.id === id
            ? { ...invitation, status: "revoked" }
            : invitation,
        ),
      );
      if (wasPending) setPendingDelta((delta) => delta - 1);
    } catch {
      setStatus(t("error"));
    } finally {
      invitationActionRef.current = null;
      setInvitationAction(null);
    }
  }

  async function reissueInvitation(invitation: ManagedInvitation) {
    if (invitationActionRef.current) return;
    invitationActionRef.current = invitation.id;
    setInvitationAction(invitation.id);
    setInviteUrl(null);
    setStatus("");
    try {
      await responseData<{ revoked: true }>(
        await fetch(
          urlFor(
            `/api/v1/admin/invitations/${encodeURIComponent(invitation.id)}/revoke`,
          ),
          { method: "POST" },
        ),
      );
      setInvitations((current) =>
        current.map((item) =>
          item.id === invitation.id ? { ...item, status: "revoked" } : item,
        ),
      );
      if (invitation.status === "pending") setPendingDelta((delta) => delta - 1);
      const replacement = await postInvite({
        email: invitation.email,
        branchId: invitation.branchId,
        roleId: invitation.roleId,
      });
      setInvitations((current) => [replacement, ...current]);
      if (replacement.status === "pending") setPendingDelta((delta) => delta + 1);
      setInviteUrl(replacement.inviteUrl);
      setInviteStatus(t("inviteCreated"));
      // The fresh one-time link is shown where every invite link lives: the invite sheet.
      setInviteOpen(true);
    } catch {
      setStatus(t("error"));
    } finally {
      invitationActionRef.current = null;
      setInvitationAction(null);
    }
  }

  const canInvite = options?.permissions.includes("membership.manage") ?? false;
  const branchName = (branchId: string) =>
    options?.branches.find((branch) => branch.id === branchId)?.name ?? branchId;

  useEffect(() => {
    if (!inviteRequested || !canInvite || inviteAutoOpenedRef.current) return;
    inviteAutoOpenedRef.current = true;
    setInviteOpen(true);
  }, [canInvite, inviteRequested]);

  function changeInviteOpen(next: boolean) {
    setInviteOpen(next);
    if (next) return;
    // A one-time link is shown once; closing the sheet forgets it.
    setInviteUrl(null);
    setInviteStatus("");
    dropInviteParam();
  }

  function copyEmail(email: string) {
    void navigator.clipboard
      ?.writeText(email)
      .then(() => setStatus(tm("emailCopied")))
      .catch(() => setStatus(t("error")));
  }

  const statCards: (StatCardProps & { key: string })[] = [];
  if (stats?.members !== undefined)
    statCards.push({ key: "members", label: tm("stats.members"), value: stats.members, icon: Users });
  if (stats?.learners !== undefined)
    statCards.push({ key: "learners", label: tm("stats.learners"), value: stats.learners, icon: GraduationCap, href: stats.learners === null ? undefined : "/admin/users?memberKind=learner" });
  if (stats?.suspended !== undefined)
    statCards.push({ key: "suspended", label: tm("stats.suspended"), value: stats.suspended, icon: UserX, href: stats.suspended === null ? undefined : "/admin/users?memberStatus=suspended" });
  if (stats?.pendingInvitations !== undefined)
    statCards.push({
      key: "pendingInvitations",
      label: tm("stats.pendingInvitations"),
      value: stats.pendingInvitations === null ? null : Math.max(0, stats.pendingInvitations + pendingDelta),
      icon: Mail,
      href: stats.pendingInvitations === null || !canInvite ? undefined : "#invitations",
    });

  const currentPage = page?.page ?? 1;
  const filterForm = (
    <form
      onSubmit={submitSearch}
      role="search"
      className="flex flex-col gap-3 lg:flex-row lg:items-center"
    >
      <label className="relative min-w-0 flex-1">
        <span className="sr-only">{t("search")}</span>
        <SearchIcon aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          className="pl-9"
          placeholder={tm("searchPlaceholder")}
          value={filters.query}
          onChange={(event) =>
            setFilters((current) => ({ ...current, query: event.target.value }))
          }
        />
      </label>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:flex lg:items-center">
        <label className="min-w-0">
          <span className="sr-only">{t("status")}</span>
          <NativeSelect
            wrapperClassName="w-full lg:w-40"
            value={filters.status}
            onChange={(event) =>
              setFilters((current) => ({ ...current, status: event.target.value }))
            }
          >
            <NativeSelectOption value="">{t("allStatuses")}</NativeSelectOption>
            <NativeSelectOption value="active">{t("active")}</NativeSelectOption>
            <NativeSelectOption value="suspended">{t("suspended")}</NativeSelectOption>
          </NativeSelect>
        </label>
        <label className="min-w-0">
          <span className="sr-only">{t("roles")}</span>
          <NativeSelect
            wrapperClassName="w-full lg:w-44"
            value={filters.roleId}
            onChange={(event) =>
              setFilters((current) => ({ ...current, roleId: event.target.value }))
            }
          >
            <NativeSelectOption value="">{t("allRoles")}</NativeSelectOption>
            {options?.roles.map((role) => (
              <NativeSelectOption key={role.id} value={role.id}>
                {role.builtIn ? roleName(role.id, role.name) : role.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="min-w-0">
          <span className="sr-only">{t("kind")}</span>
          <NativeSelect
            wrapperClassName="w-full lg:w-40"
            value={filters.kind}
            onChange={(event) =>
              setFilters((current) => ({ ...current, kind: event.target.value }))
            }
          >
            <NativeSelectOption value="">{t("allKinds")}</NativeSelectOption>
            <NativeSelectOption value="learner">{t("learner")}</NativeSelectOption>
            <NativeSelectOption value="staff">{t("staff")}</NativeSelectOption>
          </NativeSelect>
        </label>
        <Button type="submit" variant="outline">
          {t("search")}
        </Button>
      </div>
    </form>
  );

  return (
    <section className="space-y-6" aria-label={t("title")}>
      <StaffPageHeader
        title={t("title")}
        eyebrow={t("administration")}
        actions={
          canInvite ? (
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus aria-hidden="true" />
              {t("inviteMember")}
            </Button>
          ) : null
        }
      />
      {statCards.length ? (
        <StatGrid aria-label={tm("stats.label")}>
          {statCards.map(({ key, ...card }) => (
            <StatCard key={key} {...card} />
          ))}
        </StatGrid>
      ) : null}
      {error ? (
        <ErrorState
          onRetry={() => void loadMembers(currentPage, committedFilters)}
        />
      ) : null}
      <DataCard
        toolbar={filterForm}
        footer={
          currentPage > 1 || page?.hasMore ? (
            <DataPagination
              mode="hasMore"
              page={currentPage}
              hasMore={Boolean(page?.hasMore)}
              label={t("title")}
              labels={{ previous: t("previous"), next: t("next") }}
              summary={t("page", { page: currentPage })}
              onPageChange={(nextPage) => {
                if (!loading) void loadMembers(nextPage, committedFilters);
              }}
            />
          ) : null
        }
      >
        <Table aria-label={t("title")}>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{tm("member")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("school")}</TableHead>
              <TableHead className="hidden lg:table-cell">{t("roles")}</TableHead>
              <TableHead>{t("status")}</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">{tm("actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page?.items.map((member) => {
              const href = memberDetailsUrl(member.id, searchKey, committedFilters, currentPage);
              const effectiveStatus = memberStatus(member, scope);
              return (
                <TableRow key={member.id}>
                  <TableCell className="py-2.5">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar className="size-9" aria-hidden="true">
                        <AvatarFallback>{memberInitials(member.displayName)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <Link
                          className="block truncate font-medium leading-normal text-foreground underline-offset-4 hover:underline"
                          href={href}
                        >
                          {member.displayName}
                        </Link>
                        <p className="truncate text-xs leading-normal text-muted-foreground">
                          {member.email}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {member.memberships
                      .filter((membership) => membership.status === "active")
                      .map((membership) => membership.branchName)
                      .join(", ") || "—"}
                  </TableCell>
                  <TableCell className="hidden whitespace-normal lg:table-cell">
                    {member.assignments
                      .map((assignment) => roleName(assignment.roleId, assignment.roleName))
                      .join(", ") || "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      kind="member"
                      value={effectiveStatus}
                      label={effectiveStatus === "active" ? t("active") : t("suspended")}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <RowActions
                      label={tm("actionsFor", { name: member.displayName })}
                      items={[
                        { label: tm("viewProfile"), href },
                        { label: tm("copyEmail"), onSelect: () => copyEmail(member.email) },
                      ]}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {!loading && page?.items.length === 0 ? (
          <div className="p-6">
            <EmptyState title={t("empty")} />
          </div>
        ) : null}
      </DataCard>
      {loading ? (
        <RequestStatus>{t("loading")}</RequestStatus>
      ) : (
        <RequestStatus>{status}</RequestStatus>
      )}
      {canInvite ? (
        <DataCard
          id="invitations"
          title={t("invitations")}
          description={`${scopeLabel(scope, options?.branches ?? [])} · ${tm("invitationsDescription")}`}
        >
          {invitations.length ? (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t("email")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("school")}</TableHead>
                  <TableHead>{t("status")}</TableHead>
                  <TableHead className="hidden sm:table-cell">{tm("expiresColumn")}</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">{tm("invitationActions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((invitation) => (
                  <TableRow key={invitation.id}>
                    <TableCell className="max-w-64 truncate font-medium">{invitation.email}</TableCell>
                    <TableCell className="hidden md:table-cell">{branchName(invitation.branchId)}</TableCell>
                    <TableCell>
                      <StatusBadge kind="invitation" value={invitation.status} />
                    </TableCell>
                    <TableCell className="hidden tabular-nums text-muted-foreground sm:table-cell">
                      {format.dateTime(new Date(invitation.expiresAt), { dateStyle: "medium" })}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="inline-flex flex-wrap justify-end gap-2">
                        {invitation.status === "pending" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void revokeInvitation(invitation.id)}
                            disabled={invitationAction !== null}
                          >
                            {t("revoke")}
                          </Button>
                        ) : null}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void reissueInvitation(invitation)}
                          disabled={invitationAction !== null}
                        >
                          {t("reissue")}
                        </Button>
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-6">
              <EmptyState title={tm("invitationsEmpty")} />
            </div>
          )}
        </DataCard>
      ) : null}
      {canInvite ? (
        <Sheet open={inviteOpen} onOpenChange={changeInviteOpen}>
          <SheetContent closeLabel={tm("closeSheet")} className="w-full sm:max-w-md">
            <SheetHeader className="pr-12">
              <SheetTitle>{t("inviteMember")}</SheetTitle>
              <SheetDescription>{tm("inviteDescription")}</SheetDescription>
            </SheetHeader>
            <form onSubmit={createInvitation} className="flex min-h-0 flex-1 flex-col gap-4">
              <div className="grid gap-4 overflow-y-auto px-6">
                <label className="grid gap-1.5 text-sm font-medium leading-normal">
                  {t("inviteEmail")}
                  <Input name="email" type="email" required autoComplete="off" />
                </label>
                <label className="grid gap-1.5 text-sm font-medium leading-normal">
                  {t("inviteSchool")}
                  <NativeSelect
                    name="branchId"
                    wrapperClassName="w-full"
                    defaultValue={scope.kind === "branch" ? scope.branchId : options?.branches[0]?.id}
                  >
                    {options?.branches.map((branch) => (
                      <NativeSelectOption key={branch.id} value={branch.id}>
                        {branch.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
                <label className="grid gap-1.5 text-sm font-medium leading-normal">
                  {t("inviteRole")}
                  <NativeSelect name="roleId" wrapperClassName="w-full">
                    <NativeSelectOption value="">{t("noRole")}</NativeSelectOption>
                    {options?.roles
                      .filter((role) => role.scopeKind === "branch")
                      .map((role) => (
                        <NativeSelectOption key={role.id} value={role.id}>
                          {role.builtIn ? roleName(role.id, role.name) : role.name}
                        </NativeSelectOption>
                      ))}
                  </NativeSelect>
                </label>
                {inviteUrl ? (
                  <div className="grid gap-2 rounded-md border border-border bg-muted/50 p-3">
                    <p className="text-sm font-medium leading-normal">{tm("oneTimeLink")}</p>
                    <a href={inviteUrl} className="break-all text-sm leading-normal text-foreground underline underline-offset-4">
                      {inviteUrl}
                    </a>
                    <Button
                      variant="outline"
                      size="sm"
                      className="justify-self-start"
                      onClick={() => void navigator.clipboard?.writeText(inviteUrl)}
                    >
                      {t("copyLink")}
                    </Button>
                  </div>
                ) : null}
                <RequestStatus>{inviteStatus}</RequestStatus>
              </div>
              <SheetFooter className="flex-row justify-end">
                <SheetClose asChild>
                  <Button variant="outline">{t("cancel")}</Button>
                </SheetClose>
                <Button type="submit" disabled={invitationAction !== null}>
                  {invitationAction === "create" ? t("loading") : t("sendInvite")}
                </Button>
              </SheetFooter>
            </form>
          </SheetContent>
        </Sheet>
      ) : null}
    </section>
  );
}
