import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { supabaseService } from "@/lib/supabase/server";
import { ApiError } from "@/lib/api";
import type { Actor } from "@/lib/permissions";
import {
  sanitizeNotebookTemplate,
  validateNotebookDocument,
  validateNotebookDependencies,
  type NotebookAssignment,
} from "./contracts";
import { checkUpload } from "./upload-contract";
import type { NotebookContext } from "./access";

export const NOTEBOOK_BUCKET = "notebooks";
export type ArtifactRow = {
  id: string;
  owner_id: string;
  course_id: string;
  course_version_id: string | null;
  item_id: string;
  block_id: string | null;
  purpose: "template" | "dataset" | "draft" | "submission";
  checksum: string;
  template_asset_id: string | null;
  template_checksum: string | null;
  runtime_profile_id: string;
  runtime_profile_version: string;
  size_bytes: number;
  mime: string;
  filename: string;
  storage_path: string;
  status: "pending" | "ready";
  created_at: string;
};
type Database = ReturnType<typeof supabaseService>;
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export async function readArtifact(
  id: string,
  db: Database = supabaseService(),
): Promise<ArtifactRow> {
  const { data, error } = await db
    .from("notebook_artifacts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Unable to read notebook artifact");
  if (!data)
    throw new ApiError(
      404,
      "NOTEBOOK_ASSET_NOT_FOUND",
      "Notebook file is unavailable",
    );
  return data as ArtifactRow;
}
export function assertArtifactTarget(
  row: ArtifactRow,
  actor: Actor,
  context: NotebookContext,
) {
  if (
    row.owner_id !== actor.userId ||
    row.course_id !== context.courseId ||
    row.item_id !== context.itemId ||
    row.block_id !== context.blockId ||
    row.course_version_id !== context.courseVersionId
  )
    throw new ApiError(
      404,
      "NOTEBOOK_ASSET_NOT_FOUND",
      "Notebook file is unavailable",
    );
}
export async function beginNotebookUpload(
  actor: Actor,
  context: NotebookContext,
  value: unknown,
  db: Database = supabaseService(),
) {
  const file = checkUpload(value);
  if (
    context.studio !==
    (file.purpose === "template" || file.purpose === "dataset")
  )
    throw new ApiError(
      403,
      "NOTEBOOK_UPLOAD_SCOPE",
      "This upload does not belong to this workspace",
    );
  const config = context.notebook;
  if (!context.studio && !config)
    throw new ApiError(404, "NOTEBOOK_NOT_FOUND", "Notebook is unavailable");
  const id = randomUUID();
  const path = `pending/${actor.userId}/${id}/${file.filename}`;
  const row = {
    id,
    owner_id: actor.userId,
    course_id: context.courseId,
    course_version_id: context.courseVersionId,
    item_id: context.itemId,
    block_id: context.blockId,
    purpose: file.purpose,
    checksum: file.checksum,
    template_asset_id: config?.templateAssetId ?? null,
    template_checksum: config?.templateChecksum ?? null,
    runtime_profile_id: config?.runtimeProfileId ?? "python-data-v1",
    runtime_profile_version: config?.runtimeProfileVersion ?? "1",
    size_bytes: file.sizeBytes,
    mime: file.mime,
    filename: file.filename,
    storage_path: path,
    status: "pending",
  };
  const insert = await db.from("notebook_artifacts").insert(row);
  if (insert.error) throw new Error("Unable to reserve notebook upload");
  const signed = await db.storage
    .from(NOTEBOOK_BUCKET)
    .createSignedUploadUrl(path, { upsert: false });
  if (signed.error || !signed.data?.signedUrl)
    throw new Error("Unable to sign notebook upload");
  return { id, url: signed.data.signedUrl, mime: file.mime };
}
export async function finalizeNotebookUpload(
  actor: Actor,
  context: NotebookContext,
  id: string,
  db: Database = supabaseService(),
) {
  const row = await readArtifact(id, db);
  assertArtifactTarget(row, actor, context);
  if (row.status === "ready") return row;
  if (Date.now() - Date.parse(row.created_at) > 2 * 60 * 60 * 1000)
    throw new ApiError(
      410,
      "UPLOAD_EXPIRED",
      "Upload expired; please upload again",
    );
  const result = await db.storage
    .from(NOTEBOOK_BUCKET)
    .download(row.storage_path);
  if (result.error || !result.data)
    throw new ApiError(400, "UPLOAD_INCOMPLETE", "Upload has not completed");
  if (result.data.size !== row.size_bytes)
    throw new ApiError(
      422,
      "NOTEBOOK_SIZE_MISMATCH",
      "Uploaded file size differs from the reservation",
    );
  let bytes = new Uint8Array(await result.data.arrayBuffer());
  if (sha(bytes) !== row.checksum)
    throw new ApiError(
      422,
      "NOTEBOOK_CHECKSUM_MISMATCH",
      "Uploaded file checksum does not match",
    );
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (row.purpose === "dataset") {
      if (row.mime === "application/json") JSON.parse(text);
    } else {
      const document = JSON.parse(text);
      const checked =
        row.purpose === "template"
          ? sanitizeNotebookTemplate(document)
          : validateNotebookDocument(document);
      bytes = new TextEncoder().encode(JSON.stringify(checked));
      if (bytes.byteLength > 5 * 1024 * 1024)
        throw new ApiError(413, "NOTEBOOK_TOO_LARGE", "Notebook exceeds 5 MiB");
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (row.purpose === "template" && error instanceof Error && error.message.includes("hidden solution cell")) {
      throw new ApiError(422, "NOTEBOOK_TEMPLATE_PRIVATE_CELLS", "Use a student notebook without instructor-only solution cells");
    }
    throw new ApiError(
      422,
      "NOTEBOOK_INVALID",
      "Notebook or dataset content is invalid",
    );
  }
  // Final objects are never exposed by the upload URL and can never be overwritten by its holder.
  const path = `ready/${actor.userId}/${id}/${row.filename}`;
  const uploaded = await db.storage
    .from(NOTEBOOK_BUCKET)
    .upload(path, bytes, { contentType: row.mime, upsert: false });
  if (uploaded.error) {
    const prior = await db.storage.from(NOTEBOOK_BUCKET).download(path);
    if (
      prior.error ||
      !prior.data ||
      sha(new Uint8Array(await prior.data.arrayBuffer())) !== sha(bytes)
    )
      throw new Error("Unable to finalize notebook bytes");
  }
  const saved = await db.rpc("finalize_notebook_artifact", {
    p_id: id,
    p_owner_id: actor.userId,
    p_path: path,
    p_checksum: sha(bytes),
    p_size: bytes.byteLength,
  });
  if (saved.error) throw new Error("Unable to finalize notebook record");
  await db.storage.from(NOTEBOOK_BUCKET).remove([row.storage_path]);
  return readArtifact(id, db);
}
export async function signedArtifact(
  row: ArtifactRow,
  db: Database = supabaseService(),
) {
  if (row.status !== "ready")
    throw new ApiError(
      404,
      "NOTEBOOK_ASSET_NOT_READY",
      "Notebook file is unavailable",
    );
  const { data, error } = await db.storage
    .from(NOTEBOOK_BUCKET)
    .createSignedUrl(row.storage_path, 300);
  if (error || !data?.signedUrl)
    throw new Error("Unable to open notebook file");
  return {
    assetId: row.id,
    checksum: row.checksum,
    filename: row.filename,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    url: data.signedUrl,
  };
}
export async function resolveNotebookDependencies(
  context: NotebookContext,
  config: NotebookAssignment,
  db: Database = supabaseService(),
) {
  const ids = [
    config.templateAssetId,
    ...config.datasets.map((d) => d.assetId),
  ];
  const rows = await Promise.all(ids.map((id) => readArtifact(id, db)));
  // A template is owned by its course; published enrollment pins grant read access via loadNotebookContext.
  if (
    rows.some(
      (r, i) =>
        r.course_id !== context.courseId ||
        r.status !== "ready" ||
        r.purpose !== (i === 0 ? "template" : "dataset"),
    )
  )
    throw new ApiError(
      404,
      "NOTEBOOK_ASSET_NOT_FOUND",
      "Notebook dependency is unavailable",
    );
  const issues = validateNotebookDependencies(
    config,
    rows.map((r) => ({
      assetId: r.id,
      checksum: r.checksum,
      filename: r.filename,
      mime: r.mime,
      sizeBytes: r.size_bytes,
    })),
  );
  if (issues.length)
    throw new ApiError(
      422,
      "NOTEBOOK_DEPENDENCIES_INVALID",
      "Notebook files do not match this assignment version",
    );
  return rows;
}
export async function notebookDependencies(
  context: NotebookContext,
  config: NotebookAssignment,
  db: Database = supabaseService(),
) {
  const rows = await resolveNotebookDependencies(context, config, db);
  const signed = await Promise.all(rows.map((r) => signedArtifact(r, db)));
  return { template: signed[0], datasets: signed.slice(1) };
}
