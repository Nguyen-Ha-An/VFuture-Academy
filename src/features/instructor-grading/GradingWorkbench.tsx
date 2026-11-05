"use client";

import { Suspense, use, useEffect, useId, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { RichContentView } from "@/content-engine/render/RichContentView";
import { QuestionRenderer } from "@/content-engine/render/QuestionRenderer";
import { registerAll } from "@/content-engine/render";
import type { LearnerQuestion } from "@/content-engine/render/registry";
import { registerContentBlocks } from "@/content-engine/render/blocks";
import type { LessonRuntime } from "@/content-engine/render/runtime";
import { Button } from "@/components/ui/button";
import { CanvasButton, CanvasTextArea, CanvasNumberInput, CanvasRadioInput, CanvasRadioInputGroup, CanvasSelect } from "@/features/canvas/ui";
import { SectionCard } from "@/features/staff-ui/components";
import { WorkspaceApiError, readApiData, workspaceErrorMessage } from "@/features/studio/ui/client";
import { useUnsavedChanges } from "@/features/studio/ui/useUnsavedChanges";
import { StaffPageHeader } from "@/features/workspace/ui/StaffPageHeader";
import { useStaffTitleRegistration } from "@/features/workspace/ui/StaffTitleContext";
import { routes } from "@/lib/routes";
import { RubricScoreEditor, SubmissionResponse, computeRubricTotal, normalizeSubmissionRows } from "./SubmissionsWorkspace";
import type { InstructorRubric, SubmissionQueueItem } from "./types";
import { ManualAnswer } from "./ExamsWorkspace";
import { safeInternalHref } from "./safe-url";
import {
  CompletionContractError,
  completeExamGrading,
  completionErrorCode,
  isManualGradingOpen,
  needsLegacyRelease,
  parseManualGradingProgress,
  type CompletedExamAttempt,
} from "./complete-grading";

registerContentBlocks();
registerAll();

/** Localized course and item titles resolved on the server (src/features/grading/titles.ts). */
export type WorkbenchTitles = { course: string | null; item: string | null };

type Props = {
  kind: "assignments" | "exams";
  id: string;
  actorId: string;
  scope: string;
  locale: "vi" | "en";
  canRelease?: boolean;
  /** Server-resolved titles; without them the header falls back to what the pinned detail carries. */
  titles?: WorkbenchTitles | null;
  /**
   * Server-computed link to the next oldest waiting record in the same filters and scope. The
   * page passes a promise so the workbench renders first and the link streams in.
   */
  nextHref?: string | null | Promise<string | null>;
};
type RecordValue = Record<string, unknown>;

function object(value: unknown): RecordValue | null { return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null; }
function rich(value: unknown) { const candidate = object(value); return candidate && Array.isArray(candidate.blocks) ? candidate as { blocks: unknown[] } : null; }
function learnerQuestion(value: unknown): LearnerQuestion | null { const candidate = object(value); return candidate && typeof candidate.id === "string" && typeof candidate.type === "string" ? candidate as LearnerQuestion : null; }
function assignment(value: unknown): RecordValue | null { const candidate = object(value); return typeof candidate?.id === "string" && (candidate.type === "assignment" || candidate.kind === "assignment") ? candidate : null; }
function numeric(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function text(value: unknown): string | null { return typeof value === "string" && value.length > 0 ? value : null; }
function localizedTitle(value: unknown, locale: "vi" | "en"): string | null {
  if (text(value)) return text(value);
  const translations = object(value);
  return text(translations?.[locale]) ?? text(translations?.[locale === "vi" ? "en" : "vi"]);
}

const MANUAL_QUESTION_TYPES = new Set(["essay", "short_answer", "upload_answer", "code_answer"]);

function questionTypeLabel(type: unknown, locale: "vi" | "en"): string {
  const labels: Record<string, readonly [string, string]> = {
    single_choice: ["Một lựa chọn", "Single choice"],
    multiple_choice: ["Nhiều lựa chọn", "Multiple choice"],
    true_false: ["Đúng / Sai", "True / false"],
    matching: ["Ghép cặp", "Matching"],
    ordering: ["Sắp xếp", "Ordering"],
    classification: ["Phân loại", "Classification"],
    fill_blank: ["Điền vào chỗ trống", "Fill in the blank"],
    short_answer: ["Trả lời ngắn", "Short answer"],
    numeric: ["Trả lời số", "Numeric response"],
    essay: ["Tự luận", "Essay"],
    upload_answer: ["Nộp tệp", "File upload"],
    code_answer: ["Bài lập trình", "Code response"],
    question_group: ["Nhóm câu hỏi", "Question group"],
  };
  const normalized = String(type ?? "");
  return labels[normalized]?.[locale === "vi" ? 0 : 1] ?? (locale === "vi" ? "Câu hỏi" : "Question");
}

function NextInQueueLink({ href }: { href: string | null | Promise<string | null> }) {
  const t = useTranslations("staffUi.grading.workbench");
  const next = safeInternalGradingHref(typeof href === "string" || href === null ? href : use(href));
  return next ? <Button asChild variant="outline"><Link href={next}>{t("next")}<ArrowRight aria-hidden="true" /></Link></Button> : null;
}

function WorkbenchIdentity({ locale, learner, course, assessment, attempt, nextHref }: { locale: "vi" | "en"; learner?: string | null; course?: string | null; assessment?: string | null; attempt?: number | null; nextHref?: string | null | Promise<string | null> }) {
  const vi = locale === "vi";
  const t = useTranslations("staffUi.grading.workbench");
  const registerStaffTitle = useStaffTitleRegistration();
  // The breadcrumb names the record (learner, else the assessment), never the raw id.
  const crumb = learner ?? assessment ?? null;
  useEffect(() => crumb ? registerStaffTitle(crumb) : undefined, [crumb, registerStaffTitle]);
  const identity = learner
    ? (vi ? `Đang xem ${learner}${attempt ? ` · lượt ${attempt}` : ""}` : `Reviewing ${learner}${attempt ? ` · attempt ${attempt}` : ""}`)
    : assessment ?? (vi ? "Bàn chấm" : "Grading workbench");
  // With a learner in the title, the description names the work: "Course · Assessment".
  const description = learner
    ? (course && assessment ? t("identity", { course, item: assessment }) : assessment ?? course ?? undefined)
    : (assessment ? course ?? undefined : undefined);
  return <StaffPageHeader
    eyebrow={vi ? "Bàn chấm" : "Grading desk"}
    title={identity}
    description={description}
    actions={nextHref ? <Suspense fallback={null}><NextInQueueLink href={nextHref} /></Suspense> : undefined}
  />;
}

/** The server builds the next link; it is still only followed when it stays on a grading workbench. */
function safeInternalGradingHref(value: string | null | undefined): string | null {
  return typeof value === "string" && /^\/grading\/(assignments|exams)\/[^/?#\\]+(\?[^#\\]*)?$/.test(value) ? value : null;
}

/** The back link's label names where it goes; unknown targets never occur (safeInternalHref allowlists them). */
function backLabelKey(href: string): "queue" | "home" | "assessments" | "reports" {
  const path = href.split("?")[0];
  if (path === "/grading") return "home";
  if (["/grading/assessments", "/studio/assessments", "/studio/exams", "/admin/exams"].includes(path)) return "assessments";
  if (["/grading/reports", "/studio/analytics", "/admin/analytics"].includes(path)) return "reports";
  return "queue";
}

function MobilePanelTabs({ id, locale, active, onSelect, gradingLabel }: { id: string; locale: "vi" | "en"; active: "prompt" | "grading"; onSelect: (tab: "prompt" | "grading") => void; gradingLabel: string }) {
  const tabs = [
    { value: "prompt" as const, label: locale === "vi" ? "Nội dung" : "Review" },
    { value: "grading" as const, label: gradingLabel },
  ];
  const move = (current: number, key: string) => {
    const next = key === "Home" ? 0 : key === "End" ? tabs.length - 1 : (current + (key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
    const tab = tabs[next];
    onSelect(tab.value);
    document.getElementById(`${id}-${tab.value}-tab`)?.focus();
  };
  return <div role="tablist" aria-label={locale === "vi" ? "Bảng chấm bài" : "Grading panels"} className="flex gap-1 border-b border-border lg:hidden">{tabs.map((tab, index) => <button key={tab.value} id={`${id}-${tab.value}-tab`} role="tab" aria-selected={active === tab.value} aria-controls={`${id}-${tab.value}-panel`} tabIndex={active === tab.value ? 0 : -1} onClick={() => onSelect(tab.value)} onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); move(index, event.key); } }} className={`-mb-px min-h-11 border-b-2 px-4 text-sm font-medium leading-normal outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${active === tab.value ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{tab.label}</button>)}</div>;
}

/**
 * A question needs manual scoring when its declared type is one of the manual types OR the pinned
 * grading run deferred it — a `short_answer` whose safe-regex fallback could not decide lands on
 * `result.status === 'pending_manual'` — OR a manual score has already been stored for it. The
 * stored-score arm is what keeps a question editable after its first save, since saving clears
 * `pending_manual`. This mirrors the evidence the server's `manualGrading` gate uses, so the two
 * can never disagree about which questions must be scored.
 */
function isManualQuestion(item: RecordValue): boolean {
  return MANUAL_QUESTION_TYPES.has(String(item.type))
    || object(item.result)?.status === "pending_manual"
    || numeric(item.manualPoints) !== null;
}

function previewRuntime(locale: "vi" | "en"): LessonRuntime {
  const unavailable = async () => { throw new Error("Preview is read-only"); };
  return { mode: "preview", locale, getBlockState: () => undefined, setBlockState: () => undefined, submitQuiz: unavailable, checkQuestion: unavailable, getAssignmentSession: () => undefined, refreshAssignmentSession: unavailable, submitAssignment: unavailable, uploadAssignmentFile: unavailable, uploadFile: unavailable, resolveMedia: (ref) => "url" in ref ? ref.url : `/api/v1/media/${encodeURIComponent(ref.assetId)}`, hrefFor: () => "#", markViewed: () => undefined, onActivityComplete: () => undefined } as LessonRuntime;
}

function Preview({ value, runtime, path, answer, result }: { value: unknown; runtime: LessonRuntime; path: string; answer?: unknown; result?: unknown }) {
  const assignmentPrompt = assignment(value);
  if (assignmentPrompt) return <section className="space-y-3"><h3 className="text-lg font-semibold leading-normal">{localizedTitle(assignmentPrompt.title, runtime.locale) ?? (runtime.locale === 'vi' ? 'Bài tập' : 'Assignment')}</h3>{rich(assignmentPrompt.instructions)?<RichContentView content={rich(assignmentPrompt.instructions) as never} runtime={runtime} path={`${path}/instructions`}/>:null}{assignmentPrompt.notebook?<p className="rounded-md border border-border p-3 text-sm leading-normal">{runtime.locale==='vi'?'Bài thực hành notebook · xem bài nộp bên dưới.':'Notebook assignment · review the submission below.'}</p>:null}</section>;
  const question = learnerQuestion(value);
  if (question) return <QuestionRenderer question={question} index={0} value={answer} onChange={() => undefined} disabled result={result as never} runtime={runtime} />;
  const content = rich(value);
  return content ? <RichContentView content={content as never} runtime={runtime} path={path} /> : <p role="note" className="rounded-lg border border-dashed border-border p-4 text-sm leading-normal text-muted-foreground">{runtime.locale === 'vi' ? 'Không thể hiển thị nội dung đã ghim trong bàn chấm này.' : 'This pinned content cannot be rendered in the grading workbench.'}</p>;
}

/** Score and feedback the learner can see, rendered from the server's post-completion state only. */
function CompletedResult({ locale, score, max, percent, feedback, availableAt }: { locale: "vi" | "en"; score: number | null; max: number | null; percent: number | null; feedback?: string; availableAt: string | null }) {
  const vi = locale === "vi";
  return (
    <section aria-labelledby="grading-completed-result" className="space-y-3 rounded-lg border border-border bg-muted/40 p-4">
      <h3 id="grading-completed-result" className="text-sm font-medium leading-normal">{vi ? "Kết quả đã hoàn tất" : "Completed result"}</h3>
      <p className="text-2xl font-bold leading-[1.4] tracking-tight tabular-nums">{score === null ? "—" : score}{max === null ? "" : ` / ${max}`}{percent === null ? "" : ` · ${percent}%`}</p>
      {feedback ? <div><p className="text-xs font-medium leading-normal text-muted-foreground">{vi ? "Phản hồi" : "Feedback"}</p><p className="mt-1 whitespace-pre-wrap text-sm leading-normal">{feedback}</p></div> : null}
      <p className="text-sm leading-normal text-muted-foreground">{availableAt
        ? (vi ? "Học viên xem được điểm và phản hồi ngay từ bây giờ." : "The learner can see this score and feedback now.")
        : (vi ? "Đã hoàn tất chấm. Điểm và phản hồi hiển thị cho học viên theo cấu hình của bài đánh giá." : "Grading is complete. The score and feedback follow this assessment's configured availability.")}</p>
      <p className="text-xs leading-normal text-muted-foreground">{vi ? "Đáp án và giải thích vẫn theo cấu hình xem lại riêng của bài đánh giá." : "Answer keys and explanations stay governed by this assessment's own review configuration."}</p>
    </section>
  );
}

/** The pinned source: prefer the resolved title, then the title stored in the pinned prompt. */
function SourceDetails({ titles, itemFallback, version }: { titles?: WorkbenchTitles | null; itemFallback: string | null; version: unknown }) {
  const t = useTranslations("staffUi.grading.workbench.source");
  return <div className="flex flex-wrap items-end gap-x-8 gap-y-3 text-sm leading-normal"><dl className="flex flex-wrap gap-x-8 gap-y-3">
    {titles?.course ? <div className="grid gap-0.5"><dt className="text-xs text-muted-foreground">{t("course")}</dt><dd className="break-words font-medium">{titles.course}</dd></div> : null}
    <div className="grid gap-0.5"><dt className="text-xs text-muted-foreground">{t("item")}</dt><dd className="break-words font-medium">{titles?.item ?? itemFallback ?? t("unavailable")}</dd></div>
  </dl>
    <p className="text-xs text-muted-foreground tabular-nums">{t("version", { version: String(version ?? "—") })}</p>
  </div>;
}

function AssignmentWorkbench({ detail, props }: { detail: RecordValue; props: Props }) {
  const source = object(detail.source) ?? {};
  const [submission,setSubmission] = useState<SubmissionQueueItem|undefined>(()=>normalizeSubmissionRows([detail.submission], [])[0]);
  const [success,setSuccess]=useState('');
  const rubric = (source.rubric ?? { criteria: [] }) as InstructorRubric;
  const [scores, setScores] = useState<Record<string, number>>(() => submission?.grade?.rubricScores ?? {});
  const [feedback, setFeedback] = useState(() => typeof submission?.grade?.feedback === "string" ? submission.grade.feedback : submission?.grade?.feedback?.[props.locale] ?? "");
  const [decision, setDecision] = useState<"approved" | "changes_requested">(() => submission?.grade?.decision ?? "approved");
  const [busy, setBusy] = useState<"save" | "complete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<"prompt" | "grading">("prompt");
  const [saved, setSaved] = useState(() => JSON.stringify({ scores: submission?.grade?.rubricScores ?? {}, feedback: typeof submission?.grade?.feedback === "string" ? submission.grade.feedback : submission?.grade?.feedback?.[props.locale] ?? "", decision: submission?.grade?.decision ?? "approved" }));
  const total = computeRubricTotal(rubric, scores);
  const vi = props.locale === "vi";
  const panel = useTranslations("staffUi.grading.workbench.panels");
  const labels = { prompt: panel("prompt"), response: panel("response"), rubric: panel("rubric"), save: panel("save"), complete: panel("complete"), feedback: panel("feedback"), source: panel("source") };
  // Locked from the server's own view of the grade, never from a local optimistic guess.
  const completed = submission?.grade?.released === true;
  const inBounds = rubric.criteria.every((criterion) => {
    const score = scores[criterion.id];
    return score === undefined || (Number.isFinite(score) && score >= 0 && score <= criterion.maxPoints);
  });
  // Completion needs every criterion scored; a draft may be partial and still save.
  const fullyScored = rubric.criteria.length > 0 && rubric.criteria.every((criterion) =>
    Object.hasOwn(scores, criterion.id) && Number.isFinite(scores[criterion.id])
    && scores[criterion.id] >= 0 && scores[criterion.id] <= criterion.maxPoints);
  async function submit(release: boolean): Promise<boolean> {
    if (!submission || completed || busy) return false;
    if (release ? !fullyScored : !inBounds) return false;
    setBusy(release ? "complete" : "save"); setError(null);
    try {
      const result = await readApiData<{ submission?: { grade?: unknown } }>(await fetch(`/api/v1/studio/submissions/${encodeURIComponent(submission.id)}/grade`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rubricScores: scores, feedback, decision, release }) }));
      const updated = result.submission?.grade ? normalizeSubmissionRows([result.submission], [])[0] : undefined;
      // Completion is irreversible in the UI, so only the server's returned released grade may
      // lock it or announce that the learner can see the result.
      if (release && updated?.grade?.released !== true) throw new Error("Invalid completed grade response");
      setSaved(JSON.stringify({ scores, feedback, decision }));
      if (updated) {
        setSubmission(updated);const nextScores=updated.grade?.rubricScores??scores;const nextFeedback=typeof updated.grade?.feedback==='string'?updated.grade.feedback:updated.grade?.feedback?.[props.locale]??feedback;const nextDecision=updated.grade?.decision??decision;setScores(nextScores);setFeedback(nextFeedback);setDecision(nextDecision);setSaved(JSON.stringify({scores:nextScores,feedback:nextFeedback,decision:nextDecision}));
      }
      setSuccess(vi?(release?'Đã hoàn tất chấm. Học viên xem được điểm và phản hồi.':'Đã lưu bản chấm.'):(release?'Grading completed. The learner can see the score and feedback.':'Grading draft saved.'));
      return true;
    } catch (cause) {
      const code = cause instanceof WorkspaceApiError ? cause.code : null;
      setError(
        code === 'RUBRIC_INCOMPLETE'
          ? (vi ? "Mọi tiêu chí rubric cần có điểm trước khi hoàn tất chấm. Nội dung chấm vẫn được giữ lại." : "Every rubric criterion needs a score before grading is completed. Your grading edits are retained.")
        : code === 'STALE_SUBMISSION'
          ? (vi ? "Học viên đã nộp bản mới hơn; hãy mở lại bài nộp mới. Nội dung chấm vẫn được giữ lại." : "The learner submitted a newer revision; reopen the newer submission. Your grading edits are retained.")
        : workspaceErrorMessage(cause, vi ? "Không thể lưu; nội dung chấm vẫn được giữ lại." : "Could not save; your grading edits are retained."),
      );
      return false;
    }
    finally { setBusy(null); }
  }
  const dirty = !completed && saved !== JSON.stringify({ scores, feedback, decision });
  const guard = useUnsavedChanges(dirty, () => submit(false));
  const serverFeedback = typeof submission?.grade?.feedback === "string" ? submission.grade.feedback : submission?.grade?.feedback?.[props.locale];
  const panelId = useId();
  // Never a raw item id in the header: only the server-resolved title (the pinned prompt shows its own).
  const itemTitle = props.titles?.item ?? null;
  const sourceDetails = <SourceDetails titles={props.titles} itemFallback={localizedTitle(object(source.prompt)?.title, props.locale)} version={source.courseVersion} />;
  return <><WorkbenchIdentity locale={props.locale} learner={submission?.learnerName} course={props.titles?.course} assessment={itemTitle} attempt={submission?.attemptNo ?? null} nextHref={props.nextHref}/><MobilePanelTabs id={panelId} locale={props.locale} active={mobileTab} onSelect={setMobileTab} gradingLabel={labels.rubric}/><div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22.5rem] lg:items-start">
    <div className="col-span-full flex flex-wrap items-center justify-between gap-3 border-y border-border py-3" aria-label={labels.source}>{sourceDetails}        {typeof submission?.late === "boolean" || submission?.dueAtSnapshot ? <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label={vi ? 'Thông tin hạn nộp tại thời điểm nộp bài' : 'Deadline recorded at submission'}>
          {typeof submission.late === 'boolean' ? <p className="border-l-2 border-warning-border pl-2 font-medium text-foreground">{submission.late ? (vi ? 'Nộp muộn' : 'Submitted late') : (vi ? 'Nộp đúng hạn' : 'Submitted on time')}</p> : null}
          {submission.dueAtSnapshot && Number.isFinite(Date.parse(submission.dueAtSnapshot)) ? <p>{vi ? 'Hạn nộp khi nộp bài' : 'Deadline at submission'}: <time dateTime={submission.dueAtSnapshot}>{new Intl.DateTimeFormat(vi ? 'vi-VN' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(submission.dueAtSnapshot))} (UTC+07:00)</time></p> : null}
        </div> : null}
</div>
    <div id={`${panelId}-prompt-panel`} role="tabpanel" aria-labelledby={`${panelId}-prompt-tab`} className={`${mobileTab === "prompt" ? "" : "hidden"} min-w-0 lg:block`}>
      <SectionCard title={labels.response} columns={1}>
        <details className="min-w-0 border-y border-border py-3"><summary className="cursor-pointer text-sm font-medium">{labels.prompt}</summary><div className="mt-4"><Preview value={source.prompt} runtime={previewRuntime(props.locale)} path="/grading/prompt" /></div></details>
        <div className="min-w-0">{submission ? <SubmissionResponse item={submission} hideHeading /> : <><h3 className="text-base font-semibold leading-normal">{labels.response}</h3><p className="mt-3 text-sm leading-normal text-destructive">{props.locale === "vi" ? "Bài nộp không hợp lệ." : "The submission data is invalid."}</p></>}</div>
      </SectionCard>
    </div>
    <div id={`${panelId}-grading-panel`} role="tabpanel" aria-labelledby={`${panelId}-grading-tab`} className={`${mobileTab === "grading" ? "" : "hidden"} min-w-0 lg:block`}>
      <SectionCard
        title={labels.rubric}
        description={completed ? (vi ? "Điểm đã hoàn tất và không thể sửa." : "This completed grade is immutable.") : (vi ? "Bản chấm là bản nháp riêng tư: học viên không thấy điểm hoặc phản hồi cho đến khi bạn hoàn tất chấm." : "A grading draft stays private: the learner sees no score or feedback until you complete grading.")}
        columns={1}
        contentClassName="gap-4"

      >
        {completed ? <CompletedResult locale={props.locale} score={submission?.grade?.totalPoints ?? total.total} max={submission?.grade?.maxPoints ?? total.max} percent={null} feedback={serverFeedback} availableAt={submission?.grade?.gradedAt ?? null} /> : null}
        {!completed ? <><RubricScoreEditor rubric={rubric} scores={scores} onChange={setScores} disabled={busy !== null} />
        <CanvasTextArea label={labels.feedback} value={feedback} disabled={busy !== null} onChange={setFeedback} />
        <CanvasRadioInputGroup name={`${panelId}-decision`} description={vi ? 'Quyết định' : 'Decision'} value={decision} disabled={busy !== null} onChange={(_event, value) => setDecision(value as 'approved' | 'changes_requested')}>
          <CanvasRadioInput value="approved" label={vi ? 'Đạt' : 'Approved'} />
          <CanvasRadioInput value="changes_requested" label={vi ? 'Yêu cầu sửa' : 'Changes requested'} />
        </CanvasRadioInputGroup>
        </> : null}
        {success?<p role="status" className="text-sm leading-normal text-foreground">{success}</p>:null}
        {error ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm leading-normal text-destructive-soft-foreground">{error}</p> : null}
        {!completed && !fullyScored ? <p id={`${panelId}-completion-reason`} className="text-xs leading-normal text-muted-foreground">{vi ? "Cần điểm hợp lệ cho mọi tiêu chí trước khi hoàn tất chấm." : "Every criterion needs a valid score before grading can be completed."}</p> : null}
      </SectionCard>
    </div>
  </div>{!completed ? <div className="sticky bottom-0 z-10 -mx-1 grid gap-2 border-t border-border bg-background px-1 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex sm:items-center sm:justify-between sm:gap-3">
    <p className="text-sm font-medium">{busy ? (vi ? "Đang lưu…" : "Saving…") : dirty ? (vi ? "Có thay đổi chưa lưu" : "Unsaved changes") : (vi ? "Không có thay đổi chưa lưu" : "All changes saved")}</p>
    <div className="grid grid-cols-2 gap-2 sm:flex"><CanvasButton variant="outline" disabled={busy !== null || !inBounds} onClick={() => void submit(false)}>{busy === "save" ? "…" : labels.save}</CanvasButton><CanvasButton aria-describedby={!fullyScored ? `${panelId}-completion-reason` : undefined} disabled={busy !== null || !fullyScored} onClick={() => void submit(true)}>{busy === "complete" ? "…" : labels.complete}</CanvasButton></div>
  </div> : null}{guard.dialog}</>;
}

function ExamWorkbench({ detail, props }: { detail: RecordValue; props: Props }) {
  const [currentDetail,setCurrentDetail]=useState(detail);
  const [saveMessage,setSaveMessage]=useState('');
  const [finalState,setFinalState]=useState<CompletedExamAttempt|null>(null);
  const questions = Array.isArray(currentDetail.questions) ? currentDetail.questions.flatMap((item) => object(item) ? [object(item)!] : []) : [];
  const [selected, setSelected] = useState(0);
  const [points, setPoints] = useState(""); const [feedback, setFeedback] = useState(""); const [busy, setBusy] = useState<"question" | "complete" | null>(null); const [error, setError] = useState<string | null>(null);
  const [savedQuestion, setSavedQuestion] = useState("");
  const [mobileTab, setMobileTab] = useState<"prompt" | "grading">("prompt");
  const question = questions[selected];
  const rawAttempt = object(currentDetail.attempt) ?? {};
  const attemptStatus = finalState?.status ?? rawAttempt.status;
  const resultAvailableAt = finalState?.resultAvailableAt ?? text(rawAttempt.resultAvailableAt);
  const releasedAt = finalState?.releasedAt ?? text(rawAttempt.releasedAt);
  const attemptId = text(rawAttempt.attemptId) ?? props.id;
  useEffect(() => { const nextPoints = question?.manualPoints === null || question?.manualPoints === undefined ? "" : String(question.manualPoints); const nextFeedback = typeof question?.manualFeedback === "string" ? question.manualFeedback : ""; setPoints(nextPoints); setFeedback(nextFeedback); setSavedQuestion(JSON.stringify({ nextPoints, nextFeedback })); }, [question]);
  const vi = props.locale === "vi"; const panel = useTranslations("staffUi.grading.workbench.panels");
  const labels = { questions: panel("questions"), prompt: panel("examPrompt"), answer: panel("answer"), grade: panel("gradeQuestion"), complete: panel("complete") };
  const manualType = question ? isManualQuestion(question) : false;
  // Manual scores stay editable for the whole unfinalized attempt, including questions already
  // scored once: saving a question clears its pending_manual result but must not lock the field.
  const gradingOpen = isManualGradingOpen(attemptStatus);
  const editable = manualType && gradingOpen;
  const maxPoints = Number(object(question?.grading)?.points ?? 0);
  const validPoints = points.trim() !== "" && Number.isFinite(Number(points)) && Number(points) >= 0 && Number(points) <= maxPoints;
  const manualQuestions = questions.filter(isManualQuestion);
  // The server publishes the completion gate; deriving it locally is only the fallback for a
  // detail response that predates the field, so the two can never disagree about acceptance.
  const progress = parseManualGradingProgress(currentDetail);
  const outstanding = new Set(progress?.outstanding ?? manualQuestions
    .filter((item) => numeric(item.manualPoints) === null)
    .map((item) => String(item.questionId)));
  const everyManualScored = progress?.complete ?? (manualQuestions.length > 0 && manualQuestions.every((item) => {
    const scored = numeric(item.manualPoints);
    const limit = Number(object(item.grading)?.points ?? 0);
    return scored !== null && scored >= 0 && scored <= limit;
  }));
  const dirty = gradingOpen && savedQuestion !== JSON.stringify({ nextPoints: points, nextFeedback: feedback });
  async function refresh(): Promise<void> {
    const params=new URLSearchParams({scope:props.scope,actorId:props.actorId});
    setCurrentDetail(await readApiData<RecordValue>(await fetch(`/api/v1/studio/grading/exams/${encodeURIComponent(props.id)}?${params}`)));
  }
  async function save(): Promise<boolean> {
    if (!question || !editable || !validPoints || busy) return false;
    setBusy("question"); setError(null);
    try {
      await readApiData(await fetch(`/api/v1/studio/exams/attempts/${encodeURIComponent(attemptId)}/manual-grade`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ branchId: rawAttempt.branchId, questionId: question.questionId, points: Number(points), feedback }) }));
      setSavedQuestion(JSON.stringify({ nextPoints: points, nextFeedback: feedback }));
      await refresh();
      setSaveMessage(vi?'Đã lưu điểm câu hỏi.':'Question grade saved.');
      return true;
    } catch (cause) { setError(workspaceErrorMessage(cause, vi ? "Không thể lưu; nội dung chấm vẫn được giữ lại." : "Could not save; your grading edits are retained.")); return false; }
    finally { setBusy(null); }
  }
  async function complete(): Promise<void> {
    if (!gradingOpen || !everyManualScored || dirty || busy) return;
    setBusy("complete"); setError(null);
    try {
      // Locks and displays from the server's returned final state; a retry is idempotent and
      // returns the same final state, so a failed first attempt can safely be retried.
      const final = await completeExamGrading(attemptId);
      setFinalState(final);
      setSaveMessage(final.transitioned
        ? (vi?'Đã hoàn tất chấm. Học viên xem được điểm và phản hồi.':'Grading completed. The learner can see the score and feedback.')
        : (vi?'Lượt thi này đã được hoàn tất chấm trước đó. Đang hiển thị kết quả cuối cùng.':'This attempt was already completed. Showing the final result.'));
      await refresh().catch(() => undefined);
    } catch (cause) {
      // Nothing is locked and every saved score and unsaved edit is kept, so the idempotent
      // endpoint can simply be retried.
      const code = completionErrorCode(cause);
      if (code === 'MANUAL_GRADING_INCOMPLETE' || code === 'ATTEMPT_NOT_ACTIVE' || code === 'INVALID_GRADE' || code === 'LEGACY_RESULT_UNRELEASED') {
        await refresh().catch(() => undefined);
      }
      setError(
        cause instanceof CompletionContractError
          ? (vi ? "Máy chủ không xác nhận đầy đủ việc hoàn tất chấm. Điểm đã lưu vẫn được giữ; hãy thử hoàn tất lại." : "The server did not fully confirm the completion. Your saved scores are kept; try completing again.")
        : code === 'MANUAL_GRADING_INCOMPLETE'
          ? (vi ? "Còn câu hỏi chấm tay chưa có điểm hợp lệ. Danh sách câu hỏi đã được làm mới; điểm đã lưu vẫn được giữ." : "A manual question still has no valid score. The question list was refreshed; your saved scores are kept.")
        : code === 'GRADING_CONFLICT'
          ? (vi ? "Một người chấm khác vừa sửa lượt thi này. Điểm và nội dung bạn đang sửa vẫn được giữ; hãy thử hoàn tất lại." : "Another grader just changed this attempt. Your scores and edits are kept; try completing again.")
        : code === 'ATTEMPT_NOT_ACTIVE'
          ? (vi ? "Lượt thi không còn ở trạng thái chấm tay. Đã làm mới trạng thái." : "This attempt is no longer open for manual grading. The state was refreshed.")
        : code === 'LEGACY_RESULT_UNRELEASED'
          ? (vi ? "Đây là kết quả cũ chưa công bố. Đã làm mới trạng thái; dùng thao tác công bố kết quả cũ trong Bài tập & bài thi." : "This is an unpublished legacy result. The state was refreshed; use the legacy release action in Assignments & exams.")
        : code === 'INVALID_GRADE'
          ? (vi ? "Một điểm đã lưu không hợp lệ với câu hỏi của nó. Đã làm mới; hãy chấm lại câu hỏi đó." : "A stored score is out of range for its question. The detail was refreshed; re-score that question.")
        : workspaceErrorMessage(cause, vi ? "Không thể hoàn tất chấm; điểm đã lưu vẫn được giữ." : "Grading could not be completed; the saved scores are kept."),
      );
    }
    finally { setBusy(null); }
  }
  const guard = useUnsavedChanges(dirty, save);
  async function selectQuestion(index: number) { if (index === selected || await guard.requestLeave()) setSelected(index); }
  const legacyRelease = needsLegacyRelease({ status: attemptStatus, resultAvailableAt, releasedAt });
  const releaseHref = routes.grading.assessments({ branchId: text(rawAttempt.branchId) ?? '', courseVersionId: text(rawAttempt.courseVersionId) ?? '', itemId: text(rawAttempt.itemId) ?? '' });
  const finalPoints = finalState?.points ?? numeric(rawAttempt.points);
  const finalMax = finalState?.maxPoints ?? numeric(rawAttempt.maxPoints);
  const finalPercent = finalState?.percent ?? numeric(rawAttempt.percent);
  const remainingManual = progress ? Math.max(0, progress.total - progress.scored) : outstanding.size;
  const panelId = useId();
  const examTitle = props.titles?.item ?? text(rawAttempt.itemTitle) ?? text(currentDetail.itemTitle);
  return <><WorkbenchIdentity locale={props.locale} learner={text(currentDetail.learnerName) ?? text(rawAttempt.learnerName)} course={props.titles?.course} assessment={examTitle} attempt={numeric(rawAttempt.attemptNo)} nextHref={props.nextHref}/><MobilePanelTabs id={panelId} locale={props.locale} active={mobileTab} onSelect={setMobileTab} gradingLabel={vi ? "Chấm điểm" : "Grading"}/><div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22.5rem] lg:items-start">
    <SectionCard
      title={labels.questions}
      description={gradingOpen && manualQuestions.length ? (vi ? `Còn ${remainingManual} câu chấm tay` : `${remainingManual} manual question${remainingManual === 1 ? "" : "s"} remaining`) : undefined}
      columns={1}
      className="lg:col-span-2"
      contentClassName="p-3"
    >
      <div className="lg:hidden"><CanvasSelect label={labels.questions} value={String(selected)} disabled={busy !== null} onChange={value => void selectQuestion(Number(value))} options={questions.map((item, index) => ({ value: String(index), label: `${index + 1}. ${questionTypeLabel(item.type, props.locale)}${isManualQuestion(item) && outstanding.has(String(item.questionId)) ? (vi ? ' · chưa chấm' : ' · unscored') : ''}` }))} /></div>
      <nav className="hidden grid-cols-4 gap-1 lg:grid xl:grid-cols-6" aria-label={labels.questions}>{questions.map((item, index) => { const scored = numeric(item.manualPoints); const isManual = isManualQuestion(item); const unscored = isManual && outstanding.has(String(item.questionId)); return <button key={String(item.questionId)} type="button" disabled={busy !== null} aria-current={selected === index ? "true" : undefined} onClick={() => void selectQuestion(index)} className={`block min-h-11 w-full rounded-md border px-3 py-2 text-left text-sm leading-normal outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${selected === index ? "border-primary bg-primary text-primary-foreground" : unscored ? "border-warning-border bg-warning text-warning-foreground hover:bg-accent" : "border-transparent hover:border-border hover:bg-accent"}`}>{index + 1}. {questionTypeLabel(item.type, props.locale)}{isManual ? <span className="text-xs tabular-nums">{unscored ? (vi ? " · chưa chấm" : " · unscored") : scored === null ? "" : ` · ${scored}`}</span> : null}</button>; })}</nav>
    </SectionCard>
    <div id={`${panelId}-prompt-panel`} role="tabpanel" aria-labelledby={`${panelId}-prompt-tab`} className={`${mobileTab === "prompt" ? "" : "hidden"} min-w-0 lg:block`}>
      <SectionCard title={labels.answer} columns={1}>
        {question ? <>
          <details className="min-w-0 border-y border-border py-3"><summary className="cursor-pointer text-sm font-medium">{labels.prompt}</summary><div className="mt-4">{rich(question.context)?<RichContentView content={rich(question.context) as never} runtime={previewRuntime(props.locale)}/>:null}<Preview value={question.prompt} runtime={previewRuntime(props.locale)} path={`/grading/exam/${String(question.questionId)}`} answer={question.answer} result={question.result} /></div></details>
          <section aria-label={labels.answer} className="min-w-0"><div className="py-2"><ManualAnswer question={{ questionId: String(question.questionId), type: String(question.type), content: question.prompt, answer: question.answer, maxPoints, points: question.manualPoints as number | null, feedback: question.manualFeedback } as never} /></div></section>
        </> : <p className="text-sm leading-normal text-muted-foreground">{vi ? "Không có câu hỏi trong bản chụp đã ghim." : "No questions were found in the pinned snapshot."}</p>}
      </SectionCard>
    </div>
    <div id={`${panelId}-grading-panel`} role="tabpanel" aria-labelledby={`${panelId}-grading-tab`} className={`${mobileTab === "grading" ? "" : "hidden"} min-w-0 lg:block`}>
      <SectionCard
        title={vi ? "Chấm điểm" : "Scoring"}
        description={gradingOpen ? (vi ? "Điểm câu hỏi là bản nháp riêng tư và có thể sửa cho đến khi bạn hoàn tất chấm." : "Question scores stay a private draft and remain editable until you complete grading.") : (vi ? "Đã hoàn tất chấm; không thể sửa điểm." : "Grading is complete; scores can no longer be edited.")}
        columns={1}
        contentClassName="gap-4"

      >
        {saveMessage?<p role="status" className="text-sm leading-normal text-foreground">{saveMessage}</p>:null}
        {!gradingOpen ? <CompletedResult locale={props.locale} score={finalPoints} max={finalMax} percent={finalPercent} availableAt={resultAvailableAt} /> : null}
        {!gradingOpen && manualType ? <p className="text-sm leading-normal text-muted-foreground">{vi ? "Câu hỏi này không còn chờ chấm tay." : "This question is no longer pending manual grading."}</p> : null}
        {legacyRelease && props.canRelease ? <div className="rounded-md border border-warning-border bg-warning p-3 text-sm leading-normal text-warning-foreground"><p className="font-medium">{vi ? "Kết quả cũ chưa công bố" : "Legacy unreleased result"}</p><p className="mt-1">{vi ? "Lượt thi này đã chấm xong trước khi có cơ chế hiển thị kết quả mới. Dùng công bố kết quả cũ để hiển thị cho học viên." : "This attempt finished grading before result availability existed. Use the legacy release operation to show it to the learner."}</p><Button asChild variant="outline" size="sm" className="mt-3"><Link href={releaseHref}>{vi ? "Mở công bố kết quả cũ" : "Open legacy result release"}</Link></Button></div> : null}
        {question && gradingOpen ? manualType ? <><CanvasNumberInput renderLabel={vi ? `Điểm / ${maxPoints}` : `Points / ${maxPoints}`} min={0} max={maxPoints} showArrows={false} value={points} interaction={!editable || busy !== null ? "disabled" : "enabled"} onChange={(_event, value) => setPoints(value)} /><CanvasTextArea label={vi ? "Phản hồi" : "Feedback"} value={feedback} disabled={!editable || busy !== null} onChange={setFeedback} />{error ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm leading-normal text-destructive-soft-foreground">{error}</p> : null}{!editable ? <p className="text-sm leading-normal text-muted-foreground">{vi?"Câu hỏi này không còn chờ chấm tay.":"This question is no longer pending manual grading."}</p> : null}</> : <p className="text-sm leading-normal text-muted-foreground">{vi ? "Câu hỏi này được chấm tự động và chỉ đọc." : "This question is automatically graded and read-only."}</p> : null}
        {gradingOpen ? <div id={`${panelId}-completion-reason`} className="grid gap-2 border-t border-border pt-4">{!everyManualScored ? <p className="text-xs leading-normal text-muted-foreground">{vi ? `Mọi câu hỏi chấm tay cần điểm hợp lệ trước khi hoàn tất chấm.${progress ? ` Đã chấm ${progress.scored}/${progress.total}.` : ''}` : `Every manual question needs a valid score before grading can be completed.${progress ? ` Scored ${progress.scored} of ${progress.total}.` : ''}`}</p> : dirty ? <p className="text-xs leading-normal text-muted-foreground">{vi ? "Lưu điểm câu hỏi đang sửa trước khi hoàn tất chấm." : "Save the question grade you are editing before completing grading."}</p> : null}{!manualType && error ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm leading-normal text-destructive-soft-foreground">{error}</p> : null}</div> : null}
      </SectionCard>
    </div>
  </div>{gradingOpen ? <div className="sticky bottom-0 z-10 grid gap-2 border-t border-border bg-background pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex sm:items-center sm:justify-between sm:gap-3">
    <p className="text-sm font-medium">{busy ? (vi ? "Đang lưu…" : "Saving…") : dirty ? (vi ? "Có thay đổi chưa lưu" : "Unsaved changes") : (vi ? "Không có thay đổi chưa lưu" : "All changes saved")}</p>
    <div className="grid grid-cols-2 gap-2 sm:flex">{editable ? <CanvasButton variant="outline" disabled={busy !== null || !validPoints} onClick={() => void save()}>{labels.grade}</CanvasButton> : null}<CanvasButton aria-describedby={!everyManualScored || dirty ? `${panelId}-completion-reason` : undefined} disabled={busy !== null || !everyManualScored || dirty} onClick={() => void complete()}>{labels.complete}</CanvasButton></div>
  </div> : null}{guard.dialog}</>;
}

function LoadedGradingWorkbench(props: Props) {
  const t = useTranslations("staffUi.grading.workbench");
  const [backHref,setBackHref]=useState(() => routes.grading.queue());
  useEffect(()=>{const back=safeInternalHref(new URLSearchParams(window.location.search).get('back'));if(back)setBackHref(back)},[]);
  const [detail, setDetail] = useState<RecordValue | null>(null); const [error, setError] = useState<string | null>(null);
  useEffect(() => { const controller = new AbortController(); setDetail(null);setError(null); const path = props.kind === "assignments" ? "assignments" : "exams"; const params = new URLSearchParams({ scope: props.scope, actorId: props.actorId }); void fetch(`/api/v1/studio/grading/${path}/${encodeURIComponent(props.id)}?${params}`, { signal: controller.signal }).then((response) => readApiData<unknown>(response)).then((value) => { const parsed = object(value); if (!parsed) throw new Error("Invalid grading detail"); if(!controller.signal.aborted)setDetail(parsed); }).catch((cause) => { if (!controller.signal.aborted) setError(workspaceErrorMessage(cause, props.locale === "vi" ? "Không thể tải nguồn lịch sử đã ghim." : "The pinned historical source is unavailable.")); }); return () => controller.abort(); }, [props.kind,props.id,props.scope,props.actorId,props.locale]);
  if (error) return <section className="mx-auto max-w-3xl space-y-4 rounded-lg border border-border bg-card p-6 text-card-foreground"><p className="text-xs font-medium leading-normal text-destructive-soft-foreground">{props.locale === "vi" ? "Lỗi tải dữ liệu" : "Load error"}</p><h1 className="text-xl font-bold leading-[1.4]">{props.locale === "vi" ? "Không có nguồn lịch sử" : "Historical source unavailable"}</h1><p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm leading-normal text-destructive-soft-foreground">{error}</p><Button asChild variant="outline"><Link href={backHref}><ArrowLeft aria-hidden="true" />{t(`back.${backLabelKey(backHref)}`)}</Link></Button></section>;
  if (!detail) return <div role="status" className="flex min-h-40 items-center justify-center gap-2 rounded-lg border border-border bg-card p-6 text-sm leading-normal text-muted-foreground"><LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />{props.locale === "vi" ? "Đang tải bài chấm…" : "Loading grading workbench…"}</div>;
  return <><Link href={backHref} className="mb-4 inline-flex min-h-9 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"><ArrowLeft aria-hidden="true" className="size-4" />{t(`back.${backLabelKey(backHref)}`)}</Link>{props.kind === "assignments" ? <AssignmentWorkbench detail={detail} props={props} /> : <ExamWorkbench detail={detail} props={props} />}</>;
}
export function GradingWorkbench(props:Props){return <LoadedGradingWorkbench key={`${props.actorId}:${props.scope}:${props.kind}:${props.id}:${props.locale}`} {...props}/>;
}
