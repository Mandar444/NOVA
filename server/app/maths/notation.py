"""Notation problems that must be settled WITH the student before NOVA computes anything.

Never silently: add a dx, decide the scope of a square ("sin x²"), turn dy/dx into d/dx, or add "=".
Each issue returns one focused question with the candidate readings (full replacement texts); the client applies the
student's choice as a confirmed correction (no OCR) and asks again.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

_FUNCS = {"sin", "cos", "tan", "sec", "csc", "cot", "log", "ln", "exp", "sqrt", "lim", "d"}


@dataclass
class Issue:
    kind: str  # missing_differential | power_scope | derivative_or_equation | differential_equation
    question: str
    options: list[dict] = field(default_factory=list)  # {"label", "text"}
    allow_edit: bool = True
    template: str | None = None  # an editable starting point for "type it" (never with invented values)


def _sup(s: str) -> str:
    return s.replace("^2", "²").replace("^3", "³")


def _candidates(body: str) -> list[str]:
    words = re.sub(r"\b(" + "|".join(sorted(_FUNCS, key=len, reverse=True)) + r")\b", " ", body)
    return sorted({c for c in re.findall(r"(?<![A-Za-z])([a-zθ])(?![A-Za-z])", words) if c not in ("e",)})


def _split_eq(text: str) -> tuple[str, str]:
    t = text.rstrip()
    return (t[:-1].rstrip(), " =") if t.endswith("=") else (t, "")


_COEF_BEFORE = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s*∫(?!\s*_)")  # "1166 ∫ x^2": coefficient, or a misread upper limit?
_ONLY_UPPER = re.compile(r"∫\s*\^\s*\{?([^}\s]+)\}?")  # "∫^2 x^2": the lower limit is missing
_ONLY_LOWER = re.compile(r"∫\s*_\s*\{?([^}\s^]+)\}?(?!\s*\^)")  # "∫_0 x^2": the upper limit is missing


def limits_issue(text: str) -> Issue | None:
    """A definite integral whose limits are doubtful: never solve a guess. Explicit "3 * ∫" is a confirmed coefficient."""
    if "∫" not in text:
        return None
    m = _COEF_BEFORE.match(text)
    if m:
        n, rest = m.group(1), text[m.end():].strip()
        return Issue("limit_or_coefficient", f"Is {n} a number multiplying the integral, or the integral's upper limit?",
                     [{"label": f"{n} × the integral", "text": f"{n} * ∫ {rest}"}],
                     template=f"∫_?^{n} {rest}")
    m = _ONLY_UPPER.search(text)
    if m and not re.search(r"∫\s*_", text):
        return Issue("missing_lower_limit", f"The integral has an upper limit ({m.group(1)}) but no lower limit. What is the lower limit?", [],
                     template=text.replace(m.group(0), f"∫_?^{m.group(1)}", 1))
    m = _ONLY_LOWER.search(text)
    if m:
        return Issue("missing_upper_limit", f"The integral has a lower limit ({m.group(1)}) but no upper limit. What is the upper limit?", [],
                     template=text.replace(m.group(0), f"∫_{m.group(1)}^?", 1))
    if re.search(r"∫\s*_\s*\??\s*\^|\^\s*\?", text) or "_?" in text:
        return Issue("unknown_limit", "One of the integral's limits is still a “?”. Type the number.", [], template=text)
    return None


def integral_issue(text: str) -> Issue | None:
    """∫ with no differential: preserve integrand and bounds; offer the only candidate variable, or ask which."""
    if "∫" not in text and not re.search(r"\bintegral\b", text, re.I):
        return None
    core, tail = _split_eq(text)
    after = core.split("∫", 1)[1] if "∫" in core else core
    if re.search(r"(?<![A-Za-z])d[a-zθ](?![A-Za-z])", after):
        return None
    body = re.sub(r"^\s*_\{?[^}\s^]*\}?\s*\^\{?[^}\s]*\}?", "", after)  # bounds are not the integrand
    cands = _candidates(body) or []
    if len(cands) == 1:
        v = cands[0]
        return Issue("missing_differential", f"The integral has no d{v}. Integrate with respect to {v}?",
                     [{"label": f"Use d{v}", "text": f"{core} d{v}{tail}"}])
    opts = cands or ["x"]
    return Issue("missing_differential", "The integral has no dx. Which variable is it integrated with respect to?",
                 [{"label": f"d{v}", "text": f"{core} d{v}{tail}"} for v in opts])


_DYDX = re.compile(r"^\s*d\s*([a-z])\s*/\s*d\s*([a-z])\s*(.*)$", re.I)
_DDX = re.compile(r"^\s*d\s*/\s*d\s*([a-z])\s*(.*)$", re.I)
_SCOPE = re.compile(r"\b(sin|cos|tan|ln|log)\s*([a-zθ])\s*(\^\s*\d|[²³])")


def _scope_readings(expr: str) -> tuple[str, str] | None:
    """'sin x^2' → ('sin(x^2)', '(sin x)^2'); None when the scope is written explicitly."""
    m = _SCOPE.search(expr)
    if not m:
        return None
    f, v, p = m.group(1), m.group(2), m.group(3).replace(" ", "")
    p = {"²": "^2", "³": "^3"}.get(p, p)
    inner = expr[: m.start()] + f"{f}({v}{p})" + expr[m.end():]
    outer = expr[: m.start()] + f"({f} {v}){p}" + expr[m.end():]
    return inner, outer


def derivative_issue(text: str) -> Issue | None:
    core, tail = _split_eq(text)
    m = _DYDX.match(core)
    if m and m.group(1).lower() not in ("/",):
        dep, var, rest = m.group(1), m.group(2), m.group(3).strip()
        if rest.startswith("="):
            return None  # an explicit differential equation: handled separately, never "solved" as algebra
        if not rest:
            return None
        expr = rest.strip("() ") if rest.startswith("(") and rest.endswith(")") else rest
        opts = []
        sc = _scope_readings(expr)
        if sc:
            opts += [{"label": f"Differentiate {_sup(sc[0])}", "text": f"d/d{var}({sc[0]}){tail}"},
                     {"label": f"Differentiate {_sup(sc[1])}", "text": f"d/d{var}({sc[1]}){tail}"},
                     {"label": f"d{dep}/d{var} = {_sup(sc[0])} (an equation)", "text": f"d{dep}/d{var} = {sc[0]}"}]
        else:
            opts += [{"label": f"Differentiate {_sup(expr)}", "text": f"d/d{var}({expr}){tail}"},
                     {"label": f"d{dep}/d{var} = {_sup(expr)} (an equation)", "text": f"d{dep}/d{var} = {expr}"}]
        return Issue("derivative_or_equation", f"What does “d{dep}/d{var} {_sup(rest)}” mean?", opts)
    m = _DDX.match(core)
    if m:
        var, rest = m.group(1), m.group(2).strip()
        if rest.startswith("(") and rest.endswith(")") and rest.count("(") == 1:
            rest_inner = rest[1:-1]
        else:
            rest_inner = rest
        sc = _scope_readings(rest_inner)
        if sc and not re.search(r"\(\s*(sin|cos|tan|ln|log)\s*\(", rest):
            return Issue("power_scope", f"Which do you mean by “{_sup(rest_inner)}”?",
                         [{"label": f"Differentiate {_sup(sc[0])}", "text": f"d/d{var}({sc[0]}){tail}"},
                          {"label": f"Differentiate {_sup(sc[1])}", "text": f"d/d{var}({sc[1]}){tail}"}])
    return None


def differential_equation(text: str) -> tuple[str, str, str] | None:
    """'dy/dx = sin(x^2)' → ('y', 'x', 'sin(x^2)'); a differential equation, not algebra."""
    m = re.match(r"^\s*d\s*([a-z])\s*/\s*d\s*([a-z])\s*=\s*(.+?)\s*$", text, re.I)
    return (m.group(1), m.group(2), m.group(3)) if m and m.group(3).strip() else None


def notation_issue(text: str) -> Issue | None:
    return limits_issue(text) or integral_issue(text) or derivative_issue(text)
