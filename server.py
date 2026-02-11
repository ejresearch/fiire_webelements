#!/usr/bin/env python3
"""FIIRE dev server — serves static files and proxies /api/chat to Anthropic."""

import http.server
import json
import os
import urllib.request
import urllib.error

PORT = int(os.environ.get("PORT", 8000))
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"


class FIIREHandler(http.server.SimpleHTTPRequestHandler):

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_POST(self):
        if self.path != "/api/chat":
            self.send_error(404)
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))

            api_key = body.get("apiKey", "")
            if not api_key:
                self._json_response(400, {"error": "Missing apiKey"})
                return

            payload = json.dumps({
                "model": body.get("model", "claude-sonnet-4-5-20250929"),
                "max_tokens": body.get("max_tokens", 1024),
                "system": body.get("system", ""),
                "messages": body.get("messages", []),
            }).encode()

            req = urllib.request.Request(
                ANTHROPIC_URL,
                data=payload,
                headers={
                    "Content-Type": "application/json",
                    "x-api-key": api_key,
                    "anthropic-version": ANTHROPIC_VERSION,
                },
                method="POST",
            )

            with urllib.request.urlopen(req, timeout=30) as resp:
                self._json_response(200, json.loads(resp.read()))

        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8", errors="replace")
            try:
                error_json = json.loads(error_body)
            except json.JSONDecodeError:
                error_json = {"error": error_body}
            self._json_response(e.code, error_json)
        except Exception as e:
            self._json_response(500, {"error": str(e)})

    def _json_response(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        if "/api/chat" in (args[0] if args else ""):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = http.server.HTTPServer(("", PORT), FIIREHandler)
    print(f"FIIRE dev server → http://localhost:{PORT}/studio.html")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()
