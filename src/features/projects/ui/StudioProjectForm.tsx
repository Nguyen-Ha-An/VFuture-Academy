"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { ContentWorkflowPanel } from "@/features/content-review/ContentWorkflowPanel";
import { ContentSaveIndicator } from "@/features/content-review/ContentSaveIndicator";
import { useUnsavedChanges } from "@/features/studio/ui/useUnsavedChanges";
import { useStaffTitleRegistration } from "@/features/workspace/ui/StaffTitleContext";
import {
  useContentAutosave,
  contentSaveData,
} from "@/features/content-review/useContentAutosave";
import {
  savedTime,
  sameContent,
} from "@/features/content-review/editor-snapshots";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { SectionCard } from "@/features/staff-ui/components";
import type { ProjectDetail } from "@/features/projects/service";
import {
  apiError,
  compactL10n,
  localizedPart,
  parseMembers,
  parseOutputLinks,
  splitIds,
} from "@/features/projects/ui/form-utils";

type StudioProjectFormProps = {
  mode: "create" | "edit";
  initial?: ProjectDetail;
  recoveryKey?: string;
};

const PROJECT_STATUSES = [
  "idea",
  "forming",
  "active",
  "completed",
  "showcased",
] as const;

function outputText(project: ProjectDetail | undefined): string {
  return (
    project?.outputLinks
      .map(
        (link) =>
          `${localizedPart(link.label, "vi")} | ${localizedPart(link.label, "en")} | ${link.url}`,
      )
      .join("\n") ?? ""
  );
}

function memberText(project: ProjectDetail | undefined): string {
  return (
    project?.members
      .map(({ userId, role }) => `${userId} | ${role}`)
      .join("\n") ?? ""
  );
}

