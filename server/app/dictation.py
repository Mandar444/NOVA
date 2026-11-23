"""Spoken maths the browser's deterministic normaliser could not fully understand → BharatCode proposes the notation.

The model only TRANSCRIBES what was said into notation; it never solves, adds bounds, picks a variable or changes a sign.
Its proposal is validated against the words actually spoken, and the student confirms it before anything reaches the page.
"""

from __future__ import annotations

import re

from .config import settings
from .errors import ApiError
from .providers.bharatcode import parse_json_object, provider

INSTRUCTIONS = """You convert a student's SPOKEN maths (a speech transcript) into written maths notation.
Rules:
- Write exactly what was said. Do NOT solve, simplify, complete or correct it. Keep every variable name, sign, number and grouping.
- Never add anything that was not said: no limits/bounds, no "dx" variable that was not implied, no "= 0", no answer.
- If something needed is missing or the meaning is ambiguous (e.g. "x plus one over two": (x+1)/2 or x+1/2?), do NOT guess:
  set "question" to one short clarifying question and "options" to the possible readings.
- Notation: ^ for powers, * for an explicit "times", / for division, sqrt( ), sin x, ln x, d/dx( ), definite integral ∫_a^b f dx,
  indefinite ∫ f dx. A leading instruction word (Solve, Find, Simplify, Factorise, Evaluate, Expand) stays at the front.
Reply with JSON only: {"text": "...", "question": null, "options": []}"""

_NUM_WORDS = {
    "zero": 0, "oh": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
    "hundred": 100, "half": 2, "squared": 2, "cubed": 3, "square": 2, "cube": 3,
}


def spoken_numbers(*texts: str) -> set[str]:
    """Every number the student said (as digits or words, including compounds like 'twenty five')."""
    out: set[str] = set()
    for t in texts:
        low = (t or "").lower()
        out.update(re.findall(r"\d+(?:\.\d+)?", low))
        words = re.findall(r"[a-z]+", low)
        cur = None
        for w in words:
            if w in _NUM_WORDS:
                v = _NUM_WORDS[w]
                out.add(str(v))
                if w == "hundred" and cur is not None:
                    cur *= 100
                elif cur is not None and cur >= 20 and cur % 10 == 0 and v < 10:
                    cur += v
                else:
                    cur = v
                out.add(str(cur))
            else:
                cur = None
    return out


def validate(transcript: str, attempt: str, text: str) -> str | None:
    """Why the proposal can't be accepted as a faithful transcription (None = it can)."""
    if not text or len(text) > 200:
        return "empty or too long"
    said = spoken_numbers(transcript, attempt)
    for n in re.findall(r"\d+(?:\.\d+)?", text):
        if n not in said:
            return f"the number {n} was not said"
    low = transcript.lower()
    if re.search(r"∫\s*_", text) and not re.search(r"\b(from|between)\b", low):
        return "limits were added that were not said"
    if re.search(r"=\s*0\s*$", text) and not re.search(r"\b(equals?|equal to|is)\b|=", low):
        return "an equation was added that was not said"
    return None


async def interpret(transcript: str, attempt: str, request_id: str) -> dict:
    user = f"TRANSCRIPT: {transcript.strip()[:600]}" + (f"\nPARTIAL READING BY RULES (may be incomplete): {attempt[:200]}" if attempt else "")
    reply = await provider.generate(INSTRUCTIONS, user, None, max_tokens=300, request_id=request_id, temperature=0)
    try:
        obj = parse_json_object(reply.text)
    except Exception:
        raise ApiError("INVALID_MODEL_OUTPUT", "NOVA could not interpret that. Edit the words or type the maths.", request_id, retryable=True)
    text = re.sub(r"\s+", " ", str(obj.get("text") or "")).strip()
    question = str(obj.get("question") or "").strip()[:160] or None
    options = [re.sub(r"\s+", " ", str(o)).strip()[:120] for o in (obj.get("options") or []) if str(o).strip()][:4]
    if question:
        return {"requestId": request_id, "text": "", "question": question, "options": options, "model": settings.model}
    why = validate(transcript, attempt, text)
    if why:
        return {"requestId": request_id, "text": "", "question": f"NOVA isn't sure ({why}). Please edit the words or type the maths.", "options": [], "model": settings.model}
    return {"requestId": request_id, "text": text, "question": None, "options": [], "model": settings.model}
