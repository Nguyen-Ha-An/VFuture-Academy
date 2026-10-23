import { notFound } from "next/navigation";
import { NotebookRuntimePreview } from "./preview";
import { notebookRuntimeUrl } from "@/features/notebooks/config";
export default function NotebookPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <NotebookRuntimePreview runtimeUrl={notebookRuntimeUrl()} />;
}