export function StudioProjectForm({
  mode,
  initial,
  recoveryKey,
}: StudioProjectFormProps) {
  const t = useTranslations("studio.projects.form");
  const statusT = useTranslations("studio.projects.status");
  const sections = useTranslations("staffUi.studio.content.editor.sections");
  const locale = useLocale() === 'en' ? 'en' : 'vi';
  const registerStaffTitle = useStaffTitleRegistration();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  const formRef = useRef<HTMLFormElement>(null);
  const initialFields = {
    id: initial?.id ?? "",
    titleVi: localizedPart(initial?.title, "vi"),
    titleEn: localizedPart(initial?.title, "en"),
    summaryVi: localizedPart(initial?.summary, "vi"),
    summaryEn: localizedPart(initial?.summary, "en"),
    status: initial?.status ?? "idea",
    scope: initial?.branchScope.scope ?? "global",
    branchIds:
      initial?.branchScope.scope === "branches"
        ? initial.branchScope.branchIds.join(", ")
        : "",
    skills: initial?.skills.join(", ") ?? "",
    courseIds: initial?.courseIds.join(", ") ?? "",
    coverAssetId: initial?.coverAssetId ?? "",
    outputLinks: outputText(initial),
    members: memberText(initial),
  };
  const [fields, setFields] = useState(initialFields);
  const [persistedId, setPersistedId] = useState(initial?.id ?? null);
  const [workflowLocked, setWorkflowLocked] = useState(mode === "edit");
  const revision = useRef(initial?.updatedAt ?? null);
  const source = JSON.stringify(fields);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  function bodyOf(snapshot: string) {
    const field = JSON.parse(snapshot) as typeof initialFields;
    return {
      id: field.id.trim(),
      // One language is enough (DESIGN D11); empty locales are omitted.
      title: compactL10n({ vi: field.titleVi, en: field.titleEn }),
      summary: compactL10n({ vi: field.summaryVi, en: field.summaryEn }),
      status: field.status,
      approved: initial?.approved ?? false,
      branchScope:
        field.scope === "branches"
          ? { scope: "branches", branchIds: splitIds(field.branchIds) }
          : { scope: "global" },
      outputLinks: parseOutputLinks(field.outputLinks),
      skills: splitIds(field.skills),
      courseIds: splitIds(field.courseIds),
      coverAssetId: field.coverAssetId.trim() || null,
      members: parseMembers(field.members),
    };
  }
  const filled = (value: string) => value.trim().length > 0;
  const hasTitle = filled(fields.titleVi) || filled(fields.titleEn);
  const hasSummary = filled(fields.summaryVi) || filled(fields.summaryEn);
  const valid =
    /^[a-z0-9][a-z0-9-]{0,63}$/.test(fields.id) && hasTitle && hasSummary;
  // A locale is missing when the other locale has text this one lacks.
  const missing = {
    vi: (!filled(fields.titleVi) && filled(fields.titleEn)) || (!filled(fields.summaryVi) && filled(fields.summaryEn)),
    en: (!filled(fields.titleEn) && filled(fields.titleVi)) || (!filled(fields.summaryEn) && filled(fields.summaryVi)),
  };
  const saveState = useContentAutosave({
    navigationGuarded: true,
    value: source,
    initialValue: JSON.stringify(initialFields),
    valid,
    isNew: persistedId === null,
    enabled: !workflowLocked,
    storageKey: recoveryKey,
    onRestore: (snapshot) => {
      try {
        const restored = JSON.parse(snapshot) as typeof initialFields;
        if (
          !Object.keys(initialFields).every(
            (key) => typeof restored[key as keyof typeof restored] === "string",
          )
        )
          return;
        setFields(restored);
        if (formRef.current)
          for (const [key, value] of Object.entries(restored)) {
            const input = formRef.current.elements.namedItem(key);
            if (
              input instanceof HTMLInputElement ||
              input instanceof HTMLTextAreaElement ||
              input instanceof HTMLSelectElement
            )
              input.value = value;
          }
      } catch {
        setMessage(t("saveError"));
      }
    },
    persist: async (snapshot, signal) => {
      const body = bodyOf(snapshot),
        creating = persistedId === null;
      const saved = await contentSaveData<{ id: string; updatedAt: string }>(
        await fetch(
          creating
            ? "/api/v1/studio/projects"
            : `/api/v1/studio/projects/${encodeURIComponent(persistedId)}`,
          {
            method: creating ? "POST" : "PUT",
            headers: { "content-type": "application/json" },
            signal,
            body: JSON.stringify({
              ...body,
              ...(!creating ? { expectedUpdatedAt: revision.current } : {}),
            }),
          },
        ),
      );
      if (!saved.updatedAt) throw new Error("Missing save revision");
      revision.current = saved.updatedAt;
      setPersistedId(saved.id);
      return { revision: saved.updatedAt, savedAt: savedTime(saved.updatedAt) };
    },
    reconcile: async (snapshot, signal) => {
      const body = bodyOf(snapshot);
      const stored = await contentSaveData<ProjectDetail>(
        await fetch(`/api/v1/studio/projects/${encodeURIComponent(body.id)}`, {
          signal,
          cache: "no-store",
        }),
      );
      const comparable = {
        ...body,
        ...Object.fromEntries(
          Object.keys(body)
            .filter((key) => key !== "members")
            .map((key) => [key, stored[key as keyof ProjectDetail]]),
        ),
        members: stored.members
          .map(({ userId, role }) => ({ userId, role }))
          .sort((a, b) => a.userId.localeCompare(b.userId)),
      };
      // The service adds the owner membership on create; compare it explicitly.
      const members = body.members.some((member) => member.role === "owner")
        ? body.members
        : [...body.members, { userId: stored.ownerId, role: "owner" }];
      if (
        !sameContent(comparable, {
          ...body,
          members: members.sort((a, b) => a.userId.localeCompare(b.userId)),
        })
      )
        return null;
      revision.current = stored.updatedAt;
      setPersistedId(stored.id);
      return {
        revision: stored.updatedAt,
        savedAt: savedTime(stored.updatedAt),
      };
    },
  });
  const navigationGuard = useUnsavedChanges(saveState.dirty, saveState.flush);
  const staffTitle = (locale === 'vi' ? fields.titleVi : fields.titleEn) || (locale === 'vi' ? fields.titleEn : fields.titleVi) || (locale === 'vi' ? 'Dự án' : 'Project');
  useEffect(() => registerStaffTitle(staffTitle), [registerStaffTitle, staffTitle]);
  const navigated = useRef(false);
  useEffect(() => {
    if (
      mode === "create" &&
      persistedId &&
      !saveState.dirty &&
      saveState.status === "saved" &&
      !navigated.current
    ) {
      navigated.current = true;
      router.push(`/studio/projects/${encodeURIComponent(persistedId)}`);
    }
  }, [mode, persistedId, saveState.dirty, saveState.status, router]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveState.save();
  }

  async function remove() {
    if (
      !initial ||
      initial.approved ||
      pending ||
      workflowLocked ||
      !window.confirm(t("deleteConfirm"))
    )
      return;
    setPending(true);
    setMessage("");
    setFailed(false);
    try {
      const response = await fetch(
        `/api/v1/studio/projects/${encodeURIComponent(initial.id)}`,
        { method: "DELETE", headers: { "if-match": revision.current ?? "" } },
      );
      if (!response.ok)
        throw new Error(await apiError(response, t("deleteError")));
      router.push("/studio/projects");
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : t("deleteError"));
      setPending(false);
    }
  }

  const field = "flex min-w-0 flex-col gap-1.5";
  const label = "text-sm font-medium leading-normal";
  const hint = "text-xs leading-normal text-muted-foreground";

  return (
    <form
      ref={formRef}
      className="flex flex-col gap-6"
      onSubmit={submit}
      onChange={() => {
        if (!formRef.current) return;
        const data = new FormData(formRef.current);
        setFields(
          Object.fromEntries(
            Object.keys(initialFields).map((key) => [
              key,
              String(data.get(key) ?? ""),
            ]),
          ) as typeof initialFields,
        );
      }}
    >
      {/* The one save indicator for this editor, above every section. */}
      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <ContentSaveIndicator
          saveLabel={persistedId === null ? t("create") : undefined}
          state={saveState}
          valid={valid}
          disabled={workflowLocked}
        />
      </div>
      <fieldset disabled={workflowLocked} className="flex min-w-0 flex-col gap-6">
        <SectionCard title={sections("details")}>
          <div className={`${field} md:col-span-2`}>
            <label className={label} htmlFor={`${mode}-project-id`}>{t("id")}</label>
            <Input
              id={`${mode}-project-id`}
              name="id"
              defaultValue={initial?.id}
              readOnly={mode === "edit"}
              pattern="[a-z0-9][a-z0-9-]{0,63}"
              required
              aria-describedby={`${mode}-project-id-hint`}
            />
            <p id={`${mode}-project-id-hint`} className={hint}>{t("idHint")}</p>
          </div>
          {/* Either language satisfies a field; the other shows a pending translation hint. */}
          <div className={field}>
            <label className={label} htmlFor={`${mode}-title-vi`}>{t("titleVi")}</label>
            <Input id={`${mode}-title-vi`} name="titleVi" defaultValue={localizedPart(initial?.title, "vi")} required={!hasTitle} aria-describedby={missing.vi ? `${mode}-missing-vi` : undefined} />
            {missing.vi ? <p id={`${mode}-missing-vi`} className={hint}>{t("missingTranslation", { language: "vi" })}</p> : null}
          </div>
          <div className={field}>
            <label className={label} htmlFor={`${mode}-title-en`}>{t("titleEn")}</label>
            <Input id={`${mode}-title-en`} name="titleEn" defaultValue={localizedPart(initial?.title, "en")} required={!hasTitle} aria-describedby={missing.en ? `${mode}-missing-en` : undefined} />
            {missing.en ? <p id={`${mode}-missing-en`} className={hint}>{t("missingTranslation", { language: "en" })}</p> : null}
          </div>
          <div className={field}>
            <label className={label} htmlFor={`${mode}-summary-vi`}>{t("summaryVi")}</label>
            <Textarea id={`${mode}-summary-vi`} name="summaryVi" rows={4} defaultValue={localizedPart(initial?.summary, "vi")} required={!hasSummary} aria-describedby={missing.vi ? `${mode}-missing-vi` : undefined} />
          </div>
          <div className={field}>
            <label className={label} htmlFor={`${mode}-summary-en`}>{t("summaryEn")}</label>
            <Textarea id={`${mode}-summary-en`} name="summaryEn" rows={4} defaultValue={localizedPart(initial?.summary, "en")} required={!hasSummary} aria-describedby={missing.en ? `${mode}-missing-en` : undefined} />
          </div>
        </SectionCard>
        <SectionCard title={sections("statusAudience")}>
          <div className={field}>
            <label className={label} htmlFor={`${mode}-status`}>{t("status")}</label>
            <NativeSelect id={`${mode}-status`} name="status" defaultValue={initial?.status ?? "idea"} wrapperClassName="w-full">
              {PROJECT_STATUSES.map((status) => (
                <NativeSelectOption key={status} value={status}>{statusT(status)}</NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className={field}>
            <label className={label} htmlFor={`${mode}-scope`}>{t("scope")}</label>
            <NativeSelect id={`${mode}-scope`} name="scope" defaultValue={initial?.branchScope.scope ?? "global"} wrapperClassName="w-full">
              <NativeSelectOption value="global">{t("scopeGlobal")}</NativeSelectOption>
              <NativeSelectOption value="branches">{t("scopeBranches")}</NativeSelectOption>
            </NativeSelect>
          </div>
          <div className={field}>
            <label className={label} htmlFor={`${mode}-branch-ids`}>{t("branchIds")}</label>
            <Input
              id={`${mode}-branch-ids`}
              name="branchIds"
              defaultValue={initial?.branchScope.scope === "branches" ? initial.branchScope.branchIds.join(", ") : ""}
              placeholder={t("branchIdsHint")}
            />
          </div>
        </SectionCard>
        <SectionCard title={sections("team")}>
          <div className={field}>
            <label className={label} htmlFor={`${mode}-skills`}>{t("skills")}</label>
            <Input id={`${mode}-skills`} name="skills" defaultValue={initial?.skills.join(", ")} placeholder={t("skillsHint")} />
          </div>
          <div className={field}>
            <label className={label} htmlFor={`${mode}-courses`}>{t("courses")}</label>
            <Input id={`${mode}-courses`} name="courseIds" defaultValue={initial?.courseIds.join(", ")} placeholder={t("coursesHint")} />
          </div>
          <div className={`${field} md:col-span-2`}>
            <label className={label} htmlFor={`${mode}-cover`}>{t("cover")}</label>
            <Input id={`${mode}-cover`} name="coverAssetId" defaultValue={initial?.coverAssetId ?? ""} placeholder={t("coverHint")} />
          </div>
          <div className={`${field} md:col-span-2`}>
            <label className={label} htmlFor={`${mode}-outputs`}>{t("outputs")}</label>
            <Textarea id={`${mode}-outputs`} name="outputLinks" rows={4} defaultValue={outputText(initial)} aria-describedby={`${mode}-outputs-hint`} />
            <p id={`${mode}-outputs-hint`} className={hint}>{t("outputsHint")}</p>
          </div>
          <div className={`${field} md:col-span-2`}>
            <label className={label} htmlFor={`${mode}-members`}>{t("members")}</label>
            <Textarea id={`${mode}-members`} name="members" rows={4} defaultValue={memberText(initial)} aria-describedby={`${mode}-members-hint`} />
            <p id={`${mode}-members-hint`} className={hint}>{t("membersHint")}</p>
          </div>
        </SectionCard>
      </fieldset>
      {persistedId ? (
        <ContentWorkflowPanel
          contentType="project"
          contentId={persistedId}
          beforeSubmit={saveState.flush}
          getExpectedRevision={() => revision.current}
          onLockChange={setWorkflowLocked}
          refreshKey={saveState.revision ?? undefined}
          className="rounded-lg border border-border bg-card p-6"
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {mode === "edit" && !initial?.approved ? (
          <Button
            variant="destructive"
            disabled={pending || workflowLocked || saveState.status === "saving"}
            onClick={remove}
          >
            {t("delete")}
          </Button>
        ) : null}
        <p role="status" aria-live="polite" className={failed ? "text-sm leading-normal text-destructive" : "text-sm leading-normal text-muted-foreground"}>
          {message}
        </p>
      </div>
      {navigationGuard.dialog}
    </form>
  );
}
