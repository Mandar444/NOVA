# NOVA — build state

_Last updated: 2026-11-18_

## QA checkpoint — PAUSED (2026-11-18)
Paused by the low-memory safeguard (≈1 GB free of 16 GB). Nothing below is deployed; origin/main is still afa2e60.

**Test copy:** git worktree `%TEMP%\claude\…\scratchpad\q` (full path in the session notes), branch **`qa-journeys`**,
base **afa2e60** (= origin/main). Checkpoint = the commit on `qa-journeys` that adds this section (local only, not pushed).
The user's main checkout (`Desktop/Nova`, 12 uncommitted files from the 5 Nov PDF experiment) is untouched.

**Unfinished fixes in the checkpoint (unit/type checks pass: tsc clean, server 198, web 19; behaviour only partly re-verified):**
| File | Change |
|---|---|
| `server/app/services.py`, `schemas/models.py`, `web/src/tutor/api.ts` | `note` = the focused point only, for the card on the page; chat keeps say + next |
| `web/src/tutor/useNova.ts` | equation lines the student writes are not solved unasked (marks + Solve tap; "x = ?", "4 + 2 =", Solve button still answer); exam Ask uses the student's latest work under the question; one live reply card (earlier reply cards retire, chat keeps history) |
| `web/src/tutor/layout.ts` | cards go right of the student's writing in that band (page grows), never in the writing lane below; leader line if moved >160 px |
| `web/src/tutor/usePaper.ts` | Help sends the student's latest answer line under the question |
| `web/src/notebook/NotebookScreen.tsx` | Ask on a paper page is grounded in the printed question in focus (latest-work question, else first visible) |
| `web/src/ui/AskPopover.tsx` | docked Ask panel sits left of the open test panel (did cover the Help buttons) |

**Known open defect:** premature next-step giveaway in prose — A2 reply said "On your line, write 2x + 6 = 14" (server filter `_is_students_step` checks actions only, not the explanation text).
**Product note:** voice questions — keep transcript review + Send as the default (verify current behaviour before changing anything).

**Tests (real glm-5.3-flash through the local build unless marked):**
| Gate | Case | Result |
|---|---|---|
| B auto handwriting | literal wrong maths `4 + 2 = 7`, no clicks | PASS (readback 6.0 s, ✗ mark, 1 recognize call) |
| | no reread of unchanged line | PASS |
| | edit reread / erase reread | PASS (4.2 s / 4.1 s) |
| | stale reading rejected (response held 8 s by test = emulated delay, real model) | PASS |
| | stroke during request 319 ms vs 291 ms idle | **NOT an input-latency measurement**: that is the wall time of the scripted 40-point mouse gesture; input-to-paint not yet measured |
| | stale tutor reply after page change; newer question supersedes older | NOT RUN |
| A teaching (before fixes) | F1 Ask on paper "no problem"; F2 Ask panel over Help; F3 unprompted solution; F4 cards over student lines (50–72 %); F5 cards pile up; F6 switched question → invented problem | FAILED → fixed in checkpoint |
| A teaching (after fixes, partial) | A1 Ask on paper (grounded, Q1 hint) · Help on Q3 · A4 still confused (changed approach, picture) | PASS (2.5 / 3.0 / 2.3 s) |
| | A2 wrong step | grounded, correct diagnosis, but **gives the next step** → FAIL (open defect) |
| | A5 explain why · A3 correct step · A6 full solution | **UNVERIFIED** — provider "model is busy" / ConnectError; waits of 774 s and 1952 s exceed the 118 s client deadline → must be investigated (machine stall under memory pressure vs deadline bug) |
| | A7 ambiguous handwriting · A8 switch question | NOT RUN |
| C 4-page PDF (`real4.pdf`, CBSE 2018 SQP p1–4) | visible / writable timings, write while preparing, ink/zoom/page kept, failure, cancel, reload | NOT RUN on this build (earlier synthetic-paper numbers in RESULTS.md) |
| D full session | create → import → write → ask → revise → close → reopen; provider failure / cancel during long wait | NOT RUN |

