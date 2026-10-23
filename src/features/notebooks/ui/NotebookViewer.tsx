/* eslint-disable @next/next/no-img-element -- bounded notebook PNG/JPEG output */
import { NotebookDocumentSchema } from "../contracts";
function text(value: unknown): string {
  return Array.isArray(value)
    ? value.filter((x) => typeof x === "string").join("")
    : typeof value === "string"
      ? value
      : "";
}
function isBase64(value: string): boolean {
  const normalized = value.replace(/[\r\n]/g, "");
  return (
    normalized.length > 0 &&
    normalized.length % 4 === 0 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      normalized,
    )
  );
}
export function NotebookViewer({
  notebook,
  locale = "vi",
}: {
  notebook: unknown;
  locale?: "vi" | "en";
}) {
  const parsed = NotebookDocumentSchema.safeParse(notebook);
  if (!parsed.success)
    return (
      <p role="alert">
        {locale === "vi"
          ? "File notebook không hợp lệ."
          : "Invalid notebook file."}
      </p>
    );
  return (
    <div className="min-w-0 space-y-5">
      {parsed.data.cells.map((cell, index) => (
        <section
          key={cell.id ?? index}
          className="min-w-0 rounded-lg border border-border bg-card p-4"
        >
          <p className="mb-2 text-xs text-muted-foreground">
            {locale === "vi" ? "Ô" : "Cell"} {index + 1} ·{" "}
            {cell.cell_type === "code"
              ? "Python"
              : locale === "vi"
                ? "Nội dung"
                : "Text"}
          </p>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words text-sm leading-7">
            <code>{text(cell.source)}</code>
          </pre>
          {cell.cell_type === "code" && Array.isArray(cell.outputs)
            ? cell.outputs.map((output, i) => {
                const value = output as Record<string, unknown>;
                const data = value.data as Record<string, unknown> | undefined;
                const content =
                  text(value.text) ||
                  text(data?.["text/plain"]) ||
                  text(value.traceback);
                const png = text(data?.["image/png"]);
                const jpeg = text(data?.["image/jpeg"]);
                const encoded = isBase64(png)
                  ? png
                  : isBase64(jpeg)
                    ? jpeg
                    : "";
                const safeImage =
                  encoded.length > 0 && encoded.length < 2 * 1024 * 1024;
                return (
                  <div
                    key={i}
                    className="mt-3 min-w-0 border-t border-border pt-3"
                  >
                    {content ? (
                      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-sm">
                        {content}
                      </pre>
                    ) : null}
                    {safeImage ? (
                      <img
                        src={`data:image/${png ? "png" : "jpeg"};base64,${encoded}`}
                        alt={
                          locale === "vi" ? "Kết quả biểu đồ" : "Plot output"
                        }
                        className="h-auto max-w-full"
                      />
                    ) : null}
                    {!content && !safeImage ? (
                      <p className="text-xs text-muted-foreground">
                        {locale === "vi"
                          ? "Định dạng kết quả này không được hiển thị."
                          : "This output format is not displayed."}
                      </p>
                    ) : null}
                  </div>
                );
              })
            : null}
        </section>
      ))}
    </div>
  );
}
