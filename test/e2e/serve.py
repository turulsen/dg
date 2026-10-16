"""Static server for the e2e suite: serves the site like GitHub Pages /
Firebase Hosting do -- a missing path gets 404.html with status 404 (so
old stats/ links forward). E2E_ROOT can point at another checkout (the
returning-device scenario serves an older build first, then this one)."""
import http.server, os, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8952
STATE = os.environ.get("E2E_ROOT_FILE", "")  # a file holding the current root, re-read per request


def root():
    if STATE and os.path.exists(STATE):
        r = open(STATE).read().strip()
        if r:
            return r
    return os.environ.get("E2E_ROOT", os.getcwd())


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=root(), **kw)

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_error(self, code, message=None, explain=None):
        page = os.path.join(root(), "404.html")
        if code == 404 and os.path.exists(page):
            body = open(page, "rb").read()
            self.send_response(404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
            return
        super().send_error(code, message, explain)


http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
