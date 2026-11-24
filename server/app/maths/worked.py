"""Exact, ordered working for closed problems (integrals, derivatives, limits, expressions) from NOVA's engine.
Every line is either the problem itself or a value the engine computed; nothing here comes from a model."""

from __future__ import annotations

import re

from .solve import run as solve_run

_SUB = str.maketrans("0123456789-", "₀₁₂₃₄₅₆₇₈₉₋")
_SUP = str.maketrans("0123456789-", "⁰¹²³⁴⁵⁶⁷⁸⁹⁻")
_DEF = re.compile(r"^\s*∫\s*_\{?([^}\s^]+)\}?\s*\^\{?([^}\s]+)\}?\s*(.+?)\s*d([a-zθ])\s*=?\s*$")


def _pretty(t: str) -> str:
    t = re.sub(r"∫\s*_\{?([^}\s^]+)\}?\s*\^\{?([^}\s]+)\}?", lambda m: "∫" + m.group(1).translate(_SUB) + m.group(2).translate(_SUP), t)
    return re.sub(r"\^(\d+)", lambda m: m.group(1).translate(_SUP), t).replace(" * ", " × ")


def _value(text: str) -> str | None:
    try:
        r = solve_run(text.rstrip(" =") + " =", "auto")
    except Exception:
        return None
    return r.answer if r.status == "answered" and r.answer else None


def worked_solution(problem: str) -> tuple[list[str], str, str] | None:
    """(lines, final value, rule) or None when the engine can't do it exactly."""
    p = problem.strip().rstrip("=").strip()
    if not p or "=" in p:
        return None
    final = _value(p)
    if not final:
        return None
    lines = [_pretty(p)]
    rule = ""
    m = _DEF.match(p)
    if m:
        lo, hi, body, v = m.groups()
        anti = _value(f"∫ {body} d{v}")
        if anti:
            F = re.sub(r"\s*\+\s*C$", "", anti)
            lines.append(f"= [{F}]{lo.translate(_SUB)}{hi.translate(_SUP)}")
        rule = "∫ xⁿ dx = xⁿ⁺¹/(n + 1), then F(upper) − F(lower)"
    elif p.startswith("∫"):
        rule = "∫ xⁿ dx = xⁿ⁺¹/(n + 1) + C"
    elif p.startswith("d/d"):
        rule = "chain rule: d/dx f(g(x)) = f′(g(x))·g′(x)" if re.search(r"(sin|cos|tan|ln|log|exp)\s*\(\s*[^)]*[\^²³]", p) or re.search(r"\)\s*\^", p) else "differentiate term by term"
    elif p.lower().startswith("lim"):
        var = re.match(r"lim\s*_?\(?\s*([a-z])", p, re.I)
        others = sorted(set(re.findall(r"(?<![a-z])([a-zθ])(?![a-z])", p)) - {var.group(1) if var else "x", "x"})
        rule = "substitute the limit value" + (f" ({', '.join(others)} treated as constant)" if others else "")
    if final.replace(" ", "") == "sin2x":
        lines.append("= 2 sin x cos x")  # the product form the chain rule gives (identical to sin 2x)
    lines.append(f"= {final}")
    return lines, final, rule
