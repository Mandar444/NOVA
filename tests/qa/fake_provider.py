"""SIMULATED provider for deterministic failure / control-flow tests (no real model). OpenAI-style /chat/completions.
- Handwriting reads return the next text queued with POST /control {"readings": [...]} (default "1 + 1 =").
- Question-paper analysis returns two fixed questions.
- Tutor replies: markers in the student's question choose the behaviour: SLOW200 (never answers within the server's
  110 s), SLOW30 (answers after 30 s), FAIL503 (model busy), CUT (connection dropped, no response). Otherwise at once.
GET /log lists what was asked. usage: python fake_provider.py 8013"""
import json
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

readings: list[str] = []
log: list[dict] = []
lock = threading.Lock()


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

    def _content(self, obj):
        self._send(200, {"choices": [{"message": {"content": json.dumps(obj)}, "finish_reason": "stop"}]})

    def do_GET(self):
        if self.path.startswith("/log"):
            with lock:
                return self._send(200, log)
        self._send(200, {"data": [{"id": "glm-5.3-flash"}]})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        if self.path.startswith("/control"):
            with lock:
                if "readings" in body:
                    readings[:] = list(body["readings"])
                if body.get("clearLog"):
                    log.clear()
            return self._send(200, {"ok": True, "queued": readings})
        text = json.dumps(body.get("messages", []), ensure_ascii=False)
        t = time.strftime("%H:%M:%S")
        if "reader of children" in text:
            with lock:
                r = readings.pop(0) if readings else "1 + 1 ="
                log.append({"t": t, "kind": "recognize", "text": r})
            return self._content({"status": "incomplete" if r.rstrip().endswith("=") else "expression", "rawText": r, "alternatives": [], "needsClarification": False})
        if "preparing a question paper" in text:
            with lock:
                log.append({"t": t, "kind": "paper"})
            return self._content({"questions": [
                {"number": "1", "text": "Without actually performing the long division, state whether 7/75 has a terminating decimal expansion.", "lineIds": [], "bbox": [60, 180, 940, 260], "kind": "other", "options": [], "answer": "non-terminating repeating", "check": ""},
                {"number": "2", "text": "Find the value of k for which x = 2 is a solution of x + k = 5.", "lineIds": [], "bbox": [60, 300, 940, 360], "kind": "numeric", "options": [], "answer": "3", "check": "x + 3 = 5"},
            ]})
        q = re.search(r"QUESTION: ([^\\\"]*)", text)
        q = q.group(1)[:80] if q else "?"
        with lock:
            log.append({"t": t, "kind": "tutor", "question": q})
        if "FAIL503" in q:
            return self._send(503, {"error": {"message": "busy (simulated)"}})
        if "CUT" in q:
            self.close_connection = True
            try:
                self.connection.shutdown(2)
            except OSError:
                pass
            return
        if "SLOW200" in q:
            time.sleep(200)
        elif "SLOW30" in q:
            time.sleep(30)
        self._content({"say": f"SIM-REPLY to: {q}", "next": "Try the next line.", "detail": "", "actions": [
            {"type": "add_note", "anchorRegionId": "page", "text": f"SIM-NOTE {q[:30]}"}]})


ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
