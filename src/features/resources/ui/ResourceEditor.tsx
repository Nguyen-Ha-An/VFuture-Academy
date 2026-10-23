"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { SectionCard } from "@/features/staff-ui/components";
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
import { parseJsonDocument } from "@/content-engine/validate/parse";
import { itemRef } from "@/content-engine/diagnostics";
import { ResourceDocumentSchema } from "@/content-engine/schema/bundle";
import {
  RESOURCE_TYPES,
  type ResourceDocument,
} from "@/content-engine/schema/bundle";
import { PATHWAYS } from "@/content-engine/schema/course";
import { StaticRichContent } from "@/features/ecosystem/ui/StaticRichContent";
import type {
  StudioResourceRecord,
  StudioResourceStatus,
} from "@/features/resources/service";

type ApiIssue = { path?: Array<string | number>; message?: string };
type Envelope = {
  data?: StudioResourceRecord | { document: ResourceDocument };
  error?: { message?: string; issues?: ApiIssue[] };
};
const csv = (value: string) => [
  ...new Set(
    value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  ),
];
const l10n = (value: unknown, locale: "vi" | "en") =>
  typeof value === "string"
    ? value
    : value && typeof value === "object"
      ? String((value as Record<string, unknown>)[locale] ?? "")
      : "";

