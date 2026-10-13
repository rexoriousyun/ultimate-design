import json
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from app import ollama_proxy


def test_rewrite_disables_thinking_on_messages_only():
    body = json.dumps({"model": "m", "thinking": {"type": "enabled", "budget_tokens": 5}}).encode()
    for path in ("/v1/messages", "/v1/messages?beta=true", "/v1/messages/"):
        assert json.loads(ollama_proxy.rewrite(path, body))["thinking"] == {"type": "disabled"}
    assert ollama_proxy.rewrite("/v1/messages/count_tokens", body) == body
    assert ollama_proxy.rewrite("/api/tags", b"") == b""


def test_rewrite_sets_temperature_only_when_missing():
    assert json.loads(ollama_proxy.rewrite("/v1/messages", b'{"model": "m"}'))["temperature"] == 0.3
    assert json.loads(ollama_proxy.rewrite("/v1/messages", b'{"temperature": 1}'))["temperature"] == 1


def test_proxy_forwards_rewritten_body_and_streams_back():
    seen = {}

    class Upstream(BaseHTTPRequestHandler):
        def do_POST(self):
            seen["path"] = self.path
            seen["body"] = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            for i in range(3):
                self.wfile.write(f"data: {i}\n\n".encode())

        def log_message(self, *a):
            pass

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
    threading.Thread(target=upstream.serve_forever, daemon=True).start()
    try:
        handler = ollama_proxy._handler(f"http://127.0.0.1:{upstream.server_address[1]}")
        proxy = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=proxy.serve_forever, daemon=True).start()
        req = urllib.request.Request(f"http://127.0.0.1:{proxy.server_address[1]}/v1/messages?beta=true",
                                     json.dumps({"model": "m", "stream": True}).encode(),
                                     {"Content-Type": "application/json"})
        with urllib.request.urlopen(req) as res:
            assert res.headers["Content-Type"] == "text/event-stream"
            assert res.read() == b"data: 0\n\ndata: 1\n\ndata: 2\n\n"
        assert seen["path"] == "/v1/messages?beta=true"
        assert seen["body"] == {"model": "m", "stream": True, "thinking": {"type": "disabled"},
                                "temperature": 0.3}
        proxy.shutdown()
    finally:
        upstream.shutdown()
