"""Words like "write", "add", "list", "notes", "formula" never bypass the teaching safeguards: the teaching mode decides.
Each case checks BOTH the reply text and what is written on the canvas."""
import json

from fastapi.testclient import TestClient

from app import services
from app.main import app
from tests.test_teaching import Fake, body

client = TestClient(app)
PROBLEM = "x - 3 = 7"
EXAM = {"number": "1", "text": "Solve x - 3 = 7", "answer": "x = 10", "reveal": False}

# a model reply that over-shares: the next step / final answer in the text AND on the canvas
LEAKY = json.dumps({
    "say": "Add 3 to both sides, so x = 10.",
    "next": "Check it.",
    "actions": [
        {"type": "write_lines", "anchorRegionId": "page", "title": "Rule", "lines": [
            {"text": "Do the same to both sides", "ink": "blue"},
            {"text": "x - 3 + 3 = 7 + 3", "ink": "blue"},
            {"text": "x = 10", "ink": "blue"}]},
        {"type": "write_equation", "anchorRegionId": "rP", "expression": "x = 10", "purpose": "hint"},
    ],
})


def ask(question, exam=None, reply=LEAKY, monkeypatch=None):
    fake = Fake(reply)
    monkeypatch.setattr(services, "provider", fake)
    j = client.post("/api/v1/tutor", json=body(question, problem=PROBLEM, exam=exam)).json()
    canvas = [x for a in j["actions"] if a["type"] == "write_lines" for x in a["lines"]] + [a["expression"] for a in j["actions"] if a["type"] == "write_equation"]
    return j, canvas, fake


def reveals(text_or_lines) -> bool:
    items = text_or_lines if isinstance(text_or_lines, list) else [text_or_lines]
    return any("x = 10" in t.replace("x=10", "x = 10") or "7 + 3" in t for t in items)


def test_write_a_hint_gives_no_step_or_answer(monkeypatch):
    j, canvas, _ = ask("Write a hint for this.", monkeypatch=monkeypatch)
    assert not reveals(j["explanation"]) and not reveals(canvas)
    assert "Do the same to both sides" in canvas  # the rule itself is guidance and stays


def test_help_me_add_does_not_unlock_the_step(monkeypatch):
    j, canvas, _ = ask("Help me add 3 to both sides.", monkeypatch=monkeypatch)
    assert not reveals(j["explanation"]) and not reveals(canvas)


def test_add_notes_explaining_the_rule_keeps_the_rule_not_the_answer(monkeypatch):
    j, canvas, _ = ask("Add notes explaining the rule.", monkeypatch=monkeypatch)
    assert services.teaching_mode(services.TutorRequest.model_validate(body("Add notes explaining the rule.", problem=PROBLEM))) == "explain"
    assert "Do the same to both sides" in canvas
    assert not reveals(canvas)  # the student's next line and final value are not written for them


def test_write_this_question_copies_it_without_solving(monkeypatch):
    j, canvas, fake = ask("Write this question.", monkeypatch=monkeypatch)
    assert canvas == [PROBLEM] and not reveals(j["explanation"])
    assert fake.prompts == []  # no model call


def test_reference_table_does_not_exempt_solution_steps(monkeypatch):
    reply = json.dumps({"say": "Here is the table.", "next": "", "actions": [
        {"type": "write_table", "anchorRegionId": "page", "title": "Trig values", "header": ["θ", "sin θ", "cos θ"], "rows": [["0°", "0", "1"], ["30°", "1/2", "√3/2"]]},
        {"type": "write_lines", "anchorRegionId": "page", "title": "Also", "lines": ["x = 10"]}]})
    j, canvas, _ = ask("Write a trigonometry table.", reply=reply, monkeypatch=monkeypatch)
    assert any(a["type"] == "write_table" for a in j["actions"])  # the reference material is written
    assert not reveals(canvas)  # an unrelated solution step is still validated away


def test_write_the_full_solution_is_complete(monkeypatch):
    j, canvas, _ = ask("Write the full solution.", monkeypatch=monkeypatch)
    assert canvas and canvas[-1].replace(" ", "").startswith("x=10")


def test_unrevealed_test_stays_authoritative(monkeypatch):
    for q in ("Write the full solution.", "Help me add 3 to both sides.", "Write a hint for this.", "Add notes explaining the rule."):
        j, canvas, _ = ask(q, exam=EXAM, monkeypatch=monkeypatch)
        assert not reveals(j["explanation"]) and not reveals(canvas), q
    j, canvas, _ = ask("Write this question.", exam=EXAM, monkeypatch=monkeypatch)
    assert canvas == [PROBLEM]
