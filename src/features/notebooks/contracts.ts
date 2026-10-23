import {
  ChecksumSchema,
  NOTEBOOK_DATASET_MAX_BYTES,
  NOTEBOOK_DATASETS_TOTAL_MAX_BYTES,
  NOTEBOOK_MAX_BYTES,
  NOTEBOOK_MIME,
  NotebookAssignmentSchema,
  NotebookDocumentSchema,
  type NotebookAssignment,
  type NotebookDocument,
} from "@/content-engine/schema/notebook";

export {
  ChecksumSchema,
  NOTEBOOK_DATASET_MAX_BYTES,
  NOTEBOOK_DATASETS_TOTAL_MAX_BYTES,
  NOTEBOOK_MAX_BYTES,
  NOTEBOOK_MIME,
  NOTEBOOK_RUNTIME_PROFILES,
  NotebookAssignmentSchema,
  NotebookDatasetSchema,
  NotebookDocumentSchema,
  type NotebookAssignment,
  type NotebookDataset,
  type NotebookDocument,
} from "@/content-engine/schema/notebook";

export type NotebookDependency = {
  kind: "template" | "dataset";
  assetId: string;
  checksum: string;
  filename?: string;
  runtimeProfileId: string;
  runtimeProfileVersion: string;
};

export type NotebookDependencySnapshot = {
  assetId: string;
  checksum: string;
  filename: string;
  mime: string;
  sizeBytes: number;
};

export type NotebookContractIssue = {
  code:
    | "missing"
    | "checksum_mismatch"
    | "filename_mismatch"
    | "mime_mismatch"
    | "file_too_large"
    | "total_too_large"
    | "purpose_mismatch"
    | "status_mismatch"
    | "provenance_mismatch";
  assetId: string;
  field?: string;
};

export function validateNotebookDocument(value: unknown): NotebookDocument {
  return NotebookDocumentSchema.parse(value);
}

function withoutTrusted(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const { trusted: _trusted, ...safe } = metadata;
  return safe;
}

function isHiddenSolution(metadata: Record<string, unknown>): boolean {
  if (
    metadata.solution === true ||
    metadata.hiddenSolution === true ||
    metadata.instructorOnly === true
  )
    return true;
  for (const namespace of ["nbgrader", "vfuture", "jupyter"]) {
    const nested = metadata[namespace];
    if (
      nested &&
      typeof nested === "object" &&
      !Array.isArray(nested) &&
      isHiddenSolution(nested as Record<string, unknown>)
    )
      return true;
  }
  const tags = Array.isArray(metadata.tags) ? metadata.tags : [];
  return tags.some(
    (tag) =>
      typeof tag === "string" &&
      ["solution", "hidden-solution", "instructor-only"].includes(
        tag.toLowerCase(),
      ),
  );
}

/** Produces the immutable learner template without executed output or author-only solution cells. */
export function sanitizeNotebookTemplate(value: unknown): NotebookDocument {
  const notebook = validateNotebookDocument(value);
  if (notebook.cells.some((cell) => isHiddenSolution(cell.metadata))) {
    throw new Error(
      "Notebook template contains a hidden solution cell; remove author-only cells before import",
    );
  }
  return {
    ...notebook,
    metadata: withoutTrusted(notebook.metadata),
    cells: notebook.cells.map((cell) =>
      cell.cell_type === "code"
        ? {
            ...cell,
            metadata: withoutTrusted(cell.metadata),
            execution_count: null,
            outputs: [],
          }
        : { ...cell, metadata: withoutTrusted(cell.metadata) },
    ),
  };
}

export function collectNotebookDependencies(
  value: NotebookAssignment,
): NotebookDependency[] {
  const notebook = NotebookAssignmentSchema.parse(value);
  return [
    {
      kind: "template",
      assetId: notebook.templateAssetId,
      checksum: notebook.templateChecksum,
      filename: undefined,
      runtimeProfileId: notebook.runtimeProfileId,
      runtimeProfileVersion: notebook.runtimeProfileVersion,
    },
    ...(notebook.datasets ?? []).map((dataset) => ({
      kind: "dataset" as const,
      ...dataset,
      runtimeProfileId: notebook.runtimeProfileId,
      runtimeProfileVersion: notebook.runtimeProfileVersion,
    })),
  ];
}

