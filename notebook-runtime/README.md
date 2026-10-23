# VFuture notebook runtime

This directory builds a separate static JupyterLite origin. It contains the
Pyodide Python kernel, NumPy, pandas, Matplotlib, and the
`@vfuture/notebook-bridge` prebuilt JupyterLab extension. It contains no
notebook templates, user data, or application credentials.

## Build

The build uses Python 3.12 through `uv`, with Python and JavaScript dependencies
pinned in `uv.lock`, `browser-wheels.txt`, and `extension/package-lock.json`. Kernel support wheels are bundled locally and PyPI fallback is disabled.

```bash
cd notebook-runtime
VFUTURE_ALLOWED_PARENT_ORIGINS=https://app.example.com ./build.sh
```

`VFUTURE_ALLOWED_PARENT_ORIGINS` is a comma-separated allowlist of exact HTTPS
origins. Local development may use exact `http://localhost:PORT` or
`http://127.0.0.1:PORT` origins. The build writes the allowlist to the public
runtime config and to the CSP `frame-ancestors` directive in `vercel.json`;
wildcards are rejected.

Serve a completed build locally:

```bash
./serve.sh
# JupyterLab: http://localhost:3011/lab/index.html
```

The build also emits `.vercel/output` using Vercel's Build Output API.
After linking this directory to a separate static runtime project, deploy:

```bash
VFUTURE_ALLOWED_PARENT_ORIGINS=https://your-application.example ./build.sh
vercel deploy --prebuilt
```

For production, set `VERCEL_ENV=production`, rebuild with the approved HTTPS
application origin, and use `vercel deploy --prebuilt --prod`. Do not rely on
rewriting `vercel.json` during a remote Git build: Vercel reads that configuration
before the build. Never deploy into the main Next.js project. Configure the
application `NEXT_PUBLIC_NOTEBOOK_RUNTIME_URL` with the isolated `/lab/index.html`
URL and rebuild the application. Runtime `data:` workers support the kernel
library's Atomics capability probe; this does not change the application's CSP.
Headers enforce COOP `same-origin`, COEP `require-corp`, CORP `cross-origin`, and
explicit frame ancestors.

## Parent protocol

Messages use `channel: "vfuture:notebook:v1"`, `version: 1`, an opaque
16-128 character `session` nonce, and a request `id`. The bridge accepts
messages only when `event.source === window.parent` and `event.origin`
exactly matches the build-time origin.

The child repeats `HELLO` until it accepts `INIT`. Parent requests are the
fixed actions `INIT`, `RUN_SELECTED`, `RUN_ALL`, `INTERRUPT`, `RESTART`,
`EXPORT`, `DOWNLOAD`, `DISPOSE`, and `PING`. Arbitrary command names and code execution
strings are not accepted.

`INIT.payload` is:

```ts
{
  notebook: Nbformat4Notebook;
  datasets: Array<{
    filename: string;
    content: string;
    format: "text" | "base64";
  }>;
  readOnly?: boolean;
}
```

`INIT` writes only to volatile browser memory and opens the notebook without
executing cells. Opening may initialize the Python kernel; user code runs only
after an explicit run action. The child emits `READY` with
`{phase: "document", path}` and later
`{phase: "kernel", path, kernelName}`. Changes are debounced for 250 ms and
emitted as `CHANGED.payload = {notebook}`.

Every request receives:

```ts
{
  channel: "vfuture:notebook:v1";
  version: 1;
  session: string;
  type: "RESPONSE";
  id: string;
  ok: boolean;
  result?: unknown; // success
  error?: {code: string; message: string}; // failure
}
```

Notebook payloads and snapshots are capped at 5 MiB. Dataset decoded content is
capped at 20 MiB total. A new `INIT` or `DISPOSE` shuts down the old kernel,
closes its document, and deletes all previously supplied in-memory files.

`DOWNLOAD` creates a local .ipynb file inside the isolated frame, including when outputs exceed the server upload limit. Oversize output never disposes the live editor or silently discards source. No notebook contents or app credentials are sent to another host by this action.
