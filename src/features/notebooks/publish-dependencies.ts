import "server-only";
import { NotebookAssignmentSchema } from "./contracts";
import { resolveNotebookDependencies } from "./storage";
import { findNotebookAssignment } from "./access";

type PublishDependency = {
  itemId: string;
  blockId: string | null;
  runtimeMode: string;
  runtimeProfileId: string;
  runtimeProfileVersion: string;
  colabReason: string | null;
  assets: Array<{
    id: string;
    checksum: string;
    sizeBytes: number;
    purpose: string;
  }>;
};
/** Central review calls this before freezing a course snapshot. No writes or publication here. */
export async function validateNotebookWorkspaceDependencies(
  courseId: string,
  items: Record<string, unknown>,
): Promise<PublishDependency[]> {
  const dependencies: PublishDependency[] = [];
  for (const [itemId, document] of Object.entries(items)) {
    const visit = async (value: unknown): Promise<void> => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        for (const child of value) await visit(child);
        return;
      }
      const obj = value as Record<string, unknown>;
      if (obj.kind === "exam") return;
      if (
        (obj.kind === "assignment" || obj.type === "assignment") &&
        obj.notebook
      ) {
        const blockId = obj.kind === "assignment" ? null : String(obj.id);
        if (!findNotebookAssignment(document, blockId))
          throw new Error("Notebook assignment target is invalid");
        const config = NotebookAssignmentSchema.parse(obj.notebook);
        const rows = await resolveNotebookDependencies(
          {
            courseId,
            itemId,
            blockId,
            courseVersionId: null,
            notebook: config,
            studio: true,
          },
          config,
        );
        dependencies.push({
          itemId,
          blockId,
          runtimeMode: config.runtimeMode,
          runtimeProfileId: config.runtimeProfileId,
          runtimeProfileVersion: config.runtimeProfileVersion,
          colabReason: config.colabReason ?? null,
          assets: rows.map((row) => ({
            id: row.id,
            checksum: row.checksum,
            sizeBytes: row.size_bytes,
            purpose: row.purpose,
          })),
        });
      }
      for (const child of Object.values(obj))
        if (child && typeof child === "object") await visit(child);
    };
    await visit(document);
  }
  return dependencies.sort((a, b) =>
    `${a.itemId}:${a.blockId ?? ""}`.localeCompare(
      `${b.itemId}:${b.blockId ?? ""}`,
    ),
  );
}
