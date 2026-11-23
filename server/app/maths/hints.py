"""Rule-based teaching hints for arithmetic the exact engine has already marked WRONG. Instant (no model), and they never
state the correct answer: they point at the likely slip and leave the working to the student.

Only fires when the written line is closed arithmetic; anything else returns a neutral nudge.
"""
from __future__ import annotations

import re
from fractions import Fraction

_NUM = r"-?\d+(?:\.\d+)?"
_BIN = re.compile(rf"^\s*({_NUM})\s*([+\-−×x*÷/])\s*({_NUM})\s*=\s*({_NUM})\s*$")


def _f(s: str) -> Fraction:
    return Fraction(s)


def _norm(t: str) -> str:
    return t.replace("−", "-").replace("·", "×").replace("*", "×").replace("x", "×").replace(":", "÷")


def _eval_ltr(t: str) -> Fraction | None:
    """Left-to-right evaluation ignoring precedence (to spot the order-of-operations slip)."""
    toks = re.findall(rf"{_NUM}|[+\-×÷/]", t)
    if not toks or len(toks) % 2 == 0:
        return None
    try:
        v = _f(toks[0])
        for op, n in zip(toks[1::2], toks[2::2]):
            w = _f(n)
            v = v + w if op == "+" else v - w if op == "-" else v * w if op == "×" else v / w
        return v
    except (ZeroDivisionError, ValueError):
        return None


def _eval(t: str) -> Fraction | None:
    toks = re.findall(rf"{_NUM}|[+\-×÷/]", t)
    if not toks or len(toks) % 2 == 0:
        return None
    try:
        vals, ops = [_f(toks[0])], []
        for op, n in zip(toks[1::2], toks[2::2]):
            w = _f(n)
            if op in "×÷/":
                vals.append(vals.pop() * w if op == "×" else vals.pop() / w)
            else:
                ops.append(op); vals.append(w)
        v = vals[0]
        for op, w in zip(ops, vals[1:]):
            v = v + w if op == "+" else v - w
        return v
    except (ZeroDivisionError, ValueError):
        return None


def arith_hint(text: str) -> str:
    t = _norm(text)
    if t.count("=") != 1:
        return "Work it out again one step at a time."
    lhs, rhs = (s.strip() for s in t.split("="))
    if re.search(r"[+\-×÷/]", rhs.lstrip("-")):
        return "Work out each side on its own, then compare the two results."
    try:
        c = _f(rhs)
    except ValueError:
        return "Work it out again one step at a time."
    m = _BIN.match(t)
    if m:
        a, op, b = _f(m.group(1)), m.group(2), _f(m.group(3))
        v = _eval(lhs)
        if v is None:
            return "Work it out again one step at a time."
        if op in "×" and c == a + b:
            return "It looks like you added. × means groups: how much are that many groups altogether?"
        if op == "+" and c == a * b:
            return "It looks like you multiplied. + means putting the two amounts together."
        if op == "-" and c == a + b:
            return "It looks like you added. − means taking away."
        if op == "-" and c == b - a and a != b:
            return "Check the order: start with the first number and take the second away."
        if op in "÷/" and b != 0 and c == b / a:
            return "Check the order: divide the first number by the second."
        if c == -v and v != 0:
            return "Check the sign of your answer."
        if abs(c - v) == 1:
            return "Very close — count it again carefully; you're one away."
        if v.denominator == 1 and c.denominator == 1 and c != v and (c - v) % 10 == 0 and abs(c - v) in (10, 100, 1000):
            return "The last digit is right — check the carrying or borrowing in the next column."
        for k in (10, 100, 1000):
            if c * k == v or c == v * k:
                return "Check where the decimal point goes."
        return "Not quite — try it again, step by step."
    v, ltr = _eval(lhs), _eval_ltr(lhs)
    if v is not None and ltr is not None and ltr != v and c == ltr:
        return "Remember: × and ÷ come before + and −."
    return "Not quite — work through it again one step at a time."