/** Validates trusted storage snapshots against the immutable assignment dependency declaration. */
export function validateNotebookDependencies(
  value: NotebookAssignment,
  snapshots: readonly NotebookDependencySnapshot[],
): NotebookContractIssue[] {
  const dependencies = collectNotebookDependencies(value);
  const byId = new Map(
    snapshots.map((snapshot) => [snapshot.assetId, snapshot]),
  );
  const issues: NotebookContractIssue[] = [];
  let datasetBytes = 0;
  for (const dependency of dependencies) {
    const snapshot = byId.get(dependency.assetId);
    if (!snapshot) {
      issues.push({ code: "missing", assetId: dependency.assetId });
      continue;
    }
    if (snapshot.checksum !== dependency.checksum)
      issues.push({
        code: "checksum_mismatch",
        assetId: dependency.assetId,
        field: "checksum",
      });
    if (dependency.kind === "template") {
      if (
        snapshot.mime !== NOTEBOOK_MIME ||
        !snapshot.filename.toLowerCase().endsWith(".ipynb")
      ) {
        issues.push({
          code: "mime_mismatch",
          assetId: dependency.assetId,
          field: "mime",
        });
      }
      continue;
    }
    datasetBytes += snapshot.sizeBytes;
    const declaredExtension = dependency.filename
      ?.split(".")
      .pop()
      ?.toLowerCase();
    const allowedMime =
      declaredExtension === "csv"
        ? snapshot.mime === "text/csv"
        : snapshot.mime === "application/json";
    if (!allowedMime)
      issues.push({
        code: "mime_mismatch",
        assetId: dependency.assetId,
        field: "mime",
      });
    if (snapshot.filename !== dependency.filename)
      issues.push({
        code: "filename_mismatch",
        assetId: dependency.assetId,
        field: "filename",
      });
    if (
      !Number.isSafeInteger(snapshot.sizeBytes) ||
      snapshot.sizeBytes < 0 ||
      snapshot.sizeBytes > NOTEBOOK_DATASET_MAX_BYTES
    ) {
      issues.push({
        code: "file_too_large",
        assetId: dependency.assetId,
        field: "sizeBytes",
      });
    }
  }
  if (datasetBytes > NOTEBOOK_DATASETS_TOTAL_MAX_BYTES)
    issues.push({
      code: "total_too_large",
      assetId: value.templateAssetId,
      field: "datasets",
    });
  return issues;
}

export type NotebookSubmissionArtifact = {
  id: string;
  ownerId: string;
  courseId: string;
  courseVersionId: string | null;
  itemId: string;
  blockId: string | null;
  purpose: "template" | "dataset" | "draft" | "submission";
  status: "pending" | "ready";
  checksum: string;
  templateAssetId: string | null;
  templateChecksum: string | null;
  runtimeProfileId: string;
  runtimeProfileVersion: string;
  sizeBytes: number;
  mime: string;
  filename: string;
  storagePath: string;
};

export type NotebookSubmissionExpectation = Pick<
  NotebookSubmissionArtifact,
  | "ownerId"
  | "courseId"
  | "courseVersionId"
  | "itemId"
  | "blockId"
  | "templateAssetId"
  | "templateChecksum"
  | "runtimeProfileId"
  | "runtimeProfileVersion"
>;

export function validateNotebookSubmissionArtifact(
  artifact: NotebookSubmissionArtifact,
  expected: NotebookSubmissionExpectation,
): NotebookContractIssue[] {
  const issues: NotebookContractIssue[] = [];
  if (artifact.purpose !== "submission")
    issues.push({
      code: "purpose_mismatch",
      assetId: artifact.id,
      field: "purpose",
    });
  if (artifact.status !== "ready")
    issues.push({
      code: "status_mismatch",
      assetId: artifact.id,
      field: "status",
    });
  if (!ChecksumSchema.safeParse(artifact.checksum).success)
    issues.push({
      code: "checksum_mismatch",
      assetId: artifact.id,
      field: "checksum",
    });
  if (
    !Number.isSafeInteger(artifact.sizeBytes) ||
    artifact.sizeBytes < 0 ||
    artifact.sizeBytes > NOTEBOOK_MAX_BYTES
  ) {
    issues.push({
      code: "file_too_large",
      assetId: artifact.id,
      field: "sizeBytes",
    });
  }
  if (artifact.mime !== NOTEBOOK_MIME)
    issues.push({ code: "mime_mismatch", assetId: artifact.id, field: "mime" });
  if (!artifact.filename.toLowerCase().endsWith(".ipynb"))
    issues.push({
      code: "filename_mismatch",
      assetId: artifact.id,
      field: "filename",
    });
  for (const field of [
    "ownerId",
    "courseId",
    "courseVersionId",
    "itemId",
    "blockId",
    "templateAssetId",
    "templateChecksum",
    "runtimeProfileId",
    "runtimeProfileVersion",
  ] as const) {
    if (artifact[field] !== expected[field])
      issues.push({ code: "provenance_mismatch", assetId: artifact.id, field });
  }
  return issues;
}
