"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { notebookWorkspaceHref } from "../client";
function assignments(value: unknown): Array<{ id: string; title: string }> {
  if (!value || typeof value !== "object") return [];
  const obj = value as Record<string, unknown>;
  if (obj.kind === "exam") return [];
  if (obj.type === "assignment" && typeof obj.id === "string")
    return [
      { id: obj.id, title: typeof obj.title === "string" ? obj.title : obj.id },
    ];
  return Object.values(obj).flatMap((v) =>
    Array.isArray(v)
      ? v.flatMap(assignments)
      : v && typeof v === "object"
        ? assignments(v)
        : [],
  );
}
export function StudioNotebookEntry({
  courseId,
  itemId,
  document,
  disabled,
}: {
  courseId: string;
  itemId: string;
  document: unknown;
  disabled: boolean;
}) {
  const t = useTranslations("notebook");
  if (!document || typeof document !== "object") return null;
  const source = document as Record<string, unknown>;
  const targets =
    source.kind === "assignment"
      ? [{ blockId: null, title: t("configure") }]
      : assignments(source).map((a) => ({ blockId: a.id, title: a.title }));
  if (!targets.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {targets.map((target) =>
        disabled ? (
          <span
            key={target.blockId ?? "standalone"}
            title={t("requiresSave")}
            className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm text-muted-foreground"
          >
            {t("configure")}
            {target.blockId ? `: ${target.title}` : ""}
          </span>
        ) : (
          <Link
            key={target.blockId ?? "standalone"}
            href={notebookWorkspaceHref(
              { courseId, itemId, blockId: target.blockId },
              true,
            )}
            className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm font-medium text-primary hover:bg-muted"
          >
            {t("configure")}
            {target.blockId ? `: ${target.title}` : ""}
          </Link>
        ),
      )}
    </div>
  );
}
