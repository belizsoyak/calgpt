"""Local stand-in for the ESP32 pedal — for testing the hardware bridge
without real hardware.

- POST /params : accept flat params (what firmware/calgpt_pedal.ino does),
                 print them to the console, and return 200.
- GET  /       : a small dashboard showing the LAST params received, so you can
                 watch the bridge work in a browser. Auto-refreshes every 2s.

Run it:
    python mock_pedal.py            # listens on 127.0.0.1:9000

Then point /pedal at it (host:port, NO http:// prefix):
    curl -X POST http://localhost:8000/pedal -H "Content-Type: application/json" \\
      -d '{"vibe":"warm blues with slapback","esp_ip":"127.0.0.1:9000"}'

Open http://127.0.0.1:9000/ to watch the pushed params live.
"""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

HOST = "127.0.0.1"
PORT = 9000

last_params = None
last_count = 0


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        global last_params, last_count
        if self.path != "/params":
            self.send_response(404)
            self.end_headers()
            return
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n).decode()
        last_params = json.loads(body)
        last_count += 1
        print(f"MOCK PEDAL received /params (#{last_count}):")
        print(json.dumps(last_params, indent=2), flush=True)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def do_GET(self):
        if self.path != "/":
            self.send_response(404)
            self.end_headers()
            return
        if last_params is None:
            inner = "<p style='color:#888'>No params received yet. Fire a POST /pedal call.</p>"
        else:
            rows = "".join(
                f"<tr><td style='padding:4px 16px 4px 0;color:#a78bfa'>{k}</td>"
                f"<td style='font-family:monospace'>{v}</td></tr>"
                for k, v in last_params.items()
            )
            inner = f"<p>Updates received: <b>{last_count}</b></p><table>{rows}</table>"
        html = f"""<!doctype html><html><head><meta charset='utf-8'>
<meta http-equiv='refresh' content='2'>
<title>CalGPT Mock Pedal</title></head>
<body style='background:#09090b;color:#e4e4e7;font-family:sans-serif;padding:40px'>
<h1 style='color:#a78bfa'>🎛️ CalGPT Mock Pedal</h1>
<p style='color:#888'>Last params pushed from the backend (auto-refreshes every 2s):</p>
{inner}
</body></html>"""
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(html.encode())

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print(f"CalGPT mock pedal listening on http://{HOST}:{PORT}")
    HTTPServer((HOST, PORT), Handler).serve_forever()