**Processes:** test servers (vite preview :5190 from `q/web/dist`, backend :8011 from `q/server`) were stopped at this checkpoint to free memory.
Restart: `cd q/server && ../../../Desktop/Nova/server/.venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 8011` and
`cd q/web && npm run build && NOVA_BACKEND=http://127.0.0.1:8011 npx vite preview --host 127.0.0.1 --port 5190 --strictPort` (preview proxies /api to NOVA_BACKEND).

**Exact next test (one browser, sequential):** fix the prose giveaway, then `SKIP_PAPER=1 node qa/a_teach.cjs after2` (handwritten part:
A2, A4, A5, A3, A6, A8), then A7 ambiguous handwriting. A provider error marks that case UNVERIFIED; do not retry more than once.

## Running
| Process | URL | Command |
|---|---|---|
| Backend (FastAPI) | http://127.0.0.1:8010 | `cd server && .venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 8010` |
| Web (Vite) | **http://127.0.0.1:5180** | `cd web && npm run dev` |

No auto-reload: restart the backend after server code changes.
Secrets: `server/.env`. Speech model: `server/models/` (`scripts/setup_speech.py`). Ports 8000/5173 belong to other processes; leave them alone.

## Checks (last run)
| Check | Result |
|---|---|
| `server: .venv/Scripts/python -m pytest -q` | **198 passed** (incl. tests/test_teaching.py) |
| `web: npx vitest run` | 19 passed (incl. tutor/paperPrep.test.ts) |
| `web: npx tsc -b` / `npm run build` | clean / ok |
| Browser journeys `tests/e2e/{journey,auto,ask_table,paper,handwriting}.mjs` | pass (see RESULTS.md) |
| Real human handwriting (T02) | **NOT RUN** |

