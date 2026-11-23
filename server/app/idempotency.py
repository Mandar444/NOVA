"""Bounded in-memory idempotency: same requestId + same payload joins/reuses; different payload -> 409."""

from __future__ import annotations

import asyncio
import hashlib
import json
import time
from typing import Any, Awaitable, Callable

from .config import IDEMPOTENCY_TTL_S
from .errors import ApiError

MAX_ENTRIES = 256


class IdempotencyCache:
    def __init__(self) -> None:
        self._entries: dict[str, tuple[str, float, asyncio.Task]] = {}
        self._waiters: dict[str, int] = {}

    @staticmethod
    def fingerprint(route: str, payload: Any) -> str:
        blob = json.dumps(payload, sort_keys=True, default=str).encode()
        return hashlib.sha256(route.encode() + b"|" + blob).hexdigest()

    def _purge(self) -> None:
        now = time.monotonic()
        for key in [k for k, (_, t, _) in self._entries.items() if now - t > IDEMPOTENCY_TTL_S]:
            self._entries.pop(key, None)
        while len(self._entries) > MAX_ENTRIES:
            self._entries.pop(next(iter(self._entries)))

    async def run(self, request_id: str, fingerprint: str, factory: Callable[[], Awaitable[Any]]) -> Any:
        self._purge()
        entry = self._entries.get(request_id)
        if entry is not None:
            fp, _, task = entry
            if fp != fingerprint:
                raise ApiError("CONFLICT", "This requestId was already used with a different payload.", request_id, retryable=False)
            return await self._wait(request_id, task)
        task = asyncio.ensure_future(factory())
        self._entries[request_id] = (fingerprint, time.monotonic(), task)
        try:
            return await self._wait(request_id, task)
        except BaseException:
            # failures are not cached, so an explicit retry with the same id re-runs
            if not task.done() or task.cancelled() or task.exception() is not None:
                self._entries.pop(request_id, None)
            raise

    async def _wait(self, request_id: str, task: asyncio.Task) -> Any:
        """Await shared work; when the last waiter goes away (the client gave up), the work is cancelled, so an abandoned
        request does not keep the provider busy."""
        self._waiters[request_id] = self._waiters.get(request_id, 0) + 1
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            if self._waiters.get(request_id, 1) <= 1 and not task.done():
                task.cancel()
            raise
        finally:
            n = self._waiters.get(request_id, 1) - 1
            if n <= 0:
                self._waiters.pop(request_id, None)
            else:
                self._waiters[request_id] = n

    def clear(self) -> None:
        self._entries.clear()
        self._waiters.clear()


cache = IdempotencyCache()
