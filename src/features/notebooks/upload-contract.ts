import { z } from "zod";
import { ApiError } from "@/lib/api";

const UploadSchema = z
  .object({
    purpose: z.enum(["template", "dataset", "draft", "submission"]),
    filename: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type NotebookUpload = z.infer<typeof UploadSchema>;
export function checkUpload(value: unknown) {
  const input = UploadSchema.parse(value);
  const extension = input.filename.split(".").pop()?.toLowerCase();
  if (input.purpose === "dataset") {
    if (extension !== "csv" && extension !== "json")
      throw new ApiError(
        415,
        "NOTEBOOK_FILE_TYPE",
        "Datasets must be CSV or JSON",
      );
  } else if (extension !== "ipynb" || input.sizeBytes > 5 * 1024 * 1024) {
    throw new ApiError(
      extension !== "ipynb" ? 415 : 413,
      "NOTEBOOK_FILE_TYPE",
      "Notebook must be an .ipynb file at most 5 MiB",
    );
  }
  return {
    ...input,
    mime:
      extension === "csv"
        ? "text/csv"
        : extension === "json"
          ? "application/json"
          : "application/x-ipynb+json",
  };
}
export function validateRevision(value: unknown): number {
  return z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(value);
}
export const NotebookLocatorSchema = z
  .object({
    courseId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    itemId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    blockId: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
      .nullable()
      .default(null),
  })
  .strict();
export type NotebookLocator = z.infer<typeof NotebookLocatorSchema>;
