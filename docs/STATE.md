# NOVA — build state

_Last updated: 2026-11-18_

## QA batch 2 (2026-11-18, branch `qa-batch2` from `qa-journeys` @ 71c3dfd; local only, not deployed)
`qa-journeys` stays at its checkpoint. Main folder untouched. Checks: server pytest **206 passed**, web vitest **20 passed**, tsc clean, build ok.

**Product corrections (378c4b9)**
- Worked solutions only on request: the Solve button or an explicit request in Ask. Writing "x = ?", "solve …", "find …"
  or an equation by itself gets the mark and the Solve/Ask buttons, never the solution; the value of an unknown ("x =" under a
  problem) is held back the same way. Plain arithmetic ("4 + 2 =") is still finished automatically (unchanged; flag if that
  should also wait for Solve). README table updated.
- Teaching policy by request (`teaching_mode` in services.py, also told to the model as TEACHING MODE):
  hint (Hint button, "what next", "where did I go wrong") = one next thought; a sentence that hands over the next line or the
  final answer is left out whole, never patched to "x = ?". explain ("why", "explain", "I don't understand"; typed questions
  only, the Hint button stays a hint) = the idea and why, text not filtered; NOVA still doesn't write the student's next line
  on the page. solution (explicit full-solution request, Solve/complete, finished-test review) = complete ordered steps, nothing
  withheld, every equation line checked against the problem; if one breaks the solution and the engine can solve the
  problem, the engine's exact ordered steps are written instead. An unrevealed test question is always hint.
  The old mid-sentence `_redact_answer`/`_redact_value` substitutions are no longer used in tutor replies.

**Simulated failure / control-flow tests** (`tests/qa/f_sim.cjs <case>`, SIMULATED provider `tests/qa/fake_provider.py`:
scripted readings, paper questions and tutor replies; real app build and real backend code; headless Chrome)
| Case | Result |
|---|---|
| session: create → import real4.pdf → write under Q1 → Ask → revise → Ask → close → reload → reopen | PASS: import 0.6 s, 2 questions found; Ask 1 sent exam Q1 + current "7/75 = 7/(3 * 5^2)"; Ask 2 sent Q1 + the revised line, history 2; after reload the saved notebook is identical (pages, sheets, strokes, readings, chat, 1 NOVA note, test state), no duplicate annotations, no page errors |
| ink in that run | resolved, no ink lost: the script wrote while the Ask panel was open and 9 pen-downs landed on the panel (diagnosed by pointer targets). Re-run with the panel closed: 13 of 13 strokes saved and identical after reopen. Blank page and paper page, Assist on/off, after a reply card: every stroke saved |
| **finding** | with the test panel open, the docked Ask panel sits at x 664–1064 of a 1440 px screen, over the middle of the paper: the student cannot write there while the chat is open. Not changed (UI branch is separate); needs a layout decision |
| busy (503) | PASS: "The model is busy. Wait a few seconds and retry." in 0.2 s, Retry offered, ink kept |
| unreachable (connection dropped) | PASS: error in 0.2 s, Retry, ink kept. Wording "Could not reach BharatCode: RemoteProtocolError." is technical |
| timeout (provider silent 200 s) | PASS: "The model took too long to respond." at 110.1 s; Stop offered at 5/40/80 s; pointer move → frame p95 7 ms during the wait; late answer at 200 s never shown or applied; a stroke after the error started a new reading |
| Stop | **FAILED first**: no Stop while the Ask panel was open (the status strip with Stop is hidden then). Fixed (cdd502d): Stop in the panel's thinking bubble. Re-run PASS: idle in 45 ms, writable, late reply (30 s) never shown |
| second question while one is pending | PASS: only the second reply shown; the first's late reply never shown or applied (the first question also drops out of the chat) |
| late reply after an edit | PASS: "Your page changed, so NOVA stopped that answer"; late reply never applied; ink kept |
| late reply after switching page | PASS: no reply on either page; first page's 10 strokes kept |
| duplicates (3 questions in a row) | PASS: one live reply card on the page, 3 replies in the chat, nothing over the student's lines |
**Real teaching, glm-5.3-flash, new build** (backend :8011 restarted on qa-batch2 code; an earlier run that day hit the OLD backend and is discarded)
| Case | Reply (short) | Verdict |
|---|---|---|
| A2 wrong step 2x + 3 = 14 | "the 2 multiplies BOTH terms… it multiplies the 3 too"; ✗ mark + highlight | correct, relevant, no step given away |
| A4 still confused | changes approach: try x = 4, groups picture | adapts, good |
| A5 explain why | "2(x + 3) means 2 whole copies of (x + 3)" + full why in detail | clear explanation, final value not stated |
| A3 correct step 2x + 6 = 14 | confirms, "subtract 6 from both sides" | correct; says the next move twice (say + next) |
| A6 full solution asked | 6 ordered lines with reasons, x = 4 | correct and complete |
| A8 switch to 5x − 7 = 18 | reading was ambiguous → "Pick what you wrote" | UNVERIFIED (switch not reached; the reading-confirm step worked) |
| A7 ambiguous digit (1 or 7) | read confidently as "2x = 7", no confirmation asked | recognition did not flag the ambiguity |
Paper (run on the OLD backend, re-run pending): Ask on Q1 and Help on Q3 correct and relevant; Help on another question switched correctly (102 s, provider slow);
a wrong line written right under Q3 was attributed to **Q4** (no answer space on the printed paper; a line is assigned by its vertical centre) → open.

