"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { json } from "@codemirror/lang-json";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useLocale, useTranslations } from "next-intl";
import type { CompiledItem, GradingQuestion } from "@/content-engine/compile";
import type { Locale } from "@/content-engine/schema/common";
import {
  createPreviewRuntime,
  QuestionRenderer,
  registerAll,
  type LearnerQuestion,
} from "@/content-engine/render";
import { mediaHref } from "@/features/media/urls";
import { itemRef } from "@/content-engine/diagnostics";
import { parseJsonDocument } from "@/content-engine/validate/parse";
import { ContentSaveIndicator } from "@/features/content-review/ContentSaveIndicator";
import { ContentWorkflowPanel } from "@/features/content-review/ContentWorkflowPanel";
import { sameContent } from "@/features/content-review/editor-snapshots";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { DataCard } from "@/features/staff-ui/components";
import {
  contentSaveData,
  useContentAutosave,
} from "@/features/content-review/useContentAutosave";
import { useStaffTitleRegistration } from "@/features/workspace/ui/StaffTitleContext";
import { useUnsavedChanges } from './useUnsavedChanges';
registerAll();
type ApiIssue = { path?: Array<string | number>; message?: string };
export type BankQuestionDetail = {
  id: string;
  status: string;
  currentVersionId: string | null;
  languages: Locale[];
  latestVersion: {
    id: string;
    version: number;
    payload: unknown;
    renders: Partial<Record<Locale, unknown>>;
    grading: unknown;
  };
};
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function titleFor(value: unknown, locale: Locale): string {
  const node = record(value);
  if (!node) return '';
  const candidate = node.title ?? record(node.content)?.title ?? record(node.content)?.prompt;
  if (typeof candidate === 'string') return candidate;
  const localized = record(candidate);
  return typeof localized?.[locale] === 'string' ? localized[locale] as string : typeof localized?.vi === 'string' ? localized.vi as string : typeof localized?.en === 'string' ? localized.en as string : '';
}
function runtimeFor(detail: BankQuestionDetail, locale: Locale) {
  const rawGrading = record(detail.latestVersion.grading);
  if (!rawGrading) return null;
  const grading = detail.latestVersion.grading as GradingQuestion;
  const gradingId =
    typeof rawGrading.id === "string" && rawGrading.id.length > 0
      ? rawGrading.id
      : detail.id;
  const item: CompiledItem = {
    id: detail.id,
    kind: "lesson",
    checksum: "bank-preview",
    renders: {
      vi: { id: detail.id, kind: "lesson", title: detail.id },
      en: { id: detail.id, kind: "lesson", title: detail.id },
    },
    grading: {
      questions: { [gradingId]: grading },
      quizzes: {
        preview: {
          mode: "practice",
          attemptsAllowed: 0,
          feedback: "per_question",
          showExplanations: true,
          shuffleQuestions: false,
          required: true,
          questionIds: [gradingId],
        },
      },
      rubrics: {},
      activities: [],
    },
  };
  const runtime = createPreviewRuntime(
    item,
    locale,
    detail.languages[0] ?? locale,
  );
  runtime.resolveMedia = (ref) =>
    "assetId" in ref ? mediaHref(ref.assetId) : ref.url;
  return runtime;
}
export function BankQuestionEditor({
  initialDetail,
  recoveryKey,
  canPublish: _canPublish,
}: {
  initialDetail: BankQuestionDetail;
  recoveryKey?: string;
  canPublish?: boolean;
}) {
  const t = useTranslations("studio.bank.detail");
  const review = useTranslations("studioReview.bank");
  const interfaceLocale = useLocale() === 'en' ? 'en' : 'vi';
  const registerStaffTitle = useStaffTitleRegistration();
  const initialSource = useRef(
    JSON.stringify(initialDetail.latestVersion.payload, null, 2),
  ).current;
  const [detail, setDetail] = useState(initialDetail);
  const [text, setText] = useState(initialSource);
  const [locale, setLocale] = useState<Locale>(
    initialDetail.languages[0] ?? "vi",
  );
  const [answer, setAnswer] = useState<unknown>();
  const [diagnostics, setDiagnostics] = useState<ApiIssue[]>([]);
  const [activity, setActivity] = useState<string>(t("ready"));
  const [workflowLocked, setWorkflowLocked] = useState(true);
  const savedRevision = useRef(initialDetail.latestVersion.id);
  const textRef = useRef(text);
  const validationGeneration = useRef(0);
  const settledActivity = useRef(t("ready"));
  const validDocument = useMemo(
    () => parseJsonDocument(text, itemRef(detail.id)).errors.length === 0,
    [detail.id, text],
  );
  const autosave = useContentAutosave({
    navigationGuarded: true,
    value: text,
    initialValue: initialSource,
    initialRevision: initialDetail.latestVersion.id,
    valid: validDocument && diagnostics.length === 0,
    enabled: !workflowLocked,
    storageKey: recoveryKey,
    onRestore: (source) => {
      textRef.current = source;
      setText(source);
    },
    persist: async (source, signal) => {
      const response = await fetch(
        `/api/v1/studio/bank/${encodeURIComponent(detail.id)}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "if-match": savedRevision.current,
          },
          body: source,
          signal,
        },
      );
      const saved = await contentSaveData<Record<string, unknown>>(response);
      if (typeof saved.versionId !== "string" || !saved.versionId)
        throw new Error("Missing bank save revision");
      const acknowledgedVersion = saved.versionId;
      savedRevision.current = acknowledgedVersion;
      setDiagnostics([]);
      settledActivity.current = t("saved");
      setActivity(settledActivity.current);
      void fetch(`/api/v1/studio/bank/${encodeURIComponent(detail.id)}`)
        .then(async (r) =>
          r.ok ? ((await r.json()) as { data?: BankQuestionDetail }) : null,
        )
        .then((r) => {
          if (
            r?.data?.latestVersion.id === acknowledgedVersion &&
            savedRevision.current === acknowledgedVersion
          )
            setDetail(r.data);
        })
        .catch(() => {
          /* Saving is confirmed independently of preview availability. */
        });
      return {
        revision: acknowledgedVersion,
        savedAt: new Date().toISOString(),
      };
    },
    reconcile: async (source, signal) => {
      const response = await fetch(
        `/api/v1/studio/bank/${encodeURIComponent(detail.id)}`,
        { signal },
      );
      const current = await contentSaveData<{
        latestVersion?: { id?: string; payload?: unknown };
      }>(response);
      const parsed = parseJsonDocument(source, itemRef(detail.id));
      if (
        parsed.errors.length ||
        !sameContent(parsed.value, current.latestVersion?.payload)
      )
        return null;
      if (!current.latestVersion?.id) return null;
      savedRevision.current = current.latestVersion.id;
      return {
        revision: current.latestVersion.id,
        savedAt: new Date().toISOString(),
      };
    },
  });
  useEffect(() => {
    const generation = ++validationGeneration.current;
    if (!autosave.dirty) {
      setDiagnostics([]);
      setActivity(settledActivity.current);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const parsed = parseJsonDocument(text, itemRef(detail.id));
      if (parsed.errors.length) {
        setDiagnostics(parsed.errors.map((d) => ({ message: d.message[interfaceLocale] })));
        setActivity(t("invalidJson"));
        return;
      }
      if (generation !== validationGeneration.current) return;
      setActivity(t("validating"));
      try {
        const response = await fetch("/api/v1/studio/bank/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: text,
          signal: controller.signal,
        });
        const body = (await response.json()) as {
          error?: { message?: string; issues?: ApiIssue[] };
        };
        if (generation !== validationGeneration.current) return;
        if (!response.ok) {
          setDiagnostics(
            body.error?.issues?.length
              ? body.error.issues
              : [{ message: body.error?.message ?? t("invalid") }],
          );
          setActivity(t("invalid"));
          return;
        }
        setDiagnostics([]);
        setActivity(review("valid"));
      } catch (caught) {
        if (
          (caught as { name?: string }).name !== "AbortError" &&
          generation === validationGeneration.current
        ) {
          setDiagnostics([{ message: t("invalid") }]);
          setActivity(t("invalid"));
        }
      }
    }, 700);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [autosave.dirty, detail.id, interfaceLocale, review, t, text]);
  const runtime = useMemo(() => runtimeFor(detail, locale), [detail, locale]);
  const navigationGuard = useUnsavedChanges(autosave.dirty, autosave.flush);
  const preview =
    record(detail.latestVersion.renders[locale]) ??
    record(detail.latestVersion.renders[detail.languages[0] ?? "vi"]);
  const previewQuestion =
    preview &&
    typeof preview.id === "string" &&
    typeof preview.type === "string"
      ? (preview as LearnerQuestion)
      : null;
  const editorLocked = workflowLocked;
  const staffTitle = titleFor(detail.latestVersion.payload, interfaceLocale) || t('titleFallback');
  useEffect(() => registerStaffTitle(staffTitle), [registerStaffTitle, staffTitle]);
  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
      {navigationGuard.dialog}
      <div className="min-w-0 space-y-4">
        <DataCard
          title={t("editor")}
          description={t("version", { version: detail.latestVersion.version })}
          actions={<ContentSaveIndicator state={autosave} valid={validDocument && diagnostics.length === 0} disabled={workflowLocked} />}
        >
          <div className="min-w-0 overflow-hidden">
            <CodeMirror
              value={text}
              height="36rem"
              editable={!editorLocked}
              extensions={[
                json(),
                EditorView.contentAttributes.of({
                  "aria-label": t("editorLabel"),
                }),
              ]}
              onChange={(value) => {
                textRef.current = value;
                setText(value);
              }}
              aria-label={t("editorLabel")}
            />
          </div>
          <div aria-live="polite" className="border-t border-border px-6 py-4">
            <p className="text-sm font-medium leading-normal">{activity}</p>
            {diagnostics.length > 0 ? (
              <ul className="mt-2 space-y-1 text-sm leading-normal text-destructive">
                {diagnostics.map((issue, index) => (
                  <li key={`${issue.message}-${index}`}>
                    {issue.path?.length ? `${issue.path.join(".")} — ` : ""}
                    {issue.message ?? t("invalid")}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </DataCard>
        <ContentWorkflowPanel
          contentType="bank_question"
          contentId={detail.id}
          beforeSubmit={autosave.flush}
          getExpectedRevision={autosave.getRevision}
          refreshKey={autosave.revision ?? undefined}
          onLockChange={setWorkflowLocked}
          className="rounded-lg border border-border bg-card p-6"
        />
      </div>
      <aside className="min-w-0 space-y-6">
        <DataCard
          title={t("preview")}
          actions={
            <label className="flex items-center gap-2 text-sm leading-normal">
              <span>{t("previewLanguage")}</span>
              <NativeSelect
                className="min-h-9"
                value={locale}
                onChange={(event) => {
                  setLocale(event.target.value as Locale);
                  setAnswer(undefined);
                }}
              >
                {detail.languages.map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {value.toUpperCase()}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          }
        >
          <div className="vf-staff-preview-island min-h-48 p-6" lang={locale}>
            {runtime && previewQuestion ? (
              <QuestionRenderer
                question={previewQuestion}
                value={answer}
                onChange={setAnswer}
                runtime={runtime}
              />
            ) : (
              <p className="text-sm leading-normal text-muted-foreground">{t("previewUnavailable")}</p>
            )}
          </div>
        </DataCard>
        <DataCard title={t("grading")}>
          <div className="min-w-0 p-6">
            <pre className="max-h-80 overflow-auto rounded-md bg-muted p-4 font-mono text-xs leading-normal text-muted-foreground">
              {JSON.stringify(detail.latestVersion.grading, null, 2)}
            </pre>
          </div>
        </DataCard>
      </aside>
    </div>
  );
}