## What NOVA does now
- **Model: `glm-5.3-flash`** (BharatCode retired qwen-3.8-27b; sunset 2026-11-22). Chat-completions API; one reading per line by default (`NOVA_RECOGNIZE_VOTES=2` restores two reads + "Which did you write?" on disagreement); provider calls wait up to 110 s (Vercel limit 120 s); a fresh connection per call (no pooled connection reuse on serverless).
- **Reads automatically**; a reading NOVA is unsure of is confirmed with the student, never marked as a maths mistake.
- **Reacts by itself** (exact maths, no AI guessing): `… =` → answer written in handwriting beside "="; `a = b` → ✓/✗; equation → full worked solution in handwriting under/next to it; step under a problem → ✓/✗; `y = …` → Graph action. Auto-answer can be turned off in Settings (then marks only).
- **Exact maths engine (expr_v2, SymPy behind our own parser)**: arithmetic, fractions, powers, roots, trig in degrees, identities, expand/factorise, d/dx, ∫ (incl. definite), limits, n!, nCr, gcd/lcm, %, logs, |x|, equations/inequalities (quadratics, trig with 0°–360° solutions), step equivalence for any equation.
- **Graphs** for any equation (functions, both sides of an equation with the solution marked, implicit curves).
- **Handwriting engine** (`web/src/handwriting/`): built-in glyphs for digits, letters, Greek, operators, √, ∫, fractions, powers; style copied from the student's line. **Teach NOVA your handwriting** (Settings): guided boxes for digits/operators/x/y/θ/√/✓/✗; samples stored on this device (deletable); NOVA then composes answers from them, falling back to built-in glyphs.
- **Ask NOVA, teaching-first** (2026-11-18): a typed/spoken question with nothing selected is grounded in the page's problem and the latest working (an off-topic question is answered directly). Replies are `say` (one focused point) + `next` (one action or question) on the page/chat, with a longer `detail` behind "Explain more". When HISTORY shows hints already given, the model is told to change approach (smaller example, draw_groups). Unconfirmed readings are confirmed first. The server drops any hint equation or written line that is a correct next form of the problem (the student's own step); an explicit "full solution" request (not in an unrevealed exam) gets ordered steps with reasons.
- **Ask NOVA** is a docked chat thread (replyable). NOVA can write handwritten content (lists, tables) onto the page; every value is verified/corrected by the engine. Persona: professor-level mathematician (no real-institution claims).
- **Question papers (PDF), progressive** (2026-11-18): the file is parsed and every page is created at once (stable ids, real sizes, asset ids fixed up front); page 1 opens immediately and is writable while its sheet draws; other pages draw one at a time in the background (tutor/paperPrep.ts), the page the student opens first. Per-page states: Preparing / ready / Couldn't prepare + Retry. The original PDF is stored (asset `pdf_…`) so a reload mid-import resumes. NOVA reads a page's questions (AI) only when the student opens that page. pdf.js renders pages + text layer; NOVA finds questions, locates them, builds an answer key verified by the engine; Test panel: Help (hint + circle, never the answer), Finish test (reads answers under each question, marks ✓/✗ on the page, red score at the top, review with Explain).
- **Endless grid**: blank pages fill the screen with the grid (no paper edge) and grow right/down as you write or scroll; imported PDFs/photos keep their page shape. Zoom % resets to 100% at the top-left.
- **Answer placement** follows the student's last symbol (the "="), level with it, so slanted lines work (issue I3.png); stray dots are ignored.
- **Question papers, round 2**: pages are read 2 at a time with one automatic retry; failed pages are listed with a Retry button (images re-read from storage). Circled/ticked printed options are read from the PDF text positions (no model). The help circle is a thin blue outline. The PDF sheet lies on the endless grid; explanations are written in the grid beside the sheet, level with the question, in teacher inks (black = question/given, blue = working, red = key idea + final answer).
- **UI**: back to the ORIGINAL first-build look (user request): grey workspace, white top bar (‹ Notes), fixed 48px writing toolbar, system font, accent #245C9C, original Notebooks list; app opens the last notebook directly. theme-classic.css restores those surfaces over index.css. Later redesigns (warm, student, neutral, Home-as-a-page) are removed from the UI; features (handwriting answers, tests, Ask thread, grid) are kept in the original style.
- **Voice replies**: a question asked through the mic is answered aloud (and in writing); typed questions stay silent unless "Always speak" is on in Settings.
- QA_REVIEW.md bugs 1–4 fixed (menu collision, readback overlap, stale-card stacking, menu over graph).

## Known gaps / next
2. Real handwriting evaluation with people's writing (Day 1 exit) — still the main open gate.
4. Scanned (image-only) PDFs rely on model bounding boxes; not tested.
7. PDF: every page is still drawn at 1600 px (one at a time); no separate low-res thumbnails (the library thumbnails are vector placeholders and never needed the image). Finish test marks only pages NOVA has read (pages never opened have no questions).
8. Teaching: evaluated on 9 scripted exchanges (RESULTS.md), not with students. The model occasionally still writes scaffold equations (e.g. "2 * 3 = 6, -2 + -3 = -5") that hint strongly.
5. Browser mic (webm/opus) on a real device; HTTPS for phone mic.
6. KaTeX bundle size warning.

- **Beginner worked solutions** (2026-10-31): linear equations are solved with explained steps (server maths/steps.py explained_steps → /auto notes + moves). On the page each moved term is red, a red curved arrow runs from where it was to where it landed (side-aware across =), a thin handwritten note says why ("+2 moves across = and becomes -2", "11 - 2 = 9"), final answer red. Client: handwriting/explain.ts; notes are a separate thin-pen ink object (id suffix :why).
- **Notebooks screen** (2026-10-31): real page previews on every tile (PageThumb), a large "Continue where you left off" card (preview, first lines NOVA read, ✓/✗ counts, Continue writing), New notebook + Import a question paper cards. Whole UI one step bigger (60px top bar, 58px toolbar, 22px icons).
- **Solve button = explained solution** (2026-10-31): the readback/menu Solve on a linear equation now calls /auto (forced) and writes the same arrowed, noted solution as auto-answer (useNova.solveHere); other equations still go to the tutor. Non-whole answers end with an x ≈ decimal line.
