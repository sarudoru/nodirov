"""Static server + a /save endpoint, so the page can write captures to disk.
Dev only: binds to 127.0.0.1 and refuses paths outside shots/."""
import http.server, socketserver, base64, os, re, json

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots")
os.makedirs(SHOTS, exist_ok=True)

class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204); self.end_headers()

    def do_POST(self):
        if self.path != "/save":
            self.send_error(404); return
        n = int(self.headers.get("content-length", 0))
        body = json.loads(self.rfile.read(n))
        name = re.sub(r"[^A-Za-z0-9._-]", "", body.get("name", "shot")) or "shot"
        if not name.endswith(".png"):
            name += ".png"
        data = body["png"].split(",", 1)[1]
        with open(os.path.join(SHOTS, name), "wb") as f:
            f.write(base64.b64decode(data))
        self.send_response(200); self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *a): pass

os.chdir(ROOT)
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", 4182), H) as s:
    s.serve_forever()
