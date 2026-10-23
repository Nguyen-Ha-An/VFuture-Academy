"use client";

import { useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { DataCard, EmptyState, SectionCard, StatCard, StatGrid } from "@/features/staff-ui/components";
import { readApiData, workspaceErrorMessage } from "@/features/studio/ui/client";
import { StaffPageHeader } from "@/features/workspace/ui/StaffPageHeader";

export type MigrationCourse = { id: string; title: string };
type Result = {
  migrated: string[];
  skipped: Array<{ userId?: string; handle?: string | null; reason?: string }>;
};

const copy = {
  en: {
    setup: "Choose a course",
    setupDescription: "Move eligible active enrollments from an older version to the latest published version.",
    guide: "Before you run",
    guideDescription: "Review the course selection. The results will show how many learners moved and why any were skipped.",
    selectedCourse: "Selected course",
    noSelection: "Select a course to continue.",
    migrated: "Migrated",
    skipped: "Skipped",
    resultTitle: "Migration result",
    skippedTitle: "Learners not migrated",
    skippedDescription: "Review these learners before trying again. Technical details are shown below each reason.",
    unknownReason: "Could not complete this learner's migration.",
    reasons: {
      ALREADY_ON_LATEST_VERSION: "Already on the latest version.",
      ACTIVE_ENROLLMENT_NOT_FOUND: "The active enrollment changed or could not be found.",
      LATEST_VERSION_UNAVAILABLE: "The latest course version is unavailable.",
      ITEM_NOT_IN_LATEST_VERSION: "Completed learning content is missing from the latest version.",
      TARGET_PROGRESS_CONFLICT: "Learning progress conflicts with the latest version.",
      MIGRATION_FAILED: "The migration could not be completed.",
    },
  },
  vi: {
    setup: "Chọn khóa học",
    setupDescription: "Chuyển ghi danh đang hoạt động, đủ điều kiện từ phiên bản cũ sang phiên bản đã xuất bản mới nhất.",
    guide: "Trước khi thực hiện",
    guideDescription: "Kiểm tra khóa học đã chọn. Kết quả sẽ cho biết số học viên được chuyển và lý do các trường hợp bị bỏ qua.",
    selectedCourse: "Khóa học đã chọn",
    noSelection: "Chọn khóa học để tiếp tục.",
    migrated: "Đã chuyển",
    skipped: "Bỏ qua",
    resultTitle: "Kết quả chuyển phiên bản",
    skippedTitle: "Học viên chưa được chuyển",
    skippedDescription: "Kiểm tra các trường hợp này trước khi thử lại. Chi tiết kỹ thuật nằm dưới từng lý do.",
    unknownReason: "Không thể hoàn tất chuyển phiên bản cho học viên này.",
    reasons: {
      ALREADY_ON_LATEST_VERSION: "Đã ở phiên bản mới nhất.",
      ACTIVE_ENROLLMENT_NOT_FOUND: "Ghi danh đang hoạt động đã thay đổi hoặc không còn tồn tại.",
      LATEST_VERSION_UNAVAILABLE: "Phiên bản khóa học mới nhất không khả dụng.",
      ITEM_NOT_IN_LATEST_VERSION: "Nội dung học đã hoàn thành không có trong phiên bản mới nhất.",
      TARGET_PROGRESS_CONFLICT: "Tiến độ học xung đột với phiên bản mới nhất.",
      MIGRATION_FAILED: "Không thể hoàn tất chuyển phiên bản.",
    },
  },
} as const;

export function EnrollmentMigrationPanel({ courses }: { courses: MigrationCourse[] }) {
  const t = useTranslations("adminMigration");
  const text = copy[useLocale() === "vi" ? "vi" : "en"];
  const [courseId, setCourseId] = useState("");
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const selectedCourse = courses.find((course) => course.id === courseId);

  function selectCourse(nextCourseId: string) {
    setCourseId(nextCourseId);
    setError(null);
    setResult(null);
  }

  function skipReason(reason?: string) {
    return reason && Object.hasOwn(text.reasons, reason)
      ? text.reasons[reason as keyof typeof text.reasons]
      : text.unknownReason;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!courseId || runningRef.current) return;

    runningRef.current = true;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      setResult(
        await readApiData<Result>(
          await fetch(
            `/api/v1/studio/courses/${encodeURIComponent(courseId)}/enrollments/migrate`,
            { method: "POST" },
          ),
        ),
      );
    } catch (cause) {
      setError(workspaceErrorMessage(cause, t("failed")));
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <StaffPageHeader title={t("title")} description={t("description")} />
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(15rem,2fr)] lg:items-start">
        <form onSubmit={submit} className="min-w-0">
          <SectionCard
            title={text.setup}
            description={text.setupDescription}
            columns={1}
            footer={courses.length > 0 ? (
              <Button
                type="submit"
                disabled={running || !courseId}
                aria-busy={running || undefined}
                className="max-sm:w-full"
              >
                {running ? t("running") : t("submit")}
              </Button>
            ) : undefined}
          >
            {courses.length > 0 ? (
              <label className="grid min-w-0 gap-2 text-sm font-medium leading-normal">
                {t("course")}
                <NativeSelect
                  value={courseId}
                  onChange={(event) => selectCourse(event.target.value)}
                  wrapperClassName="w-full"
                  required
                  disabled={running}
                >
                  <NativeSelectOption value="">{t("selectCourse")}</NativeSelectOption>
                  {courses.map((course) => (
                    <NativeSelectOption key={course.id} value={course.id}>
                      {course.title}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
            ) : <EmptyState title={t("empty")} />}
          </SectionCard>
        </form>
        <SectionCard title={text.guide} description={text.guideDescription} columns={1}>
          <div className="min-w-0 rounded-md border border-border bg-muted/40 p-4">
            <p className="text-xs font-medium leading-normal text-muted-foreground">{text.selectedCourse}</p>
            <p className="mt-1 break-words text-sm font-medium leading-normal text-card-foreground" aria-live="polite">
              {selectedCourse?.title ?? text.noSelection}
            </p>
          </div>
        </SectionCard>
      </div>
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm leading-normal text-destructive-soft-foreground"
        >
          {error}
        </p>
      ) : null}
      {result ? (
        <section className="space-y-4" aria-label={t("result", { migrated: result.migrated.length, skipped: result.skipped.length })}>
          <div className="rounded-lg border border-border bg-card px-6 py-5 text-card-foreground">
            {selectedCourse ? <p className="mb-1 break-words text-xs font-medium leading-normal text-muted-foreground">{selectedCourse.title}</p> : null}
            <h2 className="text-sm font-medium leading-normal">{text.resultTitle}</h2>
            <p role="status" className="sr-only">
              {t("result", {
                migrated: result.migrated.length,
                skipped: result.skipped.length,
              })}
            </p>
          </div>
          <StatGrid className="xl:grid-cols-2">
            <StatCard label={text.migrated} value={result.migrated.length} />
            <StatCard label={text.skipped} value={result.skipped.length} />
          </StatGrid>
          {result.skipped.length > 0 ? (
            <DataCard title={text.skippedTitle} description={text.skippedDescription}>
              <ul className="divide-y divide-border">
                {result.skipped.map((item, index) => (
                  <li key={`${item.userId ?? "unknown"}-${index}`} className="min-w-0 px-6 py-4 text-sm leading-normal">
                    <p className="break-words font-medium text-card-foreground">
                      {item.handle ? `@${item.handle}` : item.userId ?? t("skipped")}
                    </p>
                    <p className="mt-1 text-muted-foreground">{skipReason(item.reason)}</p>
                    <p className="mt-2 break-all text-xs leading-normal text-muted-foreground">
                      {item.userId ?? t("skipped")}{item.reason ? ` · ${item.reason}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </DataCard>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
