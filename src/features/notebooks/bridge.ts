export const NOTEBOOK_CHANNEL = "vfuture:notebook:v1";
export type NotebookAction =
  | "INIT"
  | "RUN_SELECTED"
  | "RUN_ALL"
  | "INTERRUPT"
  | "RESTART"
  | "EXPORT"
  | "DOWNLOAD"
  | "PING";
type Pending = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};

/** No credentials or arbitrary Jupyter commands cross this boundary. */
export class NotebookBridge {
  readonly session = crypto.randomUUID();
  private pending = new Map<string, Pending>();
  private closed = false;
  private readonly receive: (event: MessageEvent) => void;

  get isClosed(): boolean {
    return this.closed;
  }

  constructor(
    private readonly frame: Window,
    private readonly origin: string,
    onChange: (notebook: unknown) => void,
    onHello?: () => void,
    onRuntimeError?: (message: string, code?: string) => void,
  ) {
    const parsed = new URL(origin);
    if (
      parsed.origin !== origin ||
      !["https:", "http:"].includes(parsed.protocol)
    )
      throw new Error("Invalid notebook origin");
    this.receive = (event) => {
      if (
        this.closed ||
        event.origin !== this.origin ||
        event.source !== this.frame
      )
        return;
      const message = event.data;
      if (
        !message ||
        message.channel !== NOTEBOOK_CHANNEL ||
        message.version !== 1
      )
        return;
      if (message.type === "HELLO") {
        onHello?.();
        return;
      }
      if (message.session !== this.session) return;
      if (message.type === "CHANGED" && message.payload?.notebook) {
        const serialized = JSON.stringify(message.payload.notebook);
        if (new TextEncoder().encode(serialized).byteLength > 5 * 1024 * 1024) {
          onRuntimeError?.(
            "Notebook exceeds 5 MiB. Clear large outputs or download a backup.",
            "PAYLOAD_TOO_LARGE",
          );
          return;
        }
        onChange(message.payload.notebook);
      }
      if (message.type === "ERROR")
        onRuntimeError?.(
          typeof message.payload?.message === "string"
            ? message.payload.message
            : "Notebook runtime error",
          typeof message.payload?.code === "string"
            ? message.payload.code
            : "RUNTIME_ERROR",
        );
      if (message.type !== "RESPONSE" || typeof message.id !== "string") return;
      const operation = this.pending.get(message.id);
      if (!operation) return;
      clearTimeout(operation.timer);
      this.pending.delete(message.id);
      if (message.ok) operation.resolve(message.result);
      else
        operation.reject(
          new Error(message.error?.message ?? "Notebook operation failed"),
        );
    };
    window.addEventListener("message", this.receive);
  }

  request(type: NotebookAction, payload?: unknown): Promise<unknown> {
    if (this.closed)
      return Promise.reject(new Error("Notebook workspace closed"));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          reject(
            new Error(
              "Notebook did not respond. Your saved work is still available.",
            ),
          );
        },
        type.startsWith("RUN") ? 180_000 : 60_000,
      );
      this.pending.set(id, { resolve, reject, timer });
      this.frame.postMessage(
        {
          channel: NOTEBOOK_CHANNEL,
          version: 1,
          session: this.session,
          id,
          type,
          payload,
        },
        this.origin,
      );
    });
  }

  dispose() {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener("message", this.receive);
    try {
      this.frame.postMessage(
        {
          channel: NOTEBOOK_CHANNEL,
          version: 1,
          session: this.session,
          id: crypto.randomUUID(),
          type: "DISPOSE",
        },
        this.origin,
      );
    } catch {
      // A navigation can detach the iframe before React cleanup runs.
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Notebook workspace closed"));
    }
    this.pending.clear();
  }
}
