"""Soferia local library server.

Serves an exported v7 library (from tools/library-export/export_v7.py) to the
Soferia app, exactly the way Sefaria's MobileContentServer does:

    GET /packageData?package=<PACKAGE>&schema_version=7
        -> ["static/ios-export/7/bundles/<PACKAGE>/1.zip", ...]
    GET /static/ios-export/7/<file>            (toc.json, last_updated.json, ...)
    GET /static/ios-export/7/bundles/<PACKAGE>/<N>.zip

The app requests paths percent-encoded as a whole ("%2F" slashes included;
that is how encodeURIComponent builds them), so every path is unquoted before
matching.

Run:  python tools/server/serve.py --export <export_dir> [--port 5200]
The app's DOWNLOAD_SERVER should be http://<this machine's IP>:5200
(inside the Android emulator use http://10.0.2.2:5200).
"""

from __future__ import annotations

import argparse
import json
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SCHEMA_VERSION = "7"
STATIC_PREFIX = f"/static/ios-export/{SCHEMA_VERSION}"


class Handler(BaseHTTPRequestHandler):
    export_dir: Path = None  # type: ignore[assignment]

    # -- plumbing ----------------------------------------------------------
    def log_message(self, fmt, *args):  # quieter
        pass

    def send_bytes(self, data: bytes, ctype: str, status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        # (chunked copy: bundles can be 100 MB)
        if ctype.startswith("application/zip"):
            view = memoryview(data)
            for i in range(0, len(view), 1 << 20):
                self.wfile.write(view[i:i + (1 << 20)])
        else:
            self.wfile.write(data)

    def not_found(self):
        self.send_bytes(b"not found", "text/plain; charset=utf-8", 404)

    # -- HTTP --------------------------------------------------------------
    def do_GET(self):
        raw = urllib.parse.unquote(self.path)   # (%2F paths from the app decode here)
        path, _, query = raw.partition("?")

        if path.startswith("/packageData"):
            pkg = ""
            for kv in query.split("&"):
                k, _, v = kv.partition("=")
                if k == "package":
                    pkg = v.replace("+", " ")
            data = self.package_data(pkg)
            if data is None:
                return self.not_found()
            return self.send_bytes(json.dumps(data).encode(), "application/json")

        if path.startswith(STATIC_PREFIX):
            rel = path[len(STATIC_PREFIX):].lstrip("/")
            file = (self.export_dir / rel).resolve()
            root = self.export_dir.resolve()
            if not file.is_file() or not str(file).startswith(str(root)):
                return self.not_found()
            ctype = "application/zip" if file.suffix == ".zip" else "application/json"
            return self.send_bytes(file.read_bytes(), ctype)

        return self.not_found()

    # -- packageData -------------------------------------------------------
    def package_data(self, package: str):
        """The bundle files of one package, with paths relative to the server root."""
        bundles = self.export_dir / "bundles" / package
        if not bundles.is_dir():
            return None
        names = sorted(
            (p.name for p in bundles.glob("*.zip")),
            key=lambda n: int(n.split(".")[0]) if n.split(".")[0].isdigit() else 9999)
        return [f"static/ios-export/{SCHEMA_VERSION}/bundles/{package}/{n}" for n in names]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--export", required=True)
    ap.add_argument("--port", type=int, default=5200)
    ap.add_argument("--host", default="")
    args = ap.parse_args()
    Handler.export_dir = Path(args.export).resolve()
    addr = args.host or "0.0.0.0"
    server = ThreadingHTTPServer((addr, args.port), Handler)
    print(f"Serving {Handler.export_dir} on port {args.port} (http://<PC-IP>:{args.port})")
    print(f"  emulator address for the app: http://10.0.2.2:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
