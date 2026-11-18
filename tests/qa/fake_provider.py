"""EMULATED provider for failure tests (no real model). OpenAI-style /chat/completions.
Markers in the student's question choose the behaviour: SLOW200 (never answers within the server's 110 s),
SLOW30 (answers after 30 s), FAIL503 (model busy). Otherwise answers at once. usage: python fake_provider.py 8013"""
import json
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        self._send(200, {"data": [{"id": "glm-5.3-flash"}]})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        text = json.dumps(body.get("messages", []))
        q = re.search(r"QUESTION: ([^\\]*)", text)
        q = q.group(1)[:60] if q else "?"
        print(time.strftime("%H:%M:%S"), "request:", q, flush=True)
        if "FAIL503" in text:
            return self._send(503, {"error": {"message": "busy (fake)"}})
        if "SLOW200" in text:
            time.sleep(200)
        elif "SLOW30" in text:
            time.sleep(30)
        reply = {"say": f"FAKE-REPLY to: {q}", "next": "Try the next line.", "actions": []}
        self._send(200, {"choices": [{"message": {"content": json.dumps(reply)}, "finish_reason": "stop"}]})


ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
