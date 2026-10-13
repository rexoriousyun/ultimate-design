"""A pass-through proxy in front of Ollama that turns model thinking off.

Qwen3-class models on Ollama think by default. Driven by Claude Code, they often plan the
whole design inside the thinking block and then end the turn without a single tool call
(seen 2026-09-18, twice in a row). Claude Code sends no `thinking` field for models it
doesn't know, and `alwaysThinkingEnabled: false` / MAX_THINKING_TOKENS=0 did not change
that, so the proxy adds `"thinking": {"type": "disabled"}` to every Messages request.
It also sets a low temperature when none is given, since near-random sampling makes
small models pick wrong tools or return nothing. Everything else, including streamed
responses, passes through unchanged.
"""

import json
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TEMPERATURE = 0.3
_server: ThreadingHTTPServer | None = None
_lock = threading.Lock()


def rewrite(path: str, body: bytes) -> bytes:
    # Claude Code posts to /v1/messages?beta=true, so compare without the query string.
    if not path.split("?")[0].rstrip("/").endswith("/v1/messages") or not body:
        return body
    data = json.loads(body)
    data["thinking"] = {"type": "disabled"}
    data.setdefault("temperature", TEMPERATURE)
    return json.dumps(data).encode()


def _handler(upstream: str):
    class Proxy(BaseHTTPRequestHandler):
        # HTTP/1.0: the response ends when the connection closes, which suits streaming.
        def _forward(self):
            length = int(self.headers.get("Content-Length") or 0)
            body = rewrite(self.path, self.rfile.read(length)) if length else None
            headers = {k: v for k, v in self.headers.items()
                       if k.lower() not in ("host", "content-length", "connection")}
            request = urllib.request.Request(upstream + self.path, body, headers, method=self.command)
            try:
                response = urllib.request.urlopen(request, timeout=3600)
            except urllib.error.HTTPError as err:
                response = err
            with response:
                self.send_response(response.status)
                for key, value in response.headers.items():
                    if key.lower() not in ("content-length", "transfer-encoding", "connection"):
                        self.send_header(key, value)
                self.end_headers()
                while chunk := response.read1(65536):
                    self.wfile.write(chunk)
                    self.wfile.flush()

        do_GET = do_POST = do_HEAD = _forward

        def log_message(self, *args):
            pass

    return Proxy


def start(upstream: str) -> str:
    """Start the proxy once per process and return its base URL."""
    global _server
    with _lock:
        if _server is None:
            _server = ThreadingHTTPServer(("127.0.0.1", 0), _handler(upstream.rstrip("/")))
            threading.Thread(target=_server.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{_server.server_address[1]}"
