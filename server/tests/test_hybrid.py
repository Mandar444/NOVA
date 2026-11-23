"""Hybrid reader path: the exact engine answers/marks arithmetic from EITHER reader; hints are rule-based and never
reveal the answer; division by zero is explicit; closed expressions on both sides of = are checked."""
import asyncio
import re

import pytest

from app import services
from app.maths.hints import arith_hint


def run(t):
    return asyncio.run(services.auto(t, None, True))


@pytest.mark.parametrize("text, kind, verdict, answer", [
    ("3 + 2 =", "answer", None, "5"),
    ("3 + 2 = 6", "mark", "incorrect", None),
    ("3 + 2 = 5", "mark", "correct", None),
    ("91 - 23 =", "answer", None, "68"),
    ("9 / -23 =", "answer", None, "-9/23"),
    ("0.5 + 0.25 =", "answer", None, "0.75"),
    ("2 × 2 = 2 + 2", "mark", "correct", None),
    ("2 × 2 = 2 + 3", "mark", "incorrect", None),
    ("0 / 0 = 0", "mark", "incorrect", None),
    ("4 ÷ 0 =", "answer", None, "undefined"),
])
def test_engine_paths(text, kind, verdict, answer):
    r = run(text)
    assert r["kind"] == kind, r
    if verdict:
        assert r["verdict"] == verdict
    if answer:
        assert r["answer"] == answer


def test_division_by_zero_is_explicit():
    assert "undefined" in run("0 / 0 = 0")["message"].lower()


@pytest.mark.parametrize("text, expect", [
    ("3 × 4 = 7", "added"), ("3 + 4 = 12", "multiplied"), ("9 - 4 = 13", "added"), ("4 - 9 = 5", "order"),
    ("23 + 18 = 40", "one away"), ("47 + 38 = 75", "carrying"), ("0.5 + 0.25 = 7.5", "decimal"),
    ("2 + 3 × 4 = 20", "× and ÷ come before"), ("2 × 2 = 2 + 3", "each side"), ("7 - 9 = 2", "order"),
])
def test_hints_point_at_the_slip(text, expect):
    assert expect in arith_hint(text)


@pytest.mark.parametrize("text", ["3 × 4 = 7", "3 + 4 = 12", "23 + 18 = 40", "47 + 38 = 75", "2 + 3 × 4 = 20", "6 × 7 = 48"])
def test_hints_never_reveal_the_answer(text):
    lhs = text.split("=")[0]
    from fractions import Fraction
    toks = re.findall(r"\d+(?:\.\d+)?|[+\-×]", lhs)
    true = str(eval(lhs.replace("×", "*")))  # test-only oracle
    assert true not in arith_hint(text)


def test_wrong_mark_carries_hint():
    r = run("3 × 4 = 7")
    assert r["verdict"] == "incorrect" and "added" in r["message"]
