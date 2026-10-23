"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { BookOpen, ChevronLeft, FileCheck, School, ShieldCheck } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatStaffAuditAction, formatStaffAuditTarget } from "@/features/admin/audit-format";
import type {
  ManagementOptions,
  MemberDetail,
} from "@/features/admin/management-contracts";
import {
  DataCard,
  EmptyState,
  SectionCard,
  StatCard,
  StatGrid,
  StatusBadge,
  TimelineCard,
  type StatCardProps,
} from "@/features/staff-ui/components";
import { StaffPageHeader } from "@/features/workspace/ui/StaffPageHeader";
import type { AdminScope } from "@/lib/admin-scope";
import { routes } from "@/lib/routes";
import {
  ConfirmationDialog,
  ErrorState,
  RequestStatus,
  responseData,
  scopedUrl,
  scopeLabel,
  memberInitials,
  memberStatus,
  useRoleDisplayName,
} from "./member-admin-ui";

/** The detail read returns at most this many submissions (admin_management_read 'user'). */
const SUBMISSION_LIMIT = 100;

type PendingMutation = {
  title: string;
  description: string;
  body: unknown;
} | null;

export function MemberProfile({
  userId,
  scope,
  actorId,
  canManageMcpAccess = false,
}: {
  userId: string;
  scope: AdminScope;
  actorId?: string;
  canManageMcpAccess?: boolean;
}) {
  const t = useTranslations("memberAdmin");
  const tp = useTranslations("staffUi.admin.members.profile");
  const tmcp = useTranslations("staffUi.admin.mcp");
  const torg = useTranslations("staffUi.admin.org");
  const roleName = useRoleDisplayName();
  // Same readable labels as the roles page; an unknown code stays as-is.
  const permissionLabel = (permission: string) => {
    const key = `permissionLabels.${permission.replaceAll(".", "_")}`;
    return torg.has(key) ? torg(key) : permission;
  };
  const searchParams = useSearchParams();
  const directorySearch = searchParams?.toString() ?? "";
  const directoryHref = `/admin/users${directorySearch ? `?${directorySearch}` : ""}`;
  const urlFor = useCallback(
    (
      path: string,
      params: Record<string, string | number | null | undefined> = {},
    ) => scopedUrl(path, scope, { ...params, actorId }),
    [scope, actorId],
  );
  const locale = useLocale();
  const [detail, setDetail] = useState<MemberDetail | null>(null);
  const [options, setOptions] = useState<ManagementOptions | null>(null);
  const [pending, setPending] = useState<PendingMutation>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [status, setStatus] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const sequenceRef = useRef(0);

  const load = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const sequence = ++sequenceRef.current;
    setLoading(true);
    setError(false);
    try {
      const [member, nextOptions] = await Promise.all([
        responseData<MemberDetail>(
          await fetch(
            urlFor(`/api/v1/admin/users/${encodeURIComponent(userId)}`),
            { signal: controller.signal },
          ),
        ),
        responseData<ManagementOptions>(
          await fetch(urlFor("/api/v1/admin/options"), {
            signal: controller.signal,
          }),
        ),
      ]);
      if (sequence !== sequenceRef.current) return;
      setDetail(member);
      setOptions(nextOptions);
    } catch (caught) {
      if (
        (caught as Error).name !== "AbortError" &&
        sequence === sequenceRef.current
      )
        setError(true);
    } finally {
      if (sequence === sequenceRef.current) setLoading(false);
    }
  }, [userId, urlFor]);

  useEffect(() => {
    void load();
    return () => requestRef.current?.abort();
  }, [load]);

  async function saveIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const displayName = String(
      new FormData(event.currentTarget).get("displayName") ?? "",
    ).trim();
    if (!displayName) return;
    await mutate({ action: "identity", displayName });
  }

  async function mutate(body: unknown) {
    if (saving) return;
    setSaving(true);
    setStatus("");
    try {
      await responseData<MemberDetail>(
        await fetch(
          urlFor(`/api/v1/admin/users/${encodeURIComponent(userId)}`),
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        ),
      );
      setPending(null);
      if (actorId === userId && !['identity','transfer'].includes((body as {action:string}).action)) {
        window.location.assign('/admin');
        return;
      }
      await load();
    } catch {
      setStatus(t("error"));
    } finally {
      setSaving(false);
    }
  }

  function queueMutation(title: string, description: string, body: unknown) {
    setPending({ title, description, body });
  }
  if (loading && !detail)
    return (
      // Same header in the same place as the loaded page, so the h1 the shell focuses on
      // navigation survives the load and only its text changes.
      <section className="space-y-6" aria-busy="true" aria-label={t("memberDetails")}>
        <ProfileHeaderCard backHref={directoryHref} backLabel={t("title")} title={t("memberDetails")} initials="" />
        <RequestStatus>{t("loading")}</RequestStatus>
      </section>
    );
  if (error || !detail)
    return (
      <section>
        <ErrorState onRetry={() => void load()} />
      </section>
    );
  const canAssignRoles =
    detail.actions.assignRole && Boolean(options?.roles.length);
  const primaryMembership =
    detail.memberships.find((membership) => membership.isPrimary) ??
    detail.memberships.find(
      (membership) => membership.branchId === detail.branchId,
    );
  const selectedBranch = primaryMembership?.branchId ?? detail.branchId ?? "";
  const effectiveStatus = memberStatus(detail, scope);
  const branches = options?.branches ?? [];
  const canGrade = options?.permissions.includes("submission.grade") ?? false;
  // An actor the directory cannot name reads "Unknown user", never a bare UUID.
  const actorName = (id: string | null) =>
    id ? (detail.actors?.[id.toLowerCase()]?.name ?? tp("unknownGrantor")) : t("systemActor");
  const learning = detail.actions.readLearning ? detail.learning : undefined;
  const submissions = detail.actions.readSubmissions ? detail.submissions : undefined;
  const history = detail.actions.readHistory ? (detail.history ?? []) : undefined;

  // Snapshot counts straight from the detail read: no deltas, and a list the viewer may not
  // read hides its card. Submissions arrive capped at the latest 100, so 100 reads "100+".
  const statCards: (StatCardProps & { key: string })[] = [
    { key: "schools", label: tp("schools"), value: detail.memberships.length, icon: School },
    { key: "roles", label: tp("roles"), value: detail.assignments.length, icon: ShieldCheck },
  ];
  if (learning)
    statCards.push({ key: "courses", label: tp("courses"), value: learning.length, icon: BookOpen });
  if (submissions)
    statCards.push(
      submissions.length >= SUBMISSION_LIMIT
        ? { key: "submissions", label: tp("submissions"), value: tp("atLeast", { count: SUBMISSION_LIMIT }), hint: tp("latestOnly"), icon: FileCheck }
        : { key: "submissions", label: tp("submissions"), value: submissions.length, icon: FileCheck },
    );

  const accountAction = detail.actions.suspendAccount ? (
    <Button
      variant="outline"
      className={detail.accountStatus === "active" ? "text-destructive hover:text-destructive" : undefined}
      disabled={saving}
      onClick={() =>
        queueMutation(
          detail.accountStatus === "active"
            ? t("suspendAccount")
            : t("activateAccount"),
          t("accountChange", {
            name: detail.displayName,
            status:
              detail.accountStatus === "active"
                ? t("suspended")
                : t("active"),
          }),
          {
            action: "account-status",
            status:
              detail.accountStatus === "active"
                ? "suspended"
                : "active",
          },
        )
      }
    >
      {detail.accountStatus === "active"
        ? t("suspendAccount")
        : t("activateAccount")}
    </Button>
  ) : null;

  return (
    <section className="space-y-6" aria-label={t("memberDetails")}>
      <ProfileHeaderCard
        backHref={directoryHref}
        backLabel={t("title")}
        title={detail.displayName}
        initials={memberInitials(detail.displayName)}
        actions={accountAction || canManageMcpAccess ? (
          <>
            {canManageMcpAccess ? (
              <Button asChild variant="outline">
                <Link href={routes.admin.mcp({ userId })}>{tmcp('memberAction')}</Link>
              </Button>
            ) : null}
            {accountAction}
          </>
        ) : null}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm leading-normal text-muted-foreground">
          <StatusBadge
            kind="member"
            value={effectiveStatus}
            label={effectiveStatus === "active" ? t("active") : t("suspended")}
          />
          <span className="min-w-0 break-all">
            {detail.email}
            {detail.handle ? ` · @${detail.handle}` : ""}
          </span>
        </div>
      </ProfileHeaderCard>
      <StatGrid aria-label={tp("statsLabel")}>
        {statCards.map(({ key, ...card }) => (
          <StatCard key={key} {...card} />
        ))}
      </StatGrid>
      <Tabs defaultValue="information" className="gap-6">
        <TabsList
          variant="line"
          aria-label={t("memberDetails")}
          className="w-full max-w-full justify-start overflow-x-auto"
        >
          <TabsTrigger value="information">{t("information")}</TabsTrigger>
          <TabsTrigger value="memberships">{t("schoolsRoles")}</TabsTrigger>
          <TabsTrigger value="learning">{t("learning")}</TabsTrigger>
          <TabsTrigger value="submissions">{t("submissionsResults")}</TabsTrigger>
          <TabsTrigger value="history">{t("managementHistory")}</TabsTrigger>
        </TabsList>
        <TabsContent value="information" className="space-y-6">
          <SectionCard title={t("information")} columns={1}>
            <dl className="grid gap-4 sm:grid-cols-3">
              <div className="min-w-0">
                <dt className="text-sm leading-normal text-muted-foreground">{t("email")}</dt>
                <dd className="mt-1 break-all text-sm leading-normal">{detail.email}</dd>
              </div>
              <div>
                <dt className="text-sm leading-normal text-muted-foreground">{t("createdAt")}</dt>
                <dd className="mt-1 text-sm leading-normal tabular-nums">
                  {new Date(detail.createdAt).toLocaleDateString(locale)}
                </dd>
              </div>
              <div>
                <dt className="text-sm leading-normal text-muted-foreground">{t("school")}</dt>
                <dd className="mt-1 text-sm leading-normal">
                  {primaryMembership?.branchName ??
                    branches.find((branch) => branch.id === detail.branchId)?.name ??
                    t("noSchool")}
                </dd>
              </div>
            </dl>
          </SectionCard>
          {detail.actions.editIdentity ? (
            <form onSubmit={saveIdentity}>
              <SectionCard
                title={t("displayName")}
                columns={1}
                footer={
                  <Button type="submit" disabled={saving}>
                    {t("save")}
                  </Button>
                }
              >
                <label className="grid max-w-md gap-1.5 text-sm font-medium leading-normal">
                  {t("displayName")}
                  <Input name="displayName" defaultValue={detail.displayName} required />
                </label>
              </SectionCard>
            </form>
          ) : null}
        </TabsContent>
        <TabsContent value="memberships" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <SectionCard title={t("schoolsRoles")} columns={1}>
              <ul className="divide-y divide-border">
                {detail.memberships.map((membership) => (
                  <li
                    key={membership.branchId}
                    className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm leading-normal first:pt-0 last:pb-0"
                  >
                    <span className="min-w-0">
                      {membership.branchName}
                      {membership.isPrimary ? ` · ${t("primary")}` : ""}
                    </span>
                    <StatusBadge kind="member" value={membership.status} label={t(membership.status)} />
                  </li>
                ))}
              </ul>
            </SectionCard>
            <SectionCard title={t("roles")} columns={1}>
              <ul className="divide-y divide-border">
                {detail.assignments.map((assignment) => (
                  <li key={assignment.id} className="py-3 first:pt-0 last:pb-0">
                    <p className="text-sm font-medium leading-normal">{roleName(assignment.roleId, assignment.roleName)}</p>
                    <p className="text-xs leading-normal text-muted-foreground">
                      {scopeLabel(assignment.scope, branches)} ·{" "}
                      {actorName(assignment.grantedBy)} ·{" "}
                      <span className="tabular-nums">
                        {new Date(assignment.grantedAt).toLocaleString(locale)}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            </SectionCard>
          </div>
          {detail.actions.assignRole && detail.assignments.length ? (
            <div className="flex flex-wrap gap-2">
              {detail.assignments.map((assignment) => (
                <Button
                  key={assignment.id}
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    queueMutation(
                      `${t("revoke")} ${assignment.roleName}`,
                      t("revokeSummary", {
                        role: assignment.roleName,
                        scope: scopeLabel(assignment.scope, branches),
                      }),
                      {
                        action: "role",
                        roleId: assignment.roleId,
                        branchId:
                          assignment.scope.kind === "branch"
                            ? assignment.scope.branchId
                            : null,
                        enabled: false,
                      },
                    )
                  }
                >
                  {t("revoke")} {assignment.roleName}
                </Button>
              ))}
            </div>
          ) : null}
          {detail.actions.transfer ? (
            <label className="grid max-w-sm gap-1.5 text-sm font-medium leading-normal">
              {t("transfer")}
              <NativeSelect
                defaultValue={selectedBranch}
                aria-label={t("transfer")}
                wrapperClassName="w-full"
                onChange={(event) =>
                  queueMutation(
                    t("transfer"),
                    t("transferSummary", {
                      name: detail.displayName,
                      school:
                        event.currentTarget.options[
                          event.currentTarget.selectedIndex
                        ]?.text ?? t("noSchool"),
                    }),
                    {
                      action: "transfer",
                      branchId: event.target.value || null,
                    },
                  )
                }
              >
                <NativeSelectOption value="">—</NativeSelectOption>
                {branches.map((branch) => (
                  <NativeSelectOption key={branch.id} value={branch.id}>
                    {branch.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          ) : null}
          {detail.actions.manageMembership && detail.memberships.length ? (
            <div className="flex flex-wrap gap-2">
              {detail.memberships.map((membership) => (
                <Button
                  key={membership.branchId}
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    queueMutation(
                      t("membershipStatus"),
                      t("membershipChange", {
                        school: membership.branchName,
                        status:
                          membership.status === "active"
                            ? t("suspended")
                            : t("active"),
                      }),
                      {
                        action: "membership-status",
                        branchId: membership.branchId,
                        status:
                          membership.status === "active"
                            ? "suspended"
                            : "active",
                      },
                    )
                  }
                >
                  {membership.status === "active"
                    ? t("suspendSchool", { school: membership.branchName })
                    : t("activateSchool", { school: membership.branchName })}
                </Button>
              ))}
            </div>
          ) : null}
          {canAssignRoles ? (
            <RoleAssignment
              detail={detail}
              options={options!}
              onQueue={queueMutation}
            />
          ) : null}
          <SectionCard title={t("effectivePermissions")} columns={1}>
            <ul className="space-y-3">
              {detail.effectivePermissions.map((entry) => (
                <li
                  key={
                    entry.scope.kind === "central"
                      ? "central"
                      : entry.scope.branchId
                  }
                  className="border-l-2 border-border pl-3"
                >
                  <p className="text-sm font-medium leading-normal">
                    {scopeLabel(entry.scope, branches)}
                  </p>
                  <p className="break-words text-sm leading-normal text-muted-foreground">
                    {entry.permissions.map(permissionLabel).join(", ") || "—"}
                  </p>
                </li>
              ))}
            </ul>
          </SectionCard>
        </TabsContent>
        <TabsContent value="learning">
          <DataCard title={t("learning")}>
            {learning?.length ? (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{tp("course")}</TableHead>
                    <TableHead>{tp("progress")}</TableHead>
                    <TableHead>{t("status")}</TableHead>
                    <TableHead className="text-right">{t("examAverage")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {learning.map((course) => (
                    <TableRow key={`${course.courseId}:${course.courseVersionId}`}>
                      <TableCell className="font-medium">
                        {course.displayTitle ?? (course.title !== course.courseId ? course.title : tp("unavailableCourse"))}
                        {!course.displayTitle && course.title === course.courseId ? <span className="block font-mono text-xs font-normal text-muted-foreground">{course.courseId}</span> : null}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {course.completedLessons}/{course.totalLessons}
                      </TableCell>
                      <TableCell>
                        <StatusBadge kind="enrollment" value={course.status} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {course.examAveragePercent != null ? `${course.examAveragePercent}%` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="p-6">
                <EmptyState title={t("empty")} />
              </div>
            )}
          </DataCard>
        </TabsContent>
        <TabsContent value="submissions" className="space-y-6">
          <DataCard title={t("assignmentResults")}>
            {submissions?.length ? (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{tp("item")}</TableHead>
                    <TableHead>{t("status")}</TableHead>
                    <TableHead className="text-right">{tp("score")}</TableHead>
                    <TableHead>{tp("submitted")}</TableHead>
                    {canGrade ? (
                      <TableHead>
                        <span className="sr-only">{tp("openSubmission")}</span>
                      </TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {submissions.map((submission) => (
                    <TableRow key={submission.id}>
                      <TableCell className="max-w-64 font-medium">
                        <span className="block truncate">{submission.displayTitle ?? tp("unavailableItem")}</span>
                        {!submission.displayTitle ? <span className="block truncate font-mono text-xs font-normal text-muted-foreground">{submission.itemId}</span> : null}
                      </TableCell>
                      <TableCell>
                        <StatusBadge kind="submission" value={submission.status} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {submission.percent == null ? "—" : `${submission.percent}%`}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {new Date(submission.submittedAt).toLocaleString(locale)}
                      </TableCell>
                      {canGrade ? (
                        <TableCell className="text-right">
                          <Link
                            className="text-sm font-medium underline-offset-4 hover:underline"
                            href={routes.grading.assignment(submission.id)}
                          >
                            {tp("openSubmission")}
                          </Link>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="p-6">
                <EmptyState title={t("submissionsUnavailable")} />
              </div>
            )}
          </DataCard>
          <DataCard title={t("examResults")}>
            {detail.examResults?.length ? (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{tp("item")}</TableHead>
                    <TableHead>{t("status")}</TableHead>
                    <TableHead className="text-right">{tp("score")}</TableHead>
                    <TableHead>{tp("submitted")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.examResults.map((exam) => (
                    <TableRow key={exam.id}>
                      <TableCell className="max-w-64 font-medium">
                        <span className="block truncate">{exam.displayTitle ?? tp("unavailableItem")}</span>
                        {!exam.displayTitle ? <span className="block truncate font-mono text-xs font-normal text-muted-foreground">{exam.itemId}</span> : null}
                      </TableCell>
                      <TableCell>
                        <StatusBadge kind="examAttempt" value={exam.status} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {exam.percent == null ? "—" : `${exam.percent}%`}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {exam.submittedAt ? new Date(exam.submittedAt).toLocaleString(locale) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="p-6">
                <EmptyState title={t("empty")} />
              </div>
            )}
          </DataCard>
        </TabsContent>
        <TabsContent value="history">
          <TimelineCard
            title={t("managementHistory")}
            emptyLabel={history ? undefined : t("historyUnavailable")}
            items={(history ?? []).map((entry) => {
              const action = formatStaffAuditAction(entry.action, locale);
              return {
                id: entry.id,
                title: action.label,
                status: { tone: "neutral" as const, label: formatStaffAuditTarget(entry.targetType, locale) },
                description: action.rawCode ?? undefined,
                at: entry.at,
                actor: actorName(entry.actorId),
              };
            })}
          />
        </TabsContent>
      </Tabs>
      <RequestStatus>{status}</RequestStatus>
      <ConfirmationDialog
        open={pending !== null}
        title={pending?.title ?? t("confirmChange")}
        description={pending?.description ?? ""}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending) void mutate(pending.body);
        }}
      />
    </section>
  );
}

/** Back link plus the header card: avatar, the page h1 (via StaffPageHeader), meta line and account action. */
function ProfileHeaderCard({
  backHref,
  backLabel,
  title,
  initials,
  actions,
  children,
}: {
  backHref: string;
  backLabel: string;
  title: string;
  initials: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <>
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-sm leading-normal text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        {backLabel}
      </Link>
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6 text-card-foreground sm:flex-row sm:items-start [&_.staff-page-header]:!mb-0">
        <Avatar className="size-14" aria-hidden="true">
          <AvatarFallback className="text-base">{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <StaffPageHeader title={title} actions={actions}>
            {children}
          </StaffPageHeader>
        </div>
      </div>
    </>
  );
}

function RoleAssignment({
  detail,
  options,
  onQueue,
}: {
  detail: MemberDetail;
  options: ManagementOptions;
  onQueue: (title: string, description: string, body: unknown) => void;
}) {
  const t = useTranslations("memberAdmin");
  const [roleId, setRoleId] = useState(options.roles[0]?.id ?? "");
  const [branchId, setBranchId] = useState(
    options.scope.kind === "branch"
      ? options.scope.branchId
      : (detail.branchId ?? ""),
  );
  const role = options.roles.find((candidate) => candidate.id === roleId);
  const isCentralRole = role?.scopeKind === "central";
  const assignmentBranchId = isCentralRole
    ? null
    : options.scope.kind === "branch"
      ? options.scope.branchId
      : branchId || null;
  const assignmentScopeLabel = assignmentBranchId
    ? (options.branches.find((branch) => branch.id === assignmentBranchId)
        ?.name ?? assignmentBranchId)
    : t("central");
  return (
    <section className="grid gap-3 rounded-lg border border-border bg-card p-6 md:grid-cols-[1fr_1fr_auto] md:items-end">
      <label className="grid gap-1.5 text-sm font-medium leading-normal">
        {t("role")}
        <NativeSelect
          value={roleId}
          wrapperClassName="w-full"
          onChange={(event) => {
            const nextRoleId = event.target.value;
            setRoleId(nextRoleId);
            const nextRole = options.roles.find(
              (candidate) => candidate.id === nextRoleId,
            );
            if (nextRole?.scopeKind === "central") setBranchId("");
            else if (options.scope.kind === "branch")
              setBranchId(options.scope.branchId);
          }}
        >
          {options.roles.map((candidate) => (
            <NativeSelectOption key={candidate.id} value={candidate.id}>
              {candidate.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      <label className="grid gap-1.5 text-sm font-medium leading-normal">
        {t("school")}
        <NativeSelect
          value={assignmentBranchId ?? ""}
          wrapperClassName="w-full"
          onChange={(event) => setBranchId(event.target.value)}
          disabled={isCentralRole || options.scope.kind === "branch"}
        >
          <NativeSelectOption value="">{t("central")}</NativeSelectOption>
          {options.branches.map((branch) => (
            <NativeSelectOption key={branch.id} value={branch.id}>
              {branch.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      <Button
        onClick={() =>
          role &&
          onQueue(
            `${t("role")}: ${role.name}`,
            t("grantSummary", { role: role.name, scope: assignmentScopeLabel }),
            {
              action: "role",
              roleId,
              branchId: assignmentBranchId,
              enabled: true,
            },
          )
        }
        disabled={!isCentralRole && !assignmentBranchId}
      >
        {t("confirm")}
      </Button>
    </section>
  );
}
