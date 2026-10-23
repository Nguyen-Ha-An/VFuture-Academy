from __future__ import annotations

import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


RUNTIME_DIR = Path(__file__).resolve().parent
DIST_DIR = RUNTIME_DIR / "dist"
CONFIG_PATH = DIST_DIR / "lab" / "vfuture-runtime-config.json"


class IsolatedStaticHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST_DIR), **kwargs)

    def end_headers(self) -> None:
        config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        frame_ancestors = " ".join(config["allowedParentOrigins"])
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self' blob: data: https://cdn.jsdelivr.net; "
            "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob: "
            "https://cdn.jsdelivr.net; worker-src 'self' blob: data:; "
            "connect-src 'self' blob: data: https://cdn.jsdelivr.net; "
            "img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; "
            f"font-src 'self' data:; frame-ancestors {frame_ancestors}; "
            "object-src 'none'; base-uri 'self'",
        )
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()


if __name__ == "__main__":
    if not CONFIG_PATH.is_file():
        raise SystemExit("Build the runtime before serving it.")
    ThreadingHTTPServer(("127.0.0.1", 3011), IsolatedStaticHandler).serve_forever()
