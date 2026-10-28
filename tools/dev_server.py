"""Local dev server: serves the app and lets the test page save training files.

POST /save?name=<file>.json writes the request body to training/<file>.json.
Only for local development; GitHub Pages serves the app as plain static files.

Usage: python tools/dev_server.py [port]
"""
import http.server, os, re, sys, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        name = urllib.parse.parse_qs(u.query).get("name", [""])[0]
        if u.path != "/save" or not re.fullmatch(r"[\w.-]+\.json", name):
            self.send_error(400, "POST /save?name=<file>.json")
            return
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        os.makedirs(os.path.join(ROOT, "training"), exist_ok=True)
        with open(os.path.join(ROOT, "training", name), "wb") as f:
            f.write(body)
        self.send_response(204)
        self.end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8792
    http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
