"use client";

import "@/features/admin/ui/admin.css";
import Link from "next/link";
import { AccountControls } from "./AccountControls";
import { azureBrowserIdentityEnabled } from "@/lib/identity/provider";
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
import { CanvasButton as Button, CanvasTextInput, CanvasSelect, CanvasTable, CanvasResponsive } from "@/features/canvas/ui";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

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
  const tm = useTranslations("staffUi.admin.members");
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
    if (options?.azureAccountAdmin) {
      if (saving) return;
      setSaving(true);
      try {
        await responseData(await fetch(urlFor(`/api/v1/admin/accounts/${encodeURIComponent(userId)}`), {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({action: "edit", operationId: crypto.randomUUID(), displayName})}));
        await load();
      } catch { setStatus(t("error")); } finally { setSaving(false); }
      return;
    }
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
      <section className="canvas-page canvas-admin space-y-6" aria-busy="true" aria-label={t("memberDetails")}>
        <ProfileHeaderCard backHref={directoryHref} backLabel={t("title")} title={t("memberDetails")} initials="" />
        <RequestStatus>{t("loading")}</RequestStatus>
      </section>
    );
  if (error || !detail)
    return (
      <section className="canvas-page canvas-admin">
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

  const examResults = detail.examResults;
  const accountAction = detail.actions.suspendAccount && !azureBrowserIdentityEnabled() ? (
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
    <section className="canvas-page canvas-admin space-y-6" aria-label={t("memberDetails")}>
      <ProfileHeaderCard
        backHref={directoryHref}
        backLabel={t("title")}
        title={detail.displayName}
        initials={memberInitials(detail.displayName)}
        actions={canManageMcpAccess ? <Button href={routes.admin.mcp({ userId })} variant="outline">{tmcp('memberAction')}</Button> : null}
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
          onFocusCapture={(event) => {
            const tab = event.target as HTMLElement;
            if (tab.getAttribute("role") === "tab") tab.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
          }}
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
                <div className="max-w-md"><CanvasTextInput label={t("displayName")} name="displayName" defaultValue={detail.displayName} required /></div>
              </SectionCard>
            </form>
          ) : null}
          {options?.azureAccountAdmin ? <AccountControls scope={scope} actorId={actorId} userId={userId} onChanged={load} /> : null}
          {accountAction ? <div className="border-t border-border pt-4">{accountAction}</div> : null}
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
              {!detail.assignments.length ? <p className="text-sm text-muted-foreground">{tm("noRoles")}</p> : null}
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
            {!detail.effectivePermissions.length ? <p className="text-sm text-muted-foreground">{tm("noPermissions")}</p> : null}
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
              <CanvasResponsive query={{ narrow: { maxWidth: "40rem" }, wide: { minWidth: "40.01rem" } }}
                props={{ narrow: { layout: "stacked" }, wide: { layout: "fixed" } }}>
                {(responsive) => (<CanvasTable caption={() => t("learning")} layout={(responsive?.layout ?? "fixed") as "stacked" | "fixed"}>
                <CanvasTable.Head>
                  <CanvasTable.Row className="hover:bg-transparent">
                    <CanvasTable.ColHeader id="member-record-0-col-0">{tp("course")}</CanvasTable.ColHeader>
                    <CanvasTable.ColHeader id="member-record-0-col-1">{tp("progress")}</CanvasTable.ColHeader>
                    <CanvasTable.ColHeader id="member-record-0-col-2">{t("status")}</CanvasTable.ColHeader>
                    <CanvasTable.ColHeader id="member-record-0-col-3" className="text-right">{t("examAverage")}</CanvasTable.ColHeader>
                  </CanvasTable.Row>
                </CanvasTable.Head>
                <CanvasTable.Body>
                  {learning.map((course) => (
                    <CanvasTable.Row key={`${course.courseId}:${course.courseVersionId}`}>
                      <CanvasTable.RowHeader className="font-medium">
                        {course.displayTitle ?? (course.title !== course.courseId ? course.title : tp("unavailableCourse"))}
                        {!course.displayTitle && course.title === course.courseId ? <span className="block font-mono text-xs font-normal text-muted-foreground">{course.courseId}</span> : null}
                      </CanvasTable.RowHeader>
                      <CanvasTable.Cell className="tabular-nums">
                        {course.completedLessons}/{course.totalLessons}
                      </CanvasTable.Cell>
                      <CanvasTable.Cell>
                        <StatusBadge kind="enrollment" value={course.status} />
                      </CanvasTable.Cell>
                      <CanvasTable.Cell className="text-right tabular-nums">
                        {course.examAveragePercent != null ? `${course.examAveragePercent}%` : "—"}
                      </CanvasTable.Cell>
                    </CanvasTable.Row>
                  ))}
                </CanvasTable.Body>
              </CanvasTable>)}
              </CanvasResponsive>
            ) : (
              <div className="p-6">
                <EmptyState title={learning ? tp("noLearning") : tp("learningUnavailable")} />
              </div>
            )}
          </DataCard>
        </TabsContent>
        <TabsContent value="submissions" className="space-y-6">
          <DataCard title={t("assignmentResults")}>
            {submissions?.length ? (
              <CanvasResponsive query={{ narrow: { maxWidth: "40rem" }, wide: { minWidth: "40.01rem" } }}
                props={{ narrow: { layout: "stacked" }, wide: { layout: "fixed" } }}>
                {(responsive) => (<CanvasTable caption={() => t("assignmentResults")} layout={(responsive?.layout ?? "fixed") as "stacked" | "fixed"}>
                <CanvasTable.Head>
                  <CanvasTable.Row className="hover:bg-transparent">
                    <CanvasTable.ColHeader id="member-record-1-col-0">{tp("item")}</CanvasTable.ColHeader>
                    <CanvasTable.ColHeader id="member-record-1-col-1">{t("status")}</CanvasTable.ColHeader>
                    <CanvasTable.ColHeader id="member-record-1-col-2" className="text-right">{tp("score")}</CanvasTable.ColHeader>
                    <CanvasTable.ColHeader id="member-record-1-col-3">{tp("submitted")}</CanvasTable.ColHeader>
                    {canGrade ? (
                      <CanvasTable.ColHeader id="member-record-1-col-4">
                        {tm("actions")}
                      </CanvasTable.ColHeader>
                    ) : null}
                  </CanvasTable.Row>
                </CanvasTable.Head>
                <CanvasTable.Body>
                  {submissions.map((submission) => (
                    <CanvasTable.Row key={submission.id}>
                      <CanvasTable.RowHeader className="max-w-64 font-medium">
                        <span className="block break-words">{submission.displayTitle ?? tp("unavailableItem")}</span>
                        {!submission.displayTitle ? <span className="block break-all font-mono text-xs font-normal text-muted-foreground">{submission.itemId}</span> : null}
                      </CanvasTable.RowHeader>
                      <CanvasTable.Cell>
                        <StatusBadge kind="submission" value={submission.status} />
                      </CanvasTable.Cell>
                      <CanvasTable.Cell className="text-right tabular-nums">
                        {submission.percent == null ? "—" : `${submission.percent}%`}
                      </CanvasTable.Cell>
                      <CanvasTable.Cell className="tabular-nums text-muted-foreground">
                        {new Date(submission.submittedAt).toLocaleString(locale)}
                      </CanvasTable.Cell>
                      {canGrade ? (
                        <CanvasTable.Cell className="text-right">
                          <Link
                            className="text-sm font-medium underline-offset-4 hover:underline"
                            href={routes.grading.assignment(submission.id)}
                          >
                            {tp("openSubmission")}
                          </Link>
                        </CanvasTable.Cell>
                      ) : null}
                    </CanvasTable.Row>
                  ))}
                </CanvasTable.Body>
              </CanvasTable>)}
              </CanvasResponsive>
            ) : (
              <div className="p-6">
                <EmptyState title={submissions ? tp("noSubmissions") : t("submissionsUnavailable")} />
              </div>
            )}
          </DataCard>
          <DataCard title={t("examResults")}>
            {examResults?.length ? (
              <CanvasResponsive query={{ narrow: { maxWidth: "40rem" }, wide: { minWidth: "40.01rem" } }}
                props={{ narrow: { layout: "stacked" }, wide: { layout: "fixed" } }}>
                {(responsive) => (<CanvasTable caption={() => t("examResults")} layout={(responsive?.layout ?? "fixed") as "stacked" | "fixed"}>
                <CanvasTable.Head>
                  <CanvasTable.Row className="hover:bg-transparent">
                    <CanvasTable.ColHeader id="member-record-2-col-0">{tp("item")}</CanvasTable.ColHeader>
                    <CanvasTable.ColHeader id="member-record-2-col-1">{t("status")}</CanvasTable.ColHeader>
                    <CanvasTable.ColHeader id="member-record-2-col-2" className="text-right">{tp("score")}</CanvasTable.ColHeader>
                    <CanvasTable.ColHeader id="member-record-2-col-3">{tp("submitted")}</CanvasTable.ColHeader>
                  </CanvasTable.Row>
                </CanvasTable.Head>
                <CanvasTable.Body>
                  {examResults.map((exam) => (
                    <CanvasTable.Row key={exam.id}>
                      <CanvasTable.RowHeader className="max-w-64 font-medium">
                        <span className="block break-words">{exam.displayTitle ?? tp("unavailableItem")}</span>
                        {!exam.displayTitle ? <span className="block break-all font-mono text-xs font-normal text-muted-foreground">{exam.itemId}</span> : null}
                      </CanvasTable.RowHeader>
                      <CanvasTable.Cell>
                        <StatusBadge kind="examAttempt" value={exam.status} />
                      </CanvasTable.Cell>
                      <CanvasTable.Cell className="text-right tabular-nums">
                        {exam.percent == null ? "—" : `${exam.percent}%`}
                      </CanvasTable.Cell>
                      <CanvasTable.Cell className="tabular-nums text-muted-foreground">
                        {exam.submittedAt ? new Date(exam.submittedAt).toLocaleString(locale) : "—"}
                      </CanvasTable.Cell>
                    </CanvasTable.Row>
                  ))}
                </CanvasTable.Body>
              </CanvasTable>)}
              </CanvasResponsive>
            ) : (
              <div className="p-6">
                <EmptyState title={examResults ? tp("noExamResults") : t("submissionsUnavailable")} />
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
      <div className="admin-member-header flex items-start gap-4">
        <Avatar className="hidden size-12 sm:flex" aria-hidden="true">
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
  const tm = useTranslations("staffUi.admin.members");
  const roleName = useRoleDisplayName();
  const [roleId, setRoleId] = useState("");
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
      <CanvasSelect label={t("role")} value={roleId}
        options={[{ value: "", label: tm("chooseRole") }, ...options.roles.map((candidate) => ({
          value: candidate.id,
          label: candidate.builtIn ? roleName(candidate.id, candidate.name) : candidate.name,
        }))]}
        onChange={(nextRoleId) => {
          setRoleId(nextRoleId);
          const nextRole = options.roles.find((candidate) => candidate.id === nextRoleId);
          if (nextRole?.scopeKind === "central") setBranchId("");
          else if (options.scope.kind === "branch") setBranchId(options.scope.branchId);
        }} />
      <CanvasSelect label={t("school")} value={assignmentBranchId ?? ""}
        options={[{ value: "", label: t("central") }, ...options.branches.map((branch) => ({ value: branch.id, label: branch.name }))]}
        onChange={setBranchId} disabled={isCentralRole || options.scope.kind === "branch"} />
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
        disabled={!role || (!isCentralRole && !assignmentBranchId)}
      >
        {t("confirm")}
      </Button>
    </section>
  );
}