export function ResourceEditor({
  initialDocument,
  initialRecord,
  initialStatus = "draft",
  isNew = false,
  recoveryKey,
}: {
  initialDocument?: ResourceDocument;
  initialRecord?: StudioResourceRecord;
  initialStatus?: StudioResourceStatus;
  canPublish: boolean;
  isNew?: boolean;
  recoveryKey?: string;
}) {
  const router = useRouter();
  const t = useTranslations("studio.resources.editor");
  const sections = useTranslations("staffUi.studio.content.editor.sections");
  const locale = useLocale() === 'en' ? 'en' : 'vi';
  const registerStaffTitle = useStaffTitleRegistration();
  const initial = initialRecord?.document ?? initialDocument!;
  const fixedId = initial.id;
  const [text, setText] = useState(JSON.stringify(initial, null, 2));
  const [preview, setPreview] = useState<ResourceDocument | null>(initial);
  const [resourceStatus, setResourceStatus] = useState<StudioResourceStatus>(
    initialRecord?.status ?? initialStatus,
  );
  const updatedAt = useRef(initialRecord?.updatedAt ?? "");
  const [persistedId, setPersistedId] = useState<string | null>(
    isNew ? null : fixedId,
  );
  const [workflowLocked, setWorkflowLocked] = useState(!isNew);
  const currentText = useRef(text);
  currentText.current = text;
  const [issues, setIssues] = useState<ApiIssue[]>([]);
  const [message, setMessage] = useState(t("ready"));
  const [pending, setPending] = useState(false);
  const raw = useMemo(() => {
    try {
      const value = JSON.parse(text);
      return typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }, [text]);
  const doc = raw as ResourceDocument | null;
  const scope = doc?.branchScope ?? { scope: "global" as const };

  const patch = (change: (value: Record<string, unknown>) => void) => {
    if (!raw) return;
    const next = structuredClone(raw);
    change(next);
    setText(JSON.stringify(next, null, 2));
  };
  const patchL10n = (
    key: "title" | "summary",
    locale: "vi" | "en",
    value: string,
  ) =>
    patch((next) => {
      const current = next[key];
      next[key] = {
        ...(current && typeof current === "object" ? (current as object) : {}),
        [locale]: value,
      };
    });

  async function serverDocument(): Promise<ResourceDocument | null> {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (error) {
      setIssues([
        { message: error instanceof Error ? error.message : t("invalidJson") },
      ]);
      setMessage(t("invalid"));
      return null;
    }
    const requestId =
      isNew &&
      typeof value === "object" &&
      value &&
      "id" in value &&
      typeof value.id === "string"
        ? value.id
        : fixedId;
    if (
      !isNew &&
      typeof value === "object" &&
      value &&
      "id" in value &&
      value.id !== fixedId
    ) {
      setIssues([{ path: ["id"], message: t("idMismatch") }]);
      setMessage(t("invalid"));
      return null;
    }
    const response = await fetch(
      `/api/v1/studio/resources/${encodeURIComponent(requestId)}/validate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ document: value }),
      },
    );
    const body = (await response.json()) as Envelope;
    const validated =
      body.data && "document" in body.data ? body.data.document : undefined;
    if (!response.ok || !validated) {
      setIssues(
        body.error?.issues ?? [
          { message: body.error?.message ?? t("invalid") },
        ],
      );
      setMessage(t("invalid"));
      return null;
    }
    setIssues([]);
    return validated;
  }

  async function previewCurrent() {
    setPending(true);
    setMessage(t("validating"));
    try {
      const validated = await serverDocument();
      if (validated) {
        setPreview(validated);
        setMessage(t("valid"));
      }
    } catch {
      setMessage(t("invalid"));
    } finally {
      setPending(false);
    }
  }

  const sourceErrors = useMemo(
    () => parseJsonDocument(text, itemRef(fixedId)).errors,
    [text, fixedId],
  );
  const valid =
    sourceErrors.length === 0 &&
    ResourceDocumentSchema.safeParse(raw).success &&
    (persistedId === null || doc?.id === persistedId);
  const saveState = useContentAutosave({
    navigationGuarded: true,
    value: text,
    initialValue: JSON.stringify(initial, null, 2),
    valid,
    isNew: persistedId === null,
    enabled: !workflowLocked && resourceStatus !== "archived",
    storageKey: recoveryKey,
    onRestore: setText,
    persist: async (source, signal) => {
      const document = ResourceDocumentSchema.parse(JSON.parse(source));
      const creating = persistedId === null;
      const saved = await contentSaveData<StudioResourceRecord>(
        await fetch(
          creating
            ? "/api/v1/studio/resources"
            : `/api/v1/studio/resources/${encodeURIComponent(persistedId)}`,
          {
            method: creating ? "POST" : "PUT",
            headers: { "content-type": "application/json" },
            signal,
            body: JSON.stringify({
              document,
              ...(creating ? {} : { expectedUpdatedAt: updatedAt.current }),
            }),
          },
        ),
      );
      if (typeof saved.updatedAt !== "string" || !saved.document)
        throw new Error("Missing save acknowledgment");
      updatedAt.current = saved.updatedAt;
      setPersistedId(saved.id);
      setResourceStatus(saved.status);
      setIssues([]);
      // Preview updates independently; never replace text typed during the save.
      setPreview(saved.document);
      return { revision: saved.updatedAt, savedAt: savedTime(saved.updatedAt) };
    },
    reconcile: async (source, signal) => {
      const document = ResourceDocumentSchema.parse(JSON.parse(source));
      const stored = await contentSaveData<StudioResourceRecord>(
        await fetch(
          `/api/v1/studio/resources/${encodeURIComponent(document.id)}`,
          { signal, cache: "no-store" },
        ),
      );
      if (!sameContent(stored.document, document)) return null;
      updatedAt.current = stored.updatedAt;
      setPersistedId(stored.id);
      setResourceStatus(stored.status);
      return {
        revision: stored.updatedAt,
        savedAt: savedTime(stored.updatedAt),
      };
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
      router.replace(`/studio/resources/${encodeURIComponent(persistedId)}`);
    }
  }, [isNew, persistedId, saveState.dirty, saveState.status, router]);
  const disabled = workflowLocked || !doc;
  const attachments = doc?.attachments ?? [];
  const staffTitle = l10n(doc?.title, locale) || l10n(doc?.title, locale === 'vi' ? 'en' : 'vi') || (locale === 'vi' ? 'Tài nguyên' : 'Resource');
  useEffect(() => registerStaffTitle(staffTitle), [registerStaffTitle, staffTitle]);
  const previewBody = preview
    ? "blocks" in preview.body
      ? preview.body
      : (preview.body.en ??
        preview.body[preview.defaultLanguage ?? "vi"] ??
        preview.body.vi ??
        null)
    : null;
  const fieldLabel = "flex min-w-0 flex-col gap-1.5 text-sm font-medium leading-normal";
  return (
    <div className="flex flex-col gap-6">
      {/* The one save indicator for this editor, above every section. */}
      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <ContentSaveIndicator
          state={saveState}
          valid={valid}
          disabled={workflowLocked}
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
        <section className="flex min-w-0 flex-col gap-6" aria-label={t("metadataTitle")}>
          {!doc ? (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm leading-normal text-destructive-soft-foreground">
              {t("fixJson")}
            </p>
          ) : null}
          <SectionCard title={sections("details")}>
            {(["vi", "en"] as const).flatMap((language) => [
              <label key={`title-${language}`} className={fieldLabel}>
                {t("title", { language: language.toUpperCase() })}
                <Input
                  disabled={disabled}
                  value={l10n(doc?.title, language)}
                  onChange={(event) =>
                    patchL10n("title", language, event.target.value)
                  }
                />
              </label>,
              <label key={`summary-${language}`} className={fieldLabel}>
                {t("summary", { language: language.toUpperCase() })}
                <Textarea
                  disabled={disabled}
                  value={l10n(doc?.summary, language)}
                  onChange={(event) =>
                    patchL10n("summary", language, event.target.value)
                  }
                />
              </label>,
            ])}
            <label className={fieldLabel}>
              {t("type")}
              <NativeSelect
                wrapperClassName="w-full"
                disabled={disabled}
                value={doc?.resourceType ?? "guide"}
                onChange={(event) =>
                  patch((next) => {
                    next.resourceType = event.target.value;
                  })
                }
              >
                {RESOURCE_TYPES.map((value) => (
                  <NativeSelectOption key={value}>{value}</NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          </SectionCard>
          <SectionCard title={sections("audience")}>
            {(["tags", "skills"] as const).map((key) => (
              <label key={key} className={fieldLabel}>
                {t(key)}
                <Input
                  disabled={disabled}
                  value={(doc?.[key] ?? []).join(", ")}
                  onChange={(event) =>
                    patch((next) => {
                      next[key] = csv(event.target.value);
                    })
                  }
                />
              </label>
            ))}
            <label className={fieldLabel}>
              {t("pathways")}
              <select
                multiple
                disabled={disabled}
                value={doc?.pathways ?? []}
                onChange={(event) =>
                  patch((next) => {
                    next.pathways = [...event.target.selectedOptions].map(
                      (option) => option.value,
                    );
                  })
                }
                className="min-h-28 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-normal outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                {PATHWAYS.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          </SectionCard>
          <SectionCard title={sections("statusAudience")}>
            <label className={fieldLabel}>
              {t("scope")}
              <NativeSelect
                wrapperClassName="w-full"
                disabled={disabled}
                value={scope.scope}
                onChange={(event) =>
                  patch((next) => {
                    next.branchScope =
                      event.target.value === "global"
                        ? { scope: "global" }
                        : { scope: "branches", branchIds: [] };
                  })
                }
              >
                <NativeSelectOption value="global">{t("global")}</NativeSelectOption>
                <NativeSelectOption value="branches">{t("branches")}</NativeSelectOption>
              </NativeSelect>
            </label>
            {scope.scope === "branches" ? (
              <label className={fieldLabel}>
                {t("branchIds")}
                <Input
                  disabled={disabled}
                  value={scope.branchIds.join(", ")}
                  onChange={(event) =>
                    patch((next) => {
                      next.branchScope = {
                        scope: "branches",
                        branchIds: csv(event.target.value),
                      };
                    })
                  }
                />
              </label>
            ) : null}
          </SectionCard>
          <SectionCard
            title={t("attachments")}
            columns={1}
            footer={
              <Button
                variant="outline"
                disabled={disabled || attachments.length >= 20}
                onClick={() =>
                  patch((next) => {
                    next.attachments = [
                      ...((next.attachments as unknown[]) ?? []),
                      {
                        src: { assetId: "asset-id" },
                        label: { vi: "Tệp", en: "File" },
                      },
                    ];
                  })
                }
              >
                {t("addAttachment")}
              </Button>
            }
          >
            {attachments.map((attachment, index) => {
              const asset = "assetId" in attachment.src;
              const sourceValue =
                "assetId" in attachment.src
                  ? attachment.src.assetId
                  : attachment.src.url;
              return (
                <fieldset
                  key={index}
                  className="grid gap-4 rounded-md border border-border p-4 sm:grid-cols-2"
                >
                  <legend className="px-1 text-sm font-medium leading-normal">
                    {t("attachment", { number: index + 1 })}
                  </legend>
                  <label className={fieldLabel}>
                    {asset ? t("assetId") : "URL"}
                    <Input
                      disabled={disabled}
                      value={sourceValue}
                      onChange={(event) =>
                        patch((next) => {
                          const list = [
                            ...((next.attachments as Array<
                              Record<string, unknown>
                            >) ?? []),
                          ];
                          list[index] = {
                            ...list[index],
                            src: asset
                              ? { assetId: event.target.value }
                              : { url: event.target.value },
                          };
                          next.attachments = list;
                        })
                      }
                    />
                  </label>
                  {(["vi", "en"] as const).map((language) => (
                    <label key={language} className={fieldLabel}>
                      {t("attachmentLabel", { language: language.toUpperCase() })}
                      <Input
                        disabled={disabled}
                        value={l10n(attachment.label, language)}
                        onChange={(event) =>
                          patch((next) => {
                            const list = [
                              ...((next.attachments as Array<
                                Record<string, unknown>
                              >) ?? []),
                            ];
                            const label = list[index]?.label;
                            list[index] = {
                              ...list[index],
                              label: {
                                ...(label && typeof label === "object"
                                  ? (label as object)
                                  : {}),
                                [language]: event.target.value,
                              },
                            };
                            next.attachments = list;
                          })
                        }
                      />
                    </label>
                  ))}
                  <div className="flex items-end">
                    <Button
                      variant="outline"
                      disabled={disabled}
                      onClick={() =>
                        patch((next) => {
                          next.attachments = (
                            (next.attachments as unknown[]) ?? []
                          ).filter((_, i) => i !== index);
                        })
                      }
                    >
                      {t("removeAttachment")}
                    </Button>
                  </div>
                </fieldset>
              );
            })}
          </SectionCard>
          <SectionCard
            title={t("advanced")}
            columns={1}
            footer={
              <Button variant="outline" disabled={pending} onClick={() => void previewCurrent()}>
                {t("preview")}
              </Button>
            }
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor="resource-json" className="text-sm font-medium leading-normal">
                {t("jsonLabel")}
              </label>
              <Textarea
                id="resource-json"
                className="min-h-[28rem] font-mono text-xs"
                value={text}
                disabled={workflowLocked}
                spellCheck={false}
                onChange={(event) => setText(event.target.value)}
              />
            </div>
            {sourceErrors.length ? (
              <ul role="alert" className="flex flex-col gap-1 text-sm leading-normal text-destructive-soft-foreground">
                {sourceErrors.map((issue, index) => (
                  <li key={index}>{issue.message[locale]}</li>
                ))}
              </ul>
            ) : null}
          </SectionCard>
          <div role="status" aria-live="polite" className="text-sm leading-normal text-muted-foreground">
            {message}
          </div>
          {issues.length ? (
            <ul className="flex flex-col gap-1 text-sm leading-normal text-destructive-soft-foreground">
              {issues.map((issue, index) => (
                <li key={index}>
                  {issue.path?.join(".")} {issue.message}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
        <div className="flex min-w-0 flex-col gap-6">
          {persistedId ? (
            <ContentWorkflowPanel
              contentType="resource"
              contentId={persistedId}
              beforeSubmit={saveState.flush}
              getExpectedRevision={() => updatedAt.current}
              onLockChange={setWorkflowLocked}
              refreshKey={saveState.revision ?? undefined}
              className="rounded-lg border border-border bg-card p-6"
            />
          ) : null}
          <aside aria-label={t("previewTitle")} className="rounded-lg border border-border bg-card p-6">
            {previewBody ? (
              <StaticRichContent content={previewBody} />
            ) : (
              <p className="text-sm leading-normal text-muted-foreground">{t("previewEmpty")}</p>
            )}
          </aside>
        </div>
      </div>
      {navigationGuard.dialog}
    </div>
  );
}
