"""Latency incident: arithmetic never reaches the model, one budget per attempt caps provider waits, abandoned work stops."""
import asyncio
import time
import uuid

import pytest
from fastapi.testclient import TestClient

from app import services
from app.idempotency import IdempotencyCache
from app.main import app
from app.providers import bharatcode
from app.providers.bharatcode import ModelReply

client = TestClient(app)


class CountingProvider:
    def __init__(self, delay=0.0, text='{"steps":["x"],"notes":[""],"answer":"x"}'):
        self.calls, self.delay, self.text = 0, delay, text

    async def generate(self, *a, **k):
        self.calls += 1
        await asyncio.sleep(self.delay)
        return ModelReply(text=self.text, latency_ms=int(self.delay * 1000), incomplete=False)


def auto_body(text, problem=None):
    return {"context": {"requestId": str(uuid.uuid4()), "pageId": "p", "contentRevision": 1, "regionId": "r1", "sourceHash": "h",
                        "selectionRevision": 0, "interpretationRevision": 1},
            "text": text, "problem": problem, "autoAnswer": True}


@pytest.mark.parametrize("text, problem, expect", [
    ("3 + 2 =", None, ("answer", "5")),
    ("3 + 2 = ?", "2x + 3 = 7", ("answer", "5")),  # a "?" and a problem on the page used to route to the model
    ("7 - 4 =", None, ("answer", "3")),
    ("6 × 7 =", None, ("answer", "42")),
    ("12 ÷ 4 =", None, ("answer", "3")),
    ("3 + 2 = 6", None, ("mark", "incorrect")),  # read literally, marked, never repaired
    ("3 + 2 = 5", None, ("mark", "correct")),
])
def test_arithmetic_is_answered_by_the_engine_only(monkeypatch, text, problem, expect):
    fake = CountingProvider()
    monkeypatch.setattr(services, "provider", fake)
    t0 = time.perf_counter()
    j = client.post("/api/v1/auto", json=auto_body(text, problem)).json()
    assert fake.calls == 0
    assert j["kind"] == expect[0]
    assert (j.get("answer") if expect[0] == "answer" else j.get("verdict")) == expect[1]
    assert time.perf_counter() - t0 < 8  # includes the maths library's first load


def test_algebra_line_is_not_auto_solved_by_the_arithmetic_path(monkeypatch):
    fake = CountingProvider()
    monkeypatch.setattr(services, "provider", fake)
    assert not services.is_plain_arithmetic("2x + 3 = 7")
    assert not services.is_plain_arithmetic("3 + 2")  # nothing asked
    assert services.is_plain_arithmetic("3 + 2 =")


def test_budget_header_caps_a_slow_provider(monkeypatch):
    # the real provider client, against a transport that never answers within the budget
    async def slow_post(self, *a, **k):
        await asyncio.sleep(30)

    import dataclasses
    monkeypatch.setattr(bharatcode, "settings", dataclasses.replace(bharatcode.settings, api_key="test-key"))
    import httpx
    monkeypatch.setattr(httpx.AsyncClient, "post", slow_post, raising=True)
    body = {"context": {"requestId": str(uuid.uuid4()), "pageId": "p", "contentRevision": 1, "regionId": "r1", "sourceHash": "h",
                        "selectionRevision": 0, "interpretationRevision": 0},
            "regionPng": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
            "regionWidth": 10, "regionHeight": 10}
    t0 = time.perf_counter()
    r = client.post("/api/v1/recognize", json=body, headers={"X-Nova-Deadline-Ms": "1500"})
    took = time.perf_counter() - t0
    assert r.status_code >= 400 and r.json()["error"]["code"] == "TIMEOUT"
    assert took < 4, took  # the budget, not 110 s
    assert "calls=1" in r.headers.get("x-nova-timing", "")  # one attempt, no hidden retry


def test_abandoned_work_is_cancelled_when_nobody_waits():
    cache = IdempotencyCache()
    started, finished = asyncio.Event(), {"done": False}

    async def work():
        started.set()
        await asyncio.sleep(5)
        finished["done"] = True

    async def scenario():
        waiter = asyncio.ensure_future(cache.run("rid", "fp", work))
        await started.wait()
        waiter.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiter
        await asyncio.sleep(0.05)
        entry = cache._entries.get("rid")
        return entry is None or entry[2].cancelled()

    assert asyncio.run(scenario()) is True
    assert finished["done"] is False


def test_doubtful_digit_in_a_finished_sum_asks_instead_of_answering(monkeypatch):
    class Reader:
        calls = 0

        async def generate(self, *a, **k):
            Reader.calls += 1
            return ModelReply(text='{"status":"incomplete","rawText":"1 + 2 =","alternatives":["7 + 2 ="],"needsClarification":true}', latency_ms=1, incomplete=False)

    monkeypatch.setattr(services, "provider", Reader())
    body = {"context": {"requestId": str(uuid.uuid4()), "pageId": "p", "contentRevision": 1, "regionId": "r1", "sourceHash": "h",
                        "selectionRevision": 0, "interpretationRevision": 0},
            "regionPng": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
            "regionWidth": 10, "regionHeight": 10}
    j = client.post("/api/v1/recognize", json=body).json()
    assert j["needsClarification"] is True and "7 + 2 =" in j["alternatives"]
