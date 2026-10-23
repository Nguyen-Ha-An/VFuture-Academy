import type { NotebookAssignment } from "./contracts";
import type { NotebookLocator } from "./upload-contract";
import type { AssignmentSessionResult } from "@/features/submissions/contracts";
export type SignedNotebookFile = {
  assetId: string;
  checksum: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  url: string;
};
export type NotebookSession = {
  userId: string;
  courseId: string;
  courseVersionId: string | null;
  itemId: string;
  blockId: string | null;
  config: NotebookAssignment | null;
  template: SignedNotebookFile | null;
  datasets: SignedNotebookFile[];
  draft: { revision: number; artifact: SignedNotebookFile } | null;
  studioRevision: string | null;
  assignment: AssignmentSessionResult | null;
};
export class NotebookApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "NotebookApiError";
  }
}
export async function notebookJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
    data?: T;
  } | null;
  if (!response.ok)
    throw new NotebookApiError(
      body?.error?.code ?? "NOTEBOOK_ERROR",
      body?.error?.message ?? "Notebook request failed",
      response.status,
    );
  if (!body || !("data" in body))
    throw new NotebookApiError(
      "NOTEBOOK_INVALID_RESPONSE",
      "Notebook response was invalid",
      502,
    );
  return body.data as T;
}
export function notebookApi(
  locator: NotebookLocator,
  studio: boolean,
  action: string,
) {
  const q = new URLSearchParams({
    courseId: locator.courseId,
    itemId: locator.itemId,
  });
  if (locator.blockId) q.set("blockId", locator.blockId);
  return `/api/v1/${studio ? "studio/" : ""}notebooks/${action}?${q}`;
}
export function notebookWorkspaceHref(
  locator: NotebookLocator,
  studio = false,
) {
  const q = new URLSearchParams();
  if (locator.blockId) q.set("blockId", locator.blockId);
  return `${studio ? "/studio" : "/app"}/courses/${encodeURIComponent(locator.courseId)}/${studio ? "notebooks" : "items"}/${encodeURIComponent(locator.itemId)}${studio ? "" : "/notebook"}${q.size ? "?" + q : ""}`;
}
export async function uploadNotebookFile(
  locator: NotebookLocator,
  studio: boolean,
  file: Blob,
  filename: string,
  purpose: "template" | "dataset" | "draft" | "submission",
  expectedActor?: string,
) {
  const checksum = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  const actorHeaders: HeadersInit = expectedActor
    ? { "X-Notebook-Actor": expectedActor }
    : {};
  const ticket = await notebookJson<{ id: string; url: string; mime: string }>(
    notebookApi(locator, studio, "upload"),
    {
      method: "POST",
      headers: actorHeaders,
      body: JSON.stringify({
        filename,
        purpose,
        sizeBytes: file.size,
        checksum,
      }),
    },
  );
  const uploaded = await fetch(ticket.url, {
    method: "PUT",
    headers: { "Content-Type": ticket.mime },
    body: file,
  });
  if (!uploaded.ok)
    throw new NotebookApiError(
      "UPLOAD_FAILED",
      "File upload failed; your notebook is still available.",
      uploaded.status,
    );
  return notebookJson<{
    id: string;
    checksum: string;
    filename: string;
    size_bytes: number;
    runtime_profile_id: string;
    runtime_profile_version: string;
  }>(notebookApi(locator, studio, "finalize"), {
    method: "POST",
    headers: actorHeaders,
    body: JSON.stringify({ id: ticket.id }),
  });
}
export function downloadNotebook(
  notebook: unknown,
  filename = "notebook.ipynb",
) {
  const blob = new Blob([JSON.stringify(notebook, null, 2)], {
    type: "application/x-ipynb+json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const EMPTY_NOTEBOOK = {
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {
    kernelspec: {
      display_name: "Python (Pyodide)",
      language: "python",
      name: "python",
    },
  },
  cells: [
    {
      id: "start",
      cell_type: "code",
      metadata: {},
      source: "",
      execution_count: null,
      outputs: [],
    },
  ],
};
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export const sameNotebookSnapshot = (left: unknown, right: unknown) =>
  canonicalJson(left) === canonicalJson(right);
