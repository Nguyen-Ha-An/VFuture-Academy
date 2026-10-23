import { NotebookWorkspace } from "@/features/notebooks/ui/NotebookWorkspace";
import { notebookRuntimeUrl } from "@/features/notebooks/config";
import { NotebookLocatorSchema } from "@/features/notebooks/upload-contract";
import { requireUser } from "@/lib/auth";
import { notFound } from "next/navigation";
export default async function NotebookPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string; itemId: string }>;
  searchParams: Promise<{ blockId?: string }>;
}) {
  await requireUser();
  const [ids, query] = await Promise.all([params, searchParams]);
  const parsed = NotebookLocatorSchema.safeParse({
    ...ids,
    blockId: query.blockId ?? null,
  });
  if (!parsed.success) notFound();
  return (
    <NotebookWorkspace
      locator={parsed.data}
      studio={true}
      runtimeUrl={notebookRuntimeUrl()}
    />
  );
}
