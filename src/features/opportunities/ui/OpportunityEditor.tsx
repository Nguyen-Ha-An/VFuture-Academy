"use client";

import { useEffect, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import type { z } from "zod";

import { ImportTextRecovery } from "@/features/content-review/ImportTextRecovery";
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
  opportunityFormFromRow,
} from "@/features/content-review/editor-snapshots";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { SectionCard } from "@/features/staff-ui/components";
import {
  OPPORTUNITY_TYPES,
  OpportunityFormSchema,
  type OpportunityForm,
} from "@/features/opportunities/schema";

function csv(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function localizedMap(value: OpportunityForm["title"]): {
  vi: string;
  en: string;
} {
  if (typeof value === "string") return { vi: value, en: value };
  return { vi: value.vi ?? "", en: value.en ?? "" };
}

export function isoToUtcDateTimeInput(value: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toISOString().slice(0, 23)
    : "";
}

export function utcDateTimeInputToIso(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(`${value}Z`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

export function OpportunityEditor({
  initialValue,
  recoveryKey,
  initialStatus = "draft",
  initialUpdatedAt = null,
  isNew = false,
}: {
  initialValue: OpportunityForm;
  canPublish: boolean;
  initialStatus?: "draft" | "published" | "archived";
  initialUpdatedAt?: string | null;
  isNew?: boolean;
  recoveryKey?: string;
}) {
  const t = useTranslations("studio.opportunities.editor");
  const sections = useTranslations("staffUi.studio.content.editor.sections");
  const locale = useLocale() === 'en' ? 'en' : 'vi';
  const registerStaffTitle = useStaffTitleRegistration();
  const router = useRouter();
  const [jsonText, setJsonText] = useState(() =>
    JSON.stringify(initialValue, null, 2),
  );
  const jsonTextRef = useRef(jsonText); jsonTextRef.current = jsonText;
  const [appliedJson, setAppliedJson] = useState(() => JSON.stringify(initialValue, null, 2));
  const [status, setStatus] = useState(t("ready"));
  const [recordStatus, setRecordStatus] = useState(initialStatus);
  const updatedAt = useRef(initialUpdatedAt);
  const [workflowLocked, setWorkflowLocked] = useState(!isNew);
  const [persistedId, setPersistedId] = useState<string | null>(
    isNew ? null : initialValue.id,
  );
  type OpportunityFormInput = z.input<typeof OpportunityFormSchema>;
  const form = useForm<OpportunityFormInput, unknown, OpportunityForm>({
    resolver: zodResolver(OpportunityFormSchema),
    defaultValues: initialValue,
  });
  const internal = form.watch("internalApplication");
  const branchScope = form.watch("branchScope");

  function importJson() {
    try {
      const parsed = OpportunityFormSchema.safeParse(JSON.parse(jsonText));
      if (!parsed.success) {
        setStatus(
          parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; "),
        );
        return;
      }
      if (persistedId && parsed.data.id !== persistedId) {
        setStatus(t("identityMismatch"));
        return;
      }
      form.reset(parsed.data);
      setAppliedJson(jsonText);
      setStatus(t("imported"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("invalidJson"));
    }
  }

  const values = useWatch({ control: form.control });
  const source = JSON.stringify(values);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const parsed = OpportunityFormSchema.safeParse(values);
  const valid =
    parsed.success && (persistedId === null || parsed.data.id === persistedId);
  const saveState = useContentAutosave({
    navigationGuarded: true,
    value: source,
    initialValue: JSON.stringify(initialValue),
    valid,
    isNew: persistedId === null,
    enabled: !workflowLocked && recordStatus !== "archived",
    storageKey: recoveryKey,
    onRestore: (value) => {
      try {
        form.reset(JSON.parse(value));
      } catch {
        setStatus(t("invalidJson"));
      }
    },
    persist: async (snapshot, signal) => {
      const value = OpportunityFormSchema.parse(JSON.parse(snapshot));
      const creating = persistedId === null;
      const row = await contentSaveData<Record<string, unknown>>(
        await fetch(
          creating
            ? "/api/v1/studio/opportunities"
            : `/api/v1/studio/opportunities/${encodeURIComponent(persistedId)}`,
          {
            method: creating ? "POST" : "PUT",
            headers: { "content-type": "application/json" },
            signal,
            body: JSON.stringify({
              document: value,
              ...(updatedAt.current
                ? { expectedUpdatedAt: updatedAt.current }
                : {}),
            }),
          },
        ),
      );
      if (typeof row.updated_at !== "string")
        throw new Error("Missing save revision");
      updatedAt.current = row.updated_at;
      setPersistedId(value.id);
      if (row.status === "draft") setRecordStatus("draft");
      if (sourceRef.current === snapshot && jsonText === appliedJson && jsonTextRef.current === jsonText) {
        const json = JSON.stringify(value, null, 2); setJsonText(json); setAppliedJson(json);
      }
      return { revision: row.updated_at, savedAt: savedTime(row.updated_at) };
    },
    reconcile: async (snapshot, signal) => {
      const value = OpportunityFormSchema.parse(JSON.parse(snapshot));
      const row = await contentSaveData<Record<string, unknown>>(
        await fetch(
          `/api/v1/studio/opportunities/${encodeURIComponent(value.id)}`,
          { signal, cache: "no-store" },
        ),
      );
      if (
        !sameContent(opportunityFormFromRow(row), value) ||
        typeof row.updated_at !== "string"
      )
        return null;
      updatedAt.current = row.updated_at;
      setPersistedId(value.id);
      return { revision: row.updated_at, savedAt: savedTime(row.updated_at) };
    },
  });
  const navigationGuard = useUnsavedChanges(saveState.dirty, saveState.flush);
  const navigated = useRef(false);
  useEffect(() => {
    if (
      isNew &&
      persistedId &&
      !saveState.dirty &&
      saveState.status === "saved" &&
      !navigated.current
    ) {
      navigated.current = true;
      router.replace(
        `/studio/opportunities/${encodeURIComponent(persistedId)}`,
      );
    }
  }, [isNew, persistedId, saveState.dirty, saveState.status, router]);
  const submit = form.handleSubmit(async () => {
    await saveState.save();
  });

  const fieldError = (name: keyof OpportunityFormInput) =>
    form.formState.errors[name]?.message;
  const localizedTitle = localizedMap(values.title ?? "")[locale] || localizedMap(values.title ?? "")[locale === 'vi' ? 'en' : 'vi'] || (locale === 'vi' ? 'Cơ hội' : 'Opportunity');
  useEffect(() => registerStaffTitle(localizedTitle), [localizedTitle, registerStaffTitle]);

  const fieldLabel = "flex min-w-0 flex-col gap-1.5 text-sm font-medium leading-normal";
  const idsField = (name: "recommendedSkills" | "recommendedCourses" | "requiredCourses") => (
    <Controller
      name={name}
      control={form.control}
      render={({ field }) => (
        <label className={fieldLabel}>
          {t(name)}
          <Input value={field.value.join(", ")} onChange={(event) => field.onChange(csv(event.target.value))} />
        </label>
      )}
    />
  );
  const jsonField = (name: "description" | "eligibility") => (
    <label className={fieldLabel}>
      {t(name)}
      <Textarea
        className="min-h-32 font-mono text-xs"
        defaultValue={JSON.stringify(initialValue[name], null, 2)}
        {...form.register(name, {
          setValueAs: (value) => {
            try {
              return JSON.parse(value);
            } catch {
              return value;
            }
          },
        })}
      />
    </label>
  );

  return (
    <div className="flex flex-col gap-6">
      {/* The one save indicator for this editor, above every section. */}
      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <ContentSaveIndicator state={saveState} valid={valid} disabled={workflowLocked} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.7fr)]">
        <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-6" aria-describedby="opportunity-form-status">
          <fieldset disabled={workflowLocked} className="flex min-w-0 flex-col gap-6">
            <SectionCard title={sections("details")}>
              <label className={fieldLabel}>
                {t("id")}
                <Input {...form.register("id")} readOnly={persistedId !== null} aria-invalid={!!fieldError("id")} />
              </label>
              <label className={fieldLabel}>
                {t("organization")}
                <Input {...form.register("organization")} aria-invalid={!!fieldError("organization")} />
              </label>
              <label className={fieldLabel}>
                {t("type")}
                <NativeSelect {...form.register("type")} wrapperClassName="w-full">
                  {OPPORTUNITY_TYPES.map((type) => (
                    <NativeSelectOption value={type} key={type}>
                      {t(`types.${type}`)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              <Controller
                name="title"
                control={form.control}
                render={({ field }) => {
                  const titles = localizedMap(field.value);
                  return (
                    <>
                      <label className={fieldLabel}>
                        {t("titleVi")}
                        <Input value={titles.vi} onChange={(event) => field.onChange({ ...titles, vi: event.target.value })} />
                      </label>
                      <label className={fieldLabel}>
                        {t("titleEn")}
                        <Input value={titles.en} onChange={(event) => field.onChange({ ...titles, en: event.target.value })} />
                      </label>
                    </>
                  );
                }}
              />
              <label className={fieldLabel}>
                {t("applicationUrl")}
                <Input type="url" disabled={internal} {...form.register("applicationUrl", { setValueAs: (value) => value || null })} />
              </label>
              <label className={fieldLabel}>
                {t("location")}
                <Input {...form.register("location", { setValueAs: (value) => value || null })} />
              </label>
            </SectionCard>
            <SectionCard title={sections("schedule")} description={t("timezoneUtc")}>
              {(["openAt", "closeAt", "startAt", "endAt"] as const).map((name) => (
                <Controller
                  key={name}
                  name={name}
                  control={form.control}
                  render={({ field }) => (
                    <label className={fieldLabel}>
                      {t(name)}
                      <Input
                        type="datetime-local"
                        step="0.001"
                        className="tabular-nums"
                        value={isoToUtcDateTimeInput(field.value ?? null)}
                        onChange={(event) => field.onChange(utcDateTimeInputToIso(event.target.value))}
                        aria-invalid={!!fieldError(name)}
                      />
                    </label>
                  )}
                />
              ))}
            </SectionCard>
            <SectionCard title={sections("audience")}>
              {idsField("recommendedSkills")}
              {idsField("recommendedCourses")}
              {idsField("requiredCourses")}
              <label className={fieldLabel}>
                {t("scope")}
                <NativeSelect
                  wrapperClassName="w-full"
                  value={branchScope.scope}
                  onChange={(event) =>
                    form.setValue(
                      "branchScope",
                      event.target.value === "global" ? { scope: "global" } : { scope: "branches", branchIds: ["branch-id"] },
                    )
                  }
                >
                  <NativeSelectOption value="global">{t("global")}</NativeSelectOption>
                  <NativeSelectOption value="branches">{t("branches")}</NativeSelectOption>
                </NativeSelect>
              </label>
              {branchScope.scope === "branches" ? (
                <Controller
                  name="branchScope"
                  control={form.control}
                  render={({ field }) => (
                    <label className={fieldLabel}>
                      {t("branchIds")}
                      <Input
                        value={field.value.scope === "branches" ? field.value.branchIds.join(", ") : ""}
                        onChange={(event) => field.onChange({ scope: "branches", branchIds: csv(event.target.value) })}
                      />
                    </label>
                  )}
                />
              ) : null}
            </SectionCard>
            <SectionCard title={sections("content")} columns={1}>
              {jsonField("description")}
              {jsonField("eligibility")}
            </SectionCard>
            <SectionCard title={t("options")} contentClassName="flex flex-wrap gap-x-6 gap-y-3">
              {(["internalApplication", "online", "featured"] as const).map((name) => (
                <label key={name} className="flex min-h-10 items-center gap-2 text-sm leading-normal">
                  <Checkbox {...form.register(name)} />
                  {t(name)}
                </label>
              ))}
            </SectionCard>
          </fieldset>
          {Object.keys(form.formState.errors).length > 0 ? (
            <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm leading-normal text-destructive-soft-foreground">
              {t("validationError")}
            </div>
          ) : null}
          <p id="opportunity-form-status" role="status" aria-live="polite" className="text-sm leading-normal text-muted-foreground">
            {status}
          </p>
        </form>
        <div className="flex min-w-0 flex-col gap-6">
          {persistedId ? (
            <ContentWorkflowPanel
              contentType="opportunity"
              contentId={persistedId}
              beforeSubmit={saveState.flush}
              getExpectedRevision={() => updatedAt.current}
              onLockChange={setWorkflowLocked}
              refreshKey={saveState.revision ?? undefined}
              className="rounded-lg border border-border bg-card p-6"
            />
          ) : null}
          <SectionCard
            title={t("jsonTitle")}
            columns={1}
            footer={
              <Button type="button" variant="outline" disabled={workflowLocked} onClick={importJson}>
                {t("import")}
              </Button>
            }
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor="opportunity-json" className="text-sm font-medium leading-normal">
                {t("jsonLabel")}
              </label>
              <Textarea
                id="opportunity-json"
                disabled={workflowLocked}
                className="min-h-[30rem] font-mono text-xs"
                value={jsonText}
                onChange={(event) => setJsonText(event.target.value)}
                spellCheck={false}
              />
            </div>
            <ImportTextRecovery value={jsonText} appliedValue={appliedJson} storageKey={recoveryKey ? `${recoveryKey}:import` : undefined} onRestore={setJsonText} disabled={workflowLocked} />
          </SectionCard>
        </div>
      </div>
      {navigationGuard.dialog}
    </div>
  );
}
