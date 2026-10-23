/** The runtime must have a separate origin: notebook code must never share app credentials. */
export function notebookRuntimeUrl(
  value = process.env.NEXT_PUBLIC_NOTEBOOK_RUNTIME_URL,
  app = process.env.NEXT_PUBLIC_APP_URL,
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.hash ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          local &&
          process.env.NODE_ENV !== "production"
        ))
    )
      return null;
    if (app && url.origin === new URL(app).origin) return null;
    return url.href;
  } catch {
    return null;
  }
}
