"""Per-request timing: how many provider calls a request made and how long they took (for X-Nova-Timing and the log)."""
import contextvars
from dataclasses import dataclass, field


@dataclass
class RequestTiming:
    calls: int = 0
    provider_ms: int = 0
    timeouts: int = 0
    notes: list[str] = field(default_factory=list)


CURRENT: contextvars.ContextVar[RequestTiming | None] = contextvars.ContextVar("nova_request_timing", default=None)


def record_call(ms: int, timed_out: bool = False) -> None:
    t = CURRENT.get()
    if t is not None:
        t.calls += 1
        t.provider_ms += ms
        t.timeouts += int(timed_out)


# The interactive attempt's end-to-end deadline (time.monotonic()), from the client's X-Nova-Deadline-Ms header.
# Provider calls use what is left of it instead of a fresh allowance per stage.
import time as _time

DEADLINE: contextvars.ContextVar[float | None] = contextvars.ContextVar("nova_deadline", default=None)


def remaining_s() -> float | None:
    d = DEADLINE.get()
    return None if d is None else d - _time.monotonic()
