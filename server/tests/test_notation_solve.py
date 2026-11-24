"""Acceptance maths: notation is settled with the student first; closed problems get exact worked lines on the page."""
import uuid

from fastapi.testclient import TestClient

from app import services
from app.main import app
from app.maths.notation import differential_equation, notation_issue
from app.maths.solve import warm_up
from app.maths.worked import worked_solution
from tests.test_teaching import Fake

client = TestClient(app)
warm_up()


def tb(text, intent="solve", question=""):
    return {"context": {"requestId": str(uuid.uuid4()), "pageId": "p", "contentRevision": 1, "regionId": "rP", "sourceHash": "h", "selectionRevision": 0, "interpretationRevision": 1},
            "intent": intent, "question": question, "problem": {"regionId": "rP", "text": text, "accepted": True}, "current": None,
            "history": [], "plotExpression": None, "exam": None, "regionIds": ["rP"], "pageLines": []}


def lines_of(j):
    return [x for a in j["actions"] if a["type"] == "write_lines" for x in a["lines"]]


def test_dictated_bounded_integral_full_solution():
    j = client.post("/api/v1/tutor", json=tb("∫_0^2 x^2 dx")).json()
    sup = lambda t: t.replace("^3", "³").replace("^2", "²")
    assert [sup(x) for x in lines_of(j)[-2:]] == ["= [x³/3]₀²", "= 8/3"] and j["verifiedBy"] == "deterministic"


def test_indefinite_integral():
    assert worked_solution("∫ x^2 dx")[1] == "x³/3 + C"


def test_missing_dx_asks_then_solves_with_bounds_kept():
    j = client.post("/api/v1/tutor", json=tb("∫_0^1 x^2/100")).json()
    assert j["clarify"]["kind"] == "missing_differential" and not j["actions"]
    assert j["clarify"]["options"][0] == {"label": "Use dx", "text": "∫_0^1 x^2/100 dx"}
    j = client.post("/api/v1/tutor", json=tb(j["clarify"]["options"][0]["text"])).json()
    assert lines_of(j)[-1] == "= 1/300"


def test_multiple_variables_ask_which():
    i = notation_issue("∫ x y")
    assert [o["label"] for o in i.options] == ["dx", "dy"]


def test_derivative_scope_is_asked_and_each_reading_solved():
    i = notation_issue("dy/dx sin x²")
    texts = [o["text"] for o in i.options]
    assert texts == ["d/dx(sin(x^2))", "d/dx((sin x)^2)", "dy/dx = sin(x^2)"]
    assert worked_solution(texts[0])[1].replace(" ", "") == "2x(cosx²)"
    assert "= 2 sin x cos x" in worked_solution(texts[1])[0]


def test_differential_equation_is_not_solved_as_algebra(monkeypatch):
    assert differential_equation("dy/dx = sin(x^2)") == ("y", "x", "sin(x^2)")
    j = client.post("/api/v1/tutor", json=tb("dy/dx = sin(x^2)")).json()
    assert "differential equation" in j["explanation"] and "y = ∫" in " ".join(lines_of(j)) and j["verifiedBy"] == "none"
    r = client.post("/api/v1/auto", json={"context": tb("x")["context"], "text": "dy/dx = sin(x^2)", "autoAnswer": True}).json()
    assert r["kind"] == "none"  # recognition alone never "solves" it


def test_limit_keeps_theta_symbolic():
    lines, final, rule = worked_solution("lim x->10 (3x + 4x - 6x sin θ)")
    assert final.replace(" ", "") in ("-60(sinθ)+70", "70-60sinθ") and "θ treated as constant" in rule


def test_linear_equation_hint_next_full(monkeypatch):
    monkeypatch.setattr(services, "provider", Fake('{"say":"The 2 multiplies both terms.","next":"Expand the bracket first.","actions":[]}'))
    hint = client.post("/api/v1/tutor", json=tb("2(x + 3) = 14", intent="hint")).json()
    assert "x = 4" not in hint["explanation"] and not any("x = 4" in x or "x=4" in x for x in lines_of(hint))
    monkeypatch.setattr(services, "provider", Fake('{"say":"Here it is.","next":"","actions":[]}'))
    full = client.post("/api/v1/tutor", json=tb("2(x + 3) = 14", intent="ask", question="Show me the full worked solution")).json()
    assert lines_of(full)[-1].replace(" ", "").startswith("x=4")
