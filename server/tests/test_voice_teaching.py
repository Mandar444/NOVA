"""Voice + dictation + teaching on the canvas: honest speech readiness, faithful dictation, maths written for explanations,
checked full solutions for closed problems."""
import uuid

from fastapi.testclient import TestClient

from app import dictation, services
from app.main import app
from app.speech import transcriber as tr
from tests.test_teaching import Fake

client = TestClient(app)


def tbody(question, problem=None, intent="ask", region="page"):
    return {
        "context": {"requestId": str(uuid.uuid4()), "pageId": "p", "contentRevision": 1, "regionId": region, "sourceHash": "h", "selectionRevision": 0, "interpretationRevision": 1},
        "intent": intent, "question": question,
        "problem": {"regionId": "rP", "text": problem, "accepted": True} if problem else None,
        "current": None, "history": [], "plotExpression": None, "exam": None,
        "regionIds": ["rP"] if problem else [], "pageLines": [],
    }


# ---------------------------------------------------------------- speech readiness
def test_capabilities_say_no_speech_when_the_model_is_missing(monkeypatch):
    monkeypatch.setattr(tr, "find_model", lambda name: None)
    monkeypatch.setattr(tr.transcriber, "_model", None)
    c = client.get("/api/v1/capabilities").json()
    if tr.Transcriber.engine_installed():
        assert c["features"]["transcribe"] is False
        assert "not downloaded" in c["speech"]["reason"] and "setup_speech.py" in c["speech"]["reason"]
    r = client.post("/api/v1/transcribe", data={"requestId": str(uuid.uuid4())}, files={"audio": ("a.webm", b"x" * 100, "audio/webm")})
    assert r.status_code >= 400 and r.json()["error"]["code"] == "FEATURE_UNAVAILABLE"
    assert "setup_speech.py" in r.json()["error"]["message"] or "not installed" in r.json()["error"]["message"]


def test_model_found_in_a_worktrees_main_checkout(tmp_path, monkeypatch):
    main = tmp_path / "main"
    snap = main / "server" / "models" / "models--Systran--faster-whisper-base.en" / "snapshots" / "abc"
    snap.mkdir(parents=True)
    (snap / "model.bin").write_bytes(b"0")
    (snap / "config.json").write_text("{}")
    wt = tmp_path / "wt"
    (wt / "server").mkdir(parents=True)
    (main / ".git" / "worktrees" / "wt").mkdir(parents=True)
    (wt / ".git").write_text(f"gitdir: {main / '.git' / 'worktrees' / 'wt'}\n")
    monkeypatch.setattr(tr, "REPO_DIR", wt)
    monkeypatch.setattr(tr, "SERVER_DIR", wt / "server")
    monkeypatch.delenv("NOVA_SPEECH_MODELS_DIR", raising=False)
    assert tr.find_model("base.en") == snap
    assert tr.find_model("large-v3") is None


# ---------------------------------------------------------------- dictation interpretation
def test_dictation_validator_rejects_invented_content():
    assert dictation.validate("integral of x squared from zero to two", "", "∫_0^2 x^2 dx") is None
    assert "not said" in dictation.validate("integral of x squared", "", "∫_0^2 x^2 dx")  # bounds never invented
    assert "not said" in dictation.validate("x plus seven", "", "x + 8")
    assert dictation.validate("twenty five minus y", "", "25 - y") is None


def test_interpret_math_returns_a_question_not_a_guess(monkeypatch):
    monkeypatch.setattr(dictation, "provider", Fake('{"text":"∫_0^2 x^2 dx","question":null,"options":[]}'))
    r = client.post("/api/v1/interpret-math", json={"requestId": str(uuid.uuid4()), "transcript": "the area under x squared", "attempt": ""}).json()
    assert r["text"] == "" and r["question"]  # the model added limits nobody said
    monkeypatch.setattr(dictation, "provider", Fake('{"text":"Find the area under y = x^2 from 0 to 2","question":null,"options":[]}'))
    r = client.post("/api/v1/interpret-math", json={"requestId": str(uuid.uuid4()), "transcript": "find the area under y equals x squared from zero to two", "attempt": ""}).json()
    assert r["text"].startswith("Find the area") and r["question"] is None


# ---------------------------------------------------------------- teaching writes maths on the canvas
def test_general_explain_question_writes_expression_and_rule(monkeypatch):
    monkeypatch.setattr(services, "provider", Fake('{"say":"Integration undoes differentiation.","next":"Which power rule applies?","actions":[]}'))
    j = client.post("/api/v1/tutor", json=tbody("Help me understand integration of x squared")).json()
    w = [a for a in j["actions"] if a["type"] == "write_lines"]
    assert w, j
    lines = w[0]["lines"]
    assert lines[0].replace("^2", "²") == "∫ x² dx" and any("xⁿ⁺¹" in x for x in lines)
    assert not any("x³/3" in x for x in lines)  # the rule, not the worked answer


def test_explain_on_a_dictated_integral_keeps_rule_hides_value(monkeypatch):
    reply = ('{"say":"Use the power rule, then the limits.","next":"Raise the power by one.","actions":[{"type":"write_lines","anchorRegionId":"rP","title":"Idea",'
             '"lines":["∫₀² x² dx","∫ xⁿ dx = xⁿ⁺¹/(n+1) + C","= [x³/3] from 0 to 2","= 8/3"]}]}')
    monkeypatch.setattr(services, "provider", Fake(reply))
    j = client.post("/api/v1/tutor", json=tbody("Explain this", problem="∫_0^2 x^2 dx", intent="explain", region="rP")).json()
    lines = [a for a in j["actions"] if a["type"] == "write_lines"][0]["lines"]
    assert any("xⁿ⁺¹" in x for x in lines) and not any(x.replace(" ", "").endswith("=8/3") for x in lines)


def test_full_solution_of_a_closed_problem_ends_on_the_checked_value(monkeypatch):
    reply = ('{"say":"Here is the solution.","next":"","actions":[{"type":"write_lines","anchorRegionId":"page","title":"t",'
             '"lines":["∫₀² x² dx = [x³/3]₀²","= 8/3 − 0","= 3"]}]}')
    monkeypatch.setattr(services, "provider", Fake(reply))
    j = client.post("/api/v1/tutor", json=tbody("Show me the full solution", problem="∫_0^2 x^2 dx", region="rP")).json()
    lines = [a for a in j["actions"] if a["type"] == "write_lines"][0]["lines"]
    assert lines[-1].replace(" ", "").startswith("=8/3")
    assert not any(x.replace(" ", "") == "=3" for x in lines)
