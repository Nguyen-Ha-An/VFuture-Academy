"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { NotebookBridge } from "@/features/notebooks/bridge";
import { NotebookViewer } from "@/features/notebooks/ui/NotebookViewer";
import { WorkspaceSurface } from "@/features/workspace-ui/ui/WorkspaceSurface";
const example = {
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {},
  cells: [
    {
      id: "intro",
      cell_type: "markdown",
      metadata: {},
      source: "# Python data practice\nRead a CSV and draw a chart.",
    },
    {
      id: "data",
      cell_type: "code",
      metadata: {},
      source:
        "print('Python started')\nimport pandas as pd\nimport numpy as np\nimport matplotlib.pyplot as plt\ndf = pd.read_csv('scores.csv')\nprint(df['score'].mean())\nprint(np.arange(3))\ndf.plot(x='name', y='score', kind='bar')\nplt.show()",
      outputs: [],
      execution_count: null,
    },
  ],
};
export function NotebookRuntimePreview({
  runtimeUrl,
}: {
  runtimeUrl: string | null;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const bridge = useRef<NotebookBridge | null>(null);
  const [trace, setTrace] = useState("No bridge messages");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [value, setValue] = useState<unknown>(example);
  useEffect(() => {
    const log = (event: MessageEvent) => {
      if (event.data?.channel === "vfuture:notebook:v1")
        setTrace(
          `${event.origin}: ${event.data.type} (expected frame: ${event.source === frame.current?.contentWindow})`,
        );
    };
    window.addEventListener("message", log);
    return () => {
      window.removeEventListener("message", log);
      bridge.current?.dispose();
    };
  }, []);
  const connect = useCallback(() => {
    if (!runtimeUrl || !frame.current?.contentWindow) return;
    bridge.current?.dispose();
    let started = false;
    const b = new NotebookBridge(
      frame.current.contentWindow,
      new URL(runtimeUrl).origin,
      setValue,
      () => {
        if (started) return;
        started = true;
        void b
          .request("INIT", {
            notebook: example,
            datasets: [
              {
                filename: "scores.csv",
                content: "name,score\nAn,8\nBinh,10\n",
                format: "text",
              },
            ],
          })
          .then(() => setReady(true))
          .catch((e) => setError(String(e)));
      },
      setError,
    );
    bridge.current = b;
  }, [runtimeUrl]);
  useEffect(() => {
    connect();
    return () => bridge.current?.dispose();
  }, [connect]);
  return (
    <WorkspaceSurface theme="system" className="vf-learner-refined">
      <main className="bg-background text-foreground min-h-screen space-y-5 p-5">
        <h1 className="text-2xl font-semibold">Notebook runtime preview</h1>
        <p>
          This development-only fixture uses the real runtime, without
          authentication or saving learner data.
        </p>
        <p role="status">{ready ? "Runtime ready" : "Loading runtime"}</p>
        <p>{trace}</p>
        {error ? <p role="alert">{error}</p> : null}
        <button className="min-h-11 rounded border px-4" onClick={connect}>
          Reconnect runtime
        </button>
        <button
          className="min-h-11 rounded border px-4"
          onClick={() =>
            void bridge.current
              ?.request("INTERRUPT")
              .catch((e) => setError(String(e)))
          }
        >
          Stop Python
        </button>
        <button
          disabled={!ready}
          className="min-h-11 rounded border px-5"
          onClick={() =>
            void bridge.current
              ?.request("RUN_ALL")
              .catch((e) => setError(String(e)))
          }
        >
          Run Python
        </button>
        {runtimeUrl ? (
          <iframe
            ref={frame}
            title="JupyterLite preview"
            src={runtimeUrl}
            sandbox="allow-scripts allow-same-origin allow-downloads"
            allow="cross-origin-isolated"
            onLoad={connect}
            className="h-[65dvh] w-full border"
          />
        ) : (
          <p>Set NEXT_PUBLIC_NOTEBOOK_RUNTIME_URL to the isolated runtime.</p>
        )}
        <h2 className="text-xl font-semibold">Captured notebook output</h2>
        <NotebookViewer notebook={value} locale="en" />
      </main>
    </WorkspaceSurface>
  );
}
