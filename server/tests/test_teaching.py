"""Teaching-first tutor: grounded prompts, the student's own step is never done for them, explicit requests are honoured."""
import uuid

from fastapi.testclient import TestClient

from app import services
from app.main import app
from app.maths.linear import MathError, parse_equation
from app.providers.bharatcode import ModelReply
from app.schemas.models import TutorRequest

client = TestClient(app)


def body(question="", problem="2(x + 3) = 14", current=None, accepted=True, intent="ask", history=(), exam=None):
    return {
        "context": {"requestId": str(uuid.uuid4()), "pageId": "p", "contentRevision": 1, "regionId": "rC" if current else "rP", "sourceHash": "h", "selectionRevision": 0, "interpretationRevision": 1},
        "intent": intent, "question": question,
        "problem": {"regionId": "rP", "text": problem, "accepted": True},
        "current": {"regionId": "rC", "text": current, "accepted": accepted} if current else None,
        "history": [{"role": r, "text": t} for r, t in history], "plotExpression": None, "exam": exam,
        "regionIds": ["rP", "rC"] if current else ["rP"], "pageLines": [],
    }


class Fake:
    def __init__(self, text):
        self.text, self.prompts = text, []

    async def generate(self, instructions, text, *a, **k):
        self.prompts.append(text)
        return ModelReply(text=self.text, latency_ms=5, incomplete=False)


def test_structured_reply_is_short_with_detail_on_request(monkeypatch):
    fake = Fake('{"say":"The 2 multiplies both terms in the bracket.","next":"What is 2 × 3?","detail":"2(x + 3) is two groups of (x + 3).","actions":[]}')
    monkeypatch.setattr(services, "provider", fake)
    j = client.post("/api/v1/tutor", json=body("help", current="2x + 3 = 14")).json()
    assert j["explanation"] == "The 2 multiplies both terms in the bracket. What is 2 × 3?"
    assert j["detail"] == "2(x + 3) is two groups of (x + 3)."


def test_students_next_step_is_not_written_for_them(monkeypatch):
    fake = Fake('{"say":"Expand the bracket.","next":"Try it.","actions":['
                '{"type":"write_equation","anchorRegionId":"rP","expression":"2x + 6 = 14","purpose":"hint"},'
                '{"type":"write_lines","anchorRegionId":"page","title":"t","lines":[{"text":"2x + 6 = 14","ink":"blue"},{"text":"2 multiplies each term","ink":"red"}]}]}')
    monkeypatch.setattr(services, "provider", fake)
    j = client.post("/api/v1/tutor", json=body("how do I start?")).json()
    assert not [a for a in j["actions"] if a["type"] == "write_equation"]
    lines = [a for a in j["actions"] if a["type"] == "write_lines"][0]["lines"]
    assert lines == ["2 multiplies each term"]


def test_next_step_in_prose_is_not_given_away(monkeypatch):
    # A2 (real model, 2026-11-18): "... On your line, write 2x + 6 = 14."
    fake = Fake('{"say":"The 2 must multiply BOTH terms in the bracket, so 2 × 3 is missing.","next":"On your line, write 2x + 6 = 14.",'
                '"detail":"2(x + 3) means 2x + 2 × 3. So it becomes 2x + 6 = 14. Then subtract 6.","actions":[]}')
    monkeypatch.setattr(services, "provider", fake)
    j = client.post("/api/v1/tutor", json=body("Where did I go wrong?", current="2x + 3 = 14")).json()
    assert "2x + 6 = 14" not in j["explanation"] and "2x + 6 = 14" not in (j["detail"] or "")
    assert j["explanation"].startswith("The 2 must multiply BOTH terms") and "next step yourself" in j["explanation"]
    assert "Then subtract 6." in j["detail"]


def test_students_own_lines_and_wrong_lines_can_be_quoted(monkeypatch):
    fake = Fake('{"say":"Your line 2x + 6 = 14 is right.","next":"What do you do to both sides to get 2x alone?","actions":[]}')
    monkeypatch.setattr(services, "provider", fake)
    j = client.post("/api/v1/tutor", json=body("What next?", current="2x + 6 = 14")).json()
    assert j["explanation"] == "Your line 2x + 6 = 14 is right. What do you do to both sides to get 2x alone?"
    fake = Fake('{"say":"In 2x + 3 = 14 the 3 should be 2 × 3.","next":"Fix that term.","actions":[]}')
    monkeypatch.setattr(services, "provider", fake)
    j = client.post("/api/v1/tutor", json=body("Where did I go wrong?", current="2x + 3 = 14")).json()
    assert "2x + 3 = 14" in j["explanation"]


def test_full_solution_when_explicitly_asked(monkeypatch):
    fake = Fake('{"say":"Here it is.","next":"","actions":[{"type":"write_lines","anchorRegionId":"page","title":"t","lines":["2x + 6 = 14","2x = 8","x = 4"]}]}')
    monkeypatch.setattr(services, "provider", fake)
    j = client.post("/api/v1/tutor", json=body("show me the full solution")).json()
    assert [a for a in j["actions"] if a["type"] == "write_lines"][0]["lines"] == ["2x + 6 = 14", "2x = 8", "x = 4"]
    assert "FULL SOLUTION REQUESTED" in fake.prompts[0]


def test_unrevealed_exam_never_counts_as_full_solution():
    r = TutorRequest.model_validate(body("show me the full solution", exam={"number": "1", "text": "Solve 2(x + 3) = 14", "answer": "x = 4", "reveal": False}))
    assert not services.wants_full_solution(r)


def test_unconfirmed_reading_is_confirmed_before_judging(monkeypatch):
    fake = Fake('{"say":"Did you write 2x + 8 or 2x + 6?","next":"","actions":[]}')
    monkeypatch.setattr(services, "provider", fake)
    client.post("/api/v1/tutor", json=body("is this right?", current="2x + 8 = 14", accepted=False))
    assert "READING UNCONFIRMED" in fake.prompts[0]