**Release gates still blocked:** paper teaching re-run on the new backend; A8 handwritten switch; Q-attribution on tight printed papers;
Ask panel covering the paper when the test panel is open; mobile: delayed frames during page rendering not yet profiled by function,
and no physical phone is connected (no adb device) — device test not run. Provider latency varies widely (5–102 s per reply).

Test-layout lessons: lines must be under the printed question (Q1's area starts at its text); the fake paper's Q2 position is invented.

## QA checkpoint — PAUSED (2026-11-18, evening)
Paused twice by the low-memory safeguard (1–2 GB free of 16 GB). Nothing here is deployed; origin/main is still afa2e60.

**Test copy:** git worktree under the session scratchpad (`…\scratchpad\q`), branch **`qa-journeys`** (local only, not pushed):
`01fcdd2` checkpoint · `51965bc` QA scripts · `ee3d885` prose giveaway + voice review · `e8694a7` Ask while busy + pen-aware page prep
(+ the commit that adds this section). Base afa2e60. The user's main checkout (`Desktop/Nova`, 12 uncommitted files) is untouched.
Checks on the branch: server pytest **200 passed**, web vitest **20 passed**, `tsc -b` clean, `npm run build` ok.

**Changes on the branch (vs afa2e60)**
| Area | Change |
|---|---|
| Tutor reply | page card = the focused point only (`note`); chat keeps say + next |
| Tutor prose | a sentence of say/next/detail that contains the student's next correct form of the problem is dropped (A2 said "write 2x + 6 = 14"); lines already on the page and the final answer (redacted to "x = ?") are untouched; full-solution requests untouched |
| Auto reactions | an equation the student writes is marked, not solved unasked (Solve tap, "x = ?", "4 + 2 =" still answer) — **changes the old demo** "write 3x + 2 = 11 → arrows" |
| Cards | right of the student's writing in that band (page grows), never in the writing lane; one live reply card (older reply cards retire; chat keeps all) |
| Paper Ask/Help | grounded in the printed question in focus + the student's latest line under it; docked Ask panel sits left of the test panel |
| Ask while busy | Send/Enter/chips work while NOVA is answering; the new question replaces the pending one (was: blocked up to 110 s unless Stop) |
| Voice | transcript goes into the box for review, student presses Send (browser-speech path had auto-sent since d23b622); reply still spoken |
| PDF prep | pages the student is not looking at wait while the pen is down or used in the last 1 s |

**Results** (real = glm-5.3-flash through this build; EMULATED marked; device = headless Chrome, synthetic mouse)
| Gate | Case | Result |
|---|---|---|
| auto handwriting | literal `4 + 2 = 7`, no reread, edit/erase reread, stale reading rejected (emulated 8 s hold) | PASS (real) |
| | stale tutor reply after page change · newer question supersedes | NOT VERIFIED (session run killed) |
| A teaching | F1–F6 (paper Ask ungrounded, panel over Help, unprompted solution, cards over writing, card pile-up, wrong question after switch) | fixed; A1 paper Ask, Help Q3, A4 still-confused PASS (real, first rerun) |
| | A2 wrong step | grounded + correct diagnosis but gave the step away → fixed in code (unit test); **re-run UNVERIFIED**: provider "model is busy" twice (provider request ids 5081af3b…, ddc78e62…) |
| | A5 why · A3 correct step · A6 full solution · A7 ambiguous · A8 switch | **UNVERIFIED** — not run (provider failing; script stops after 2 provider errors) |
| B 4-page PDF (real4.pdf), AI analysis held open (EMULATED) | first page visible / writable / all 4 ready, CPU 1×, n=5 | visible 0.58–0.73 s, writable 0.89–1.05 s, all ready 2.33–2.56 s (pen-aware build; 0.80–1.64 s before it) |
| | same, CPU 4× slower, n=3 | visible 2.7–2.9 s, writable 4.6–5.0 s, all ready 7.6–7.9 s |
| | drawing does not wait for AI | PASS (analysis never answered; all pages drawn) |
| | write while preparing (CPU 6×): zoom 400 %, 3 strokes | PASS: 3 strokes saved, zoom unchanged, active page unchanged |
| | page 2 fails (EMULATED IndexedDB error) | PASS: "Couldn't prepare this page … Retry", pages 3–4 continue, Retry draws it, ink kept |
| | cancel = close notebook mid-import | PASS: drawing stops (1 in-flight page finishes, not saved); reopen resumes, all ready 7.4 s later, ink kept |
| | reload mid-import | PASS: all ready 3.4 s after reload, ink kept |
| | real-model question finding (run Q) | NOT RUN (provider) |
| Pen latency (new measure) | pointermove → next frame, 40-point stroke, n=3 each | CPU 1×: p50 3 ms, max 8 ms, idle and during a pending read. CPU 4×: p50 10 ms, max 43 ms |
| | while PDF pages prepare | CPU 1×: p95 6–20 ms (was 34–59 before pen-aware prep). CPU 4×: p95 130–140 ms (was 128–238); long tasks up to 330–490 ms from the page already being drawn |
| | the old "319 ms" | was the wall time of the scripted 40-point gesture (≈290–360 ms idle too), not latency |
| | pen down/up → paint 280–300 ms (CPU 1×) during a pending read | input delay 1 ms, no long tasks: headless Chrome produced no frame because pen-down changes nothing on screen; not a main-thread block. Not checked on a real device |
| C full session | create → import → write → ask → revise → close → reopen; provider 503 / 110 s timeout / Stop / stale | **NOT VERIFIED** — run killed by low-memory safeguard during the real-model part, no results recorded |

**Known limits:** an Ask that first has to read a line makes two requests (read, then tutor), each capped at 118 s, so up to ~236 s;
Stop returns the panel to idle at once in either stage (code reading; not yet exercised). The 774 s / 1952 s waits in the first partial run
also overran the harness's own 130 s wait, so the machine itself stalled under memory pressure.

**Processes:** stable build left running for QA: preview **http://127.0.0.1:5190** (q/web/dist) → backend **:8011** (q/server, key from
`Desktop/Nova/server/.env` loaded into the process environment, never copied). Failure-test servers (:8012 backend, :8013 fake provider) stopped.
Restart: `cd q/server && (set -a; . <Nova>/server/.env; set +a; <Nova>/server/.venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 8011)`;
`cd q/web && npm run build && NOVA_BACKEND=http://127.0.0.1:8011 npx vite preview --host 127.0.0.1 --port 5190 --strictPort`.
Failure servers: `python tests/qa/fake_provider.py 8013`; backend :8012 with `BHARATCODE_API_KEY=fake-key BHARATCODE_BASE_URL=http://127.0.0.1:8013`.

**Exact next tests (one browser, sequential, only with ≥3 GB free):**
1. `node tests/qa/d_session.cjs 2` (EMULATED provider failures; needs :8012/:8013) — no load on BharatCode.
2. When BharatCode answers again: `SKIP_PAPER=1 node tests/qa/a_teach.cjs after3`, then `node tests/qa/d_session.cjs 1`, then `node tests/qa/c_pdf.cjs Q`.
A provider error marks that case UNVERIFIED; at most one retry.

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
