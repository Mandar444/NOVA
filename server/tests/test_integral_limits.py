"""Integral limits stay attached to the integral: never a coefficient by accident, never dropped, never invented."""
import uuid

from fastapi.testclient import TestClient

from app.main import app
from app.maths.notation import notation_issue
from app.maths.solve import warm_up
from app.maths.worked import worked_solution
from app.services import topic_expression

client = TestClient(app)
warm_up()


def solve(text):
    b = {"context": {"requestId": str(uuid.uuid4()), "pageId": "p", "contentRevision": 1, "regionId": "rP", "sourceHash": "h", "selectionRevision": 0, "interpretationRevision": 1},
         "intent": "solve", "question": "", "problem": {"regionId": "rP", "text": text, "accepted": True}, "current": None,
         "history": [], "plotExpression": None, "exam": None, "regionIds": ["rP"], "pageLines": []}
    return client.post("/api/v1/tutor", json=b).json()


def final(text):
    return worked_solution(text)[1]


def test_definite_integrals_with_limits():
    assert worked_solution("∫_0^2 x^2 dx")[0][1:] == ["= [x³/3]₀²", "= 8/3"]
    assert final("∫_0^12 x^2 dx") == "576"
    assert final("∫_0^1166 x^2 dx") == str(1166 ** 3) + "/3"  # 1166³/3
    assert final("∫_2^0 x^2 dx") == "-8/3"  # reversed limits
    assert final("3∫_0^2 x^2 dx") == "8"  # a coefficient AND limits, both kept


def test_a_number_before_the_sign_is_asked_about_not_assumed():
    i = notation_issue("1166 ∫ x^2")
    assert i.kind == "limit_or_coefficient" and i.template == "∫_?^1166 x^2"  # the lower limit is not invented
    j = solve("1166 ∫ x^2")
    assert j["clarify"]["kind"] == "limit_or_coefficient" and not j["actions"]  # nothing solved on a guess
    # confirmed coefficient → (dx asked) → the genuine coefficient integral
    coef = j["clarify"]["options"][0]["text"]
    assert coef == "1166 * ∫ x^2"
    j2 = solve(coef)
    assert j2["clarify"]["kind"] == "missing_differential"
    assert j2["clarify"]["options"][0]["text"] == "1166 * ∫ x^2 dx"  # Use dx adds only dx
    assert final("1166 * ∫ x^2 dx").replace(" ", "") == "1166x³/3+C"


def test_typed_limits_then_use_dx_keep_both_limits():
    j = solve("∫_0^1166 x^2")
    assert j["clarify"]["options"][0]["text"] == "∫_0^1166 x^2 dx"
    lines = [x for a in solve("∫_0^1166 x^2 dx")["actions"] for x in a.get("lines", [])]
    assert lines[-1].replace(" ", "") == f"={1166 ** 3}/3"


def test_one_sided_or_unknown_limits_are_asked_for():
    assert notation_issue("∫^1166 x^2").kind == "missing_lower_limit"
    assert notation_issue("∫_0 x^2 dx").kind == "missing_upper_limit"
    assert notation_issue("∫_?^1166 x^2 dx").kind == "unknown_limit"
    assert notation_issue("∫_0^2 x^2 dx") is None and notation_issue("3∫_0^2 x^2 dx") is None


def test_spoken_limits_are_kept():
    assert topic_expression("Help me understand integration of x squared from zero to two") == "∫_0^2 x² dx"
    assert topic_expression("integral of x squared from 0 to 12") == "∫_0^12 x² dx"
    assert topic_expression("integral of x squared from blah to 2") is None  # not understood: not dropped silently
    assert topic_expression("integration of x squared") == "∫ x² dx"