def test_repeated_hints_ask_for_a_new_approach(monkeypatch):
    fake = Fake('{"say":"Picture two groups.","next":"","actions":[]}')
    monkeypatch.setattr(services, "provider", fake)
    hist = [("student", "help"), ("tutor", "The 2 multiplies both terms."), ("student", "what?"), ("tutor", "2 × (x + 3) means 2x and 2 × 3.")]
    client.post("/api/v1/tutor", json=body("I still don't get it", current="2x + 3 = 14", history=hist))
    assert "change the approach" in fake.prompts[0]


def test_superscript_square_is_a_clean_error_not_a_crash():
    try:
        parse_equation("x² - 5x + 6 = 0")
    except MathError:
        pass  # handled: the exact engine then compares solution sets instead


# ---- intent-aware policy: hint / explain / solution
def mode_of(question, intent="ask", exam=None):
    return services.teaching_mode(TutorRequest.model_validate(body(question, intent=intent, exam=exam)))


def test_teaching_mode_follows_the_request():
    assert mode_of("What next?") == "hint"
    assert mode_of("Where did I go wrong?") == "hint"
    assert mode_of("Explain why, not just what to do.") == "explain"
    assert mode_of("I still don't understand") == "explain"
    assert mode_of("Show me the full worked solution") == "solution"
    assert mode_of("Why is it wrong?", intent="hint") == "hint"  # the Hint button stays a hint
    assert mode_of("", intent="complete") == "next"  # Next step is one step, not the whole solution
    exam = {"number": "3", "text": "Solve 2(x + 3) = 14", "answer": "x = 4", "reveal": False}
    assert mode_of("Show me the full solution", exam=exam) == "hint"  # an unrevealed test never gives the solution


def test_hint_leaves_out_whole_sentences_never_patches_them(monkeypatch):
    fake = Fake('{"say":"Good start: the bracket is expanded. Then you will find x = 4.","next":"What can you subtract from both sides?","actions":[]}')
    monkeypatch.setattr(services, "provider", fake)
    j = client.post("/api/v1/tutor", json=body("What next?", current="2x + 6 = 14")).json()
    assert j["explanation"] == "Good start: the bracket is expanded. What can you subtract from both sides?"
    assert "?" not in j["explanation"].replace("sides?", "")  # no "x = ?" patched into a sentence


def test_explain_keeps_the_explanation_whole(monkeypatch):
    fake = Fake('{"say":"2(x + 3) means two groups of (x + 3), so the 2 multiplies both: 2(x + 3) = 2x + 6.",'
                '"next":"Look at your line again: which term changed?","detail":"So 2(x + 3) = 14 becomes 2x + 6 = 14, because 2 × 3 = 6.",'
                '"actions":[{"type":"write_equation","anchorRegionId":"rP","expression":"2x + 6 = 14","purpose":"hint"}]}')
    monkeypatch.setattr(services, "provider", fake)
    j = client.post("/api/v1/tutor", json=body("Explain why, not just what to do.", current="2x + 3 = 14")).json()
    assert "2x + 6 = 14" in j["detail"] and "2(x + 3) = 2x + 6" in j["explanation"]
    assert not [a for a in j["actions"] if a["type"] == "write_equation"]  # their next line is still not written for them


def test_requested_solution_is_complete_and_checked(monkeypatch):
    # the model's steps contain a wrong line (2x = 7): NOVA writes its exact ordered steps instead
    fake = Fake('{"say":"Here is the full solution.","next":"","actions":[{"type":"write_lines","anchorRegionId":"page","title":"t",'
                '"lines":["2(x + 3) = 14","2x + 6 = 14","2x = 7","x = 3.5"]}]}')
    monkeypatch.setattr(services, "provider", fake)
    j = client.post("/api/v1/tutor", json=body("Show me the full worked solution")).json()
    lines = [a for a in j["actions"] if a["type"] == "write_lines"][0]["lines"]
    assert lines[0].replace(" ", "") == "2(x+3)=14" and lines[-1].replace(" ", "").startswith("x=4")
    assert not any("2x = 7" in x for x in lines)
    assert j["explanation"] == "Here is the full solution."


def test_requested_solution_with_valid_steps_is_kept_as_written(monkeypatch):
    fake = Fake('{"say":"Here it is.","next":"","detail":"x = 4 because 8 ÷ 2 = 4.","actions":[{"type":"write_lines","anchorRegionId":"page","title":"t",'
                '"lines":["2x + 6 = 14   (2 multiplies both terms)","2x = 8   (subtract 6)","x = 4   (divide by 2)"]}]}')
    monkeypatch.setattr(services, "provider", fake)
    j = client.post("/api/v1/tutor", json=body("Show me the full worked solution")).json()
    assert [a for a in j["actions"] if a["type"] == "write_lines"][0]["lines"][-1].startswith("x = 4")
    assert j["detail"] == "x = 4 because 8 ÷ 2 = 4."  # nothing withheld when the solution was asked for


def test_unrevealed_test_answer_is_never_given(monkeypatch):
    fake = Fake('{"say":"Expand the bracket first. The answer is x = 4.","next":"What is 2 × 3?","actions":[]}')
    monkeypatch.setattr(services, "provider", fake)
    exam = {"number": "3", "text": "Solve 2(x + 3) = 14", "answer": "x = 4", "reveal": False}
    j = client.post("/api/v1/tutor", json=body("Show me the full solution", exam=exam)).json()
    assert "4" not in j["explanation"].replace("2 × 3", "")
    assert j["explanation"].startswith("Expand the bracket first.")
