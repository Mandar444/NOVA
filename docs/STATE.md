# NOVA — build state

_Last updated: 2026-11-24_

## Hybrid handwriting + teaching (2026-11-24, branch `hybrid-reader` from `perf-latency` @ 9853a59; local only, not deployed)
- **Route per line:** pen-up → (existing debounce) → NOVA's own reader in a Web Worker (`web/public/reader/`, model v3g: 90,711-param CNN, ~363 KB, loaded once, ~10–50 ms warm). A line that passes the reliability gate (confident, no question/guard, every symbol p ≥ 0.9, only digits + − × =, sane sizes/grouping) goes straight to the exact engine. Anything else → BharatCode reads the ink crop as before. Both paths feed the same `/auto` engine.
- **Uncertain lines:** the local reader's own symbol questions (1 vs /, "something else", "two numbers") show under the line while the cloud reads; answering them re-reads locally and offers the reading to confirm (never auto-acted). Cloud failure/offline → "NOVA's own reading: … Use it / Edit" + Retry; ink is never lost.
- **Cross-check:** if the local reader saw a decimal point/comma the cloud reading lacks, or the cloud reading has a leading-zero number ("05"), the line is shown for confirmation instead of being answered (the reading is not rewritten).
- **Writing area:** reading chips/panels no longer swallow pen-down: plain label areas take ink, buttons distinguish tap vs drag (`data-pass-ink`, Workspace `tap-or-draw`). This fixed strokes that started on a chip silently disappearing (seen with the real provider: "91 − 23" lost its 9 and 3 → answered −1).
- **Engine:** both sides of "=" checked (2×2=2+2 ✓, 2×2=2+3 ✗); "0/0=" → "undefined" written explicitly; wrong marks carry an instant rule-based hint (`server/app/maths/hints.py`, never reveals the answer) shown beside the ✗.
- **Waiting:** 8 s "Still reading — keep writing, correct it below, or Stop"; 30 s per-line deadline; 45 s shared deadline for one help request (`NOVA_TEACHING_DEADLINE_S`, exposed in capabilities).
- **Feature flag / rollback:** `?localReader=0` or `localStorage['nova.localReader']='off'` → cloud-only (previous behaviour). Full rollback: check out `perf-latency`.
- **Training:** one capped run (v4, 7 epochs/1168 s) failed the gate (original synthetic exact 269 < 283, answered 179 < 206; 2 wrong-before on targeted lines) → **v3g kept**. Report: `LLM_data/hwprep/STAGE1_V4_RESULTS.md`.
- **Licence:** v3g weights include MathWriting (CC BY-NC-SA) → non-commercial use only until retrained on cleared data.
- **Verified** (browser journeys, `scratchpad/qa/hybrid_journey.cjs`): real BharatCode — 15/15 lines correct or asked, 0 wrong automatic outputs, 8 lines local (pen-up→checked ≈ 2.1 s, i.e. the debounce), cloud lines 4.8–11.5 s; teaching replies 4–9 s. Simulated provider (mocked): busy→Retry, slow→8 s message→Stop, edit during read (superseded request aborted), page switch, offline, reload (145/145 strokes), progressive PDF (page 1 writable at 2.5 s while analysis still running), mobile *emulation* 390×844. Not verified: real phone/tablet, real pen hardware, cold load on a slow network.
- **Known limitation:** "I still don't understand" without a selected line follows the page's latest line, not the previous hint's topic.

## Handwriting latency incident (2026-11-23, branch `perf-latency` from `ui-orbit` @ 344b989; local only, not deployed)
"3 + 2 =" took ~220 s. Traced one line from last pen-up to NOVA's answer (client `nova-trace` marks + server `X-Nova-Timing`).
- Baseline (real BharatCode, before): pen-up→answer **92.2 s** = 2.0 s pause + **89.9 s provider** (1 vision call, 12 KB image, reasoning off) + 4 ms exact maths + render. No hidden SDK retries.
- How 220 s happened: one read slot with no cancel, so a read of the half-written line held it for up to 110 s before the full line was read (another 110 s); a line with "?" or a problem on the page then went to a second model call (`solve_any`/`_answer_question`) with its own 110 s. Per-call timeouts, no total.
- Fixes: one 30 s budget per line counted from the last change (`NOVA_INTERACTIVE_DEADLINE_S`, sent as `X-Nova-Deadline-Ms`; provider calls use what is left; the one 400-resend only if >3 s left). Editing a line cancels its in-flight read; two lines can be read at once; Stop cancels reads; server cancels work when the browser disconnects. Plain arithmetic (digits/operators/=/?) is finished by the exact engine only — never a model call. A doubtful digit in a line ending in "=" now asks (it used to be dropped and NOVA answered a guess). The status pill shows "Reading your line…", seconds and Stop. Timeout/busy/unreachable messages say why. Pages-rail header no longer hidden under the top capsule.
- Simulated provider (1.5 s): add/sub/mul/wrong 3.6–3.9 s pen-up→answer, 1 provider call each; slow → stops at 30.0 s; busy → 2.1 s; unreachable → 4.1 s; edit during read → stale read cancelled in 0.7 s; Stop → idle in 32 ms, next line 3.6 s; page switch → read cancelled, nothing on new page; PDF analysing (20 s) → Page 1 answered in 3.6 s.
- Real provider after the fix: 3 runs, all stopped at 30.0 s (provider ≥28 s, 1 call, no retry). **The provider dominates; ~5 s is not reached with BharatCode vision today.**
- Tests: server 223 passed (new tests/test_latency.py), web 53 passed (new recognition/scheduler.test.ts), build ok. QA scripts: scratchpad qa/lat_trace.cjs, qa/lat_cases.cjs.

## Orbit UI, rebuilt to the boards (2026-11-23, later the same day)
The first pass was judged too far from the design. Every screen was then rebuilt from the board source and compared side by side
with a render of the board (scratchpad design_render/*.png): Home (laptop + phone), Notebook (laptop, tablet, phone), Ask, Question
paper + Test panel, Settings, Practice dialog. Styles: web/src/{home,notebook,testpanel,settings,practice}.css after orbit.css.
New real data/settings behind design elements: 7-day progress (Progress.week), streak, practice sets in progress, Settings ›
Show what NOVA read, Voice language (English / Hindi / Hinglish), handwriting progress, practice class/level/count (up to 15) and
"allow help" per set. Design ink palette (navy default). Deviations kept on purpose: Explain / Full solution in the Test panel
open after Finish (the server gives hints only during a test); answer space sits beside the printed question (the sheet is one
image, so space cannot be inserted below a question); "This week › Progress" opens practice (there is no progress page).
Not rebuilt yet: the interactive first-run walkthrough (Welcome board). Not tested on a physical device.

## Orbit UI (2026-11-23, branch `ui-orbit` from origin/main c065034; local only, not pushed)
Design source: the "NOVA — New UI" Design canvas (17 boards). Grid paper, canvas drawing and NOVA's ink colour unchanged.
Checks: server pytest 212 passed, web vitest 48 passed, tsc clean, build ok. Run locally: http://127.0.0.1:5180 (vite preview of
web/dist) with the backend on :8010.

| Area | What changed |
|---|---|
| Look | `web/src/orbit.css` (loaded last): Orbit tokens light/dark, Iris accent, bundled Bricolage Grotesque + Plus Jakarta Sans, glass bars, iOS-style press (scale .96, 160 ms), reduced-motion respected |
| Notebook | floating capsules (back · title · saved · page n/N; Assist · Test · Ask NOVA · More), one status pill (ready / working with seconds + Stop / plain-language error + Retry), tool dock bottom on laptops, left edge on touch screens, phone bar (Pen, Eraser, Move, Undo, More); the page starts clear of the bars |
| Readback | quiet chip under the line; tap → card with I read · Edit, Hint / Explain / Full solution, Graph, Ask about this line |
| Ask | docked column beside the page (page shrinks), bottom sheet on phones; Hint/Explain/Full solution chips; Copy and Show on page on replies; skeleton + Stop while waiting |
| Test | one side area: Test and Ask as tabs; numbered questions, open one expands; Hint only during a test, Explain after marking; answer frames beside each printed question in the grid margin (the band NOVA reads as that answer); a page NOVA fitted refits when the panel opens |
| Home | greeting, Continue card with real page preview, New notebook / Import paper / Practice tiles, notebooks as real page previews; streak and daily goal removed |
| Dialogs | cards on larger screens, bottom sheets on phones, iOS-style switches |
| Pen | NOVA's cards no longer swallow the pen; they fade while writing (found by the simulated session: 2 of 13 strokes were landing on a card) |

Verified (headless Chrome, screenshots at 1440×900, 1194×834 touch, 390×844; light and dark): notebook, readback chip and card,
Ask (laptop dark, phone light), Test panel with answer frames (question finding SIMULATED for the screenshots), Home, Welcome,
Settings. Simulated regressions on the new UI: session (identical after reload, 13/13 strokes), Stop (idle 85 ms, late reply never
shown), second question replaces pending. Real-model reads/answers timed out during these runs (BharatCode slow); the plain-language
errors showed correctly.
Not done: no physical phone/tablet test; Practice dialog not screenshotted; design items left out on purpose (streak, progress
numbers, search on phone header, auto-retry countdown); older ad-hoc scripts in tests/e2e may still use removed selectors.

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

## Voice + dictation (2026-11-24, branch voice-dictation; local only, partly verified)
- Shared voice session (pause/resume/stop/cancel, drafts persist, retry kept audio); offline faster-whisper preferred (works in Brave), model found in main checkout; /capabilities honest.
- "Write" toolbar mic: spoken maths -> editable preview -> inserted as student text block (undo/redo/reload/export), never solved.
- Spoken replies with Play/Stop, mute toggle, maths read naturally; follow-ups stay on last question; Explain writes expression + rule; full solution ends on engine-checked value.
- Verified: server 258 + web 79 tests. NOT yet verified: Brave/browser journey with audio, real mic/speaker.

## Write/speak → understand → teach → solve (2026-11-24, branch voice-dictation; local only, not deployed)
- Recognition: a deadline now says "time-out" (not "service busy"); Solve makes ONE bounded reading attempt — a failed read stops with Retry + "Type the expression" (no hidden second 30 s wait). Typed corrections bypass OCR.
- Notation is settled with the student before computing (server `maths/notation.py`, `clarify` in TutorResponse, card beside the line): ∫ without dx ("Use dx"), scope of sin x², dy/dx f(x) = derivative or equation. dy/dx = f(x) is treated as a differential equation (never as algebra, never auto-answered).
- Closed problems (∫, d/dx, lim) get exact engine working on the page (`maths/worked.py`): ∫₀² x² dx → [x³/3]₀² → 8/3; ∫₀¹ x²/100 dx → 1/300; lim keeps θ symbolic. No exact method → model working labelled "not engine-checked".
- Selection menu: Hint | Next step | Explain | Full solution | Check | Ask | Edit (+ Move | Delete for dictated). Graph only for y = f(x). Next step = one step (own teaching mode).
- Dictated blocks: KaTeX, measured size, inserted in clear space in view; drag handle (zoom-correct, one undoable move, Esc cancels, anchored answers follow, no re-reading); identity = text only.
- Ask by voice: "Done & Ask" (finish, bounded wait, send once); sent question shown at once; failed send restores the draft.
- Verified: server 266, web 81 tests; live API checks with real BharatCode (see handoff). NOT verified: browser journeys (Playwright run not executed), real microphone/speaker, Brave by hand.

## Voice submission fixes + real-browser results (2026-11-24, branch voice-dictation; local only, ready for Antigravity QA)
- Done & Ask: submits through the LIVE session state (not a stale render value) with an operation token → exactly one send; a second click, Cancel, a new capture or closing the panel voids it. Voice provenance + final transcript kept.
- Transcription timeout (15 s): the expired operation is isolated (in-flight requests aborted, their audio kept for "Retry transcription"); box unlocks with the words so far; nothing auto-sent; late results ignored (never overwrite edits).
- Fixed: dictated blocks rendered as "int02 x2" — TeX backslashes were lost (shell escaping); the unit test now checks real KaTeX output.
- Tests: web 87 (incl. 6 component tests on the real Done & Ask button — 3 fail on the previous component), server 266.
- Real browser (Brave 1.x, headed, Windows; SYNTHETIC speech from Windows SAPI as the fake microphone; real faster-whisper; real BharatCode):
  - dictation with a 4 s pause: all words kept ("integral of x squared from 0 to 2"), preview ∫₀² x² dx, inserted once, not solved; undo/redo/reload/page switch OK
  - Done & Ask (+ double click): one tutor request; reply 7.4 s; spoken reply started (4 voices), Replay/Stop worked
  - transcription failure (503 injected): words kept, Retry transcription → text; pause/resume/cancel/close/reload keep the draft
  - menu Full solution on the dictated integral: [x³/3]₀² = 8/3 on the page in 0.57 s; Explain wrote working (13.3 s); follow-up stayed on ∫ (15 s)
- Handwriting timings (Brave, last pen-up →):
  - arithmetic "3 + 2 = 6" (local reader): reading ≈ 2.1 s (≈2 s is the pause debounce; model ≈ 50–180 ms), mark visible 2.19 s
  - advanced "sin(x+1)=" (local reader unsure → cloud): local 2.19 s, crop 2.33 s, cloud reading 20.4 s, of which the BharatCode call itself was 17.9 s (server total 18.1 s) — the time is in the provider's vision call, not NOVA; no answer was written within 40 s
- NOT verified: real microphone/speakers (only synthetic audio + the browser's speech engine); mic-permission denial in a real browser (Brave shows a prompt in headed mode — covered by unit tests only); "dy/dx sin x²" by hand (the QA glyph font has no "d").
- Limitation: follow-up replies may mention other lines on the page (page context is sent); the advanced-handwriting latency depends on BharatCode.

## Follow-up routing fix (2026-11-24, branch voice-dictation; local only)
- Root cause: `FOLLOW_UP` in web/src/tutor/useNova.ts contained two literal U+0008 (backspace) characters instead of `\b` (shell-escaping damage), so "I still don't understand" never matched and went to the latest line. Rewritten from a file (backslashes preserved); straight and curly apostrophes accepted.
- Anchored follow-ups now send only their own question/step as page context (other lines can't pull the reply elsewhere).
- Second bug found by the browser regression: selecting a dictated question B still taught the page's first problem A (B, an equation, was treated as a step of A). A dictated question is now always its own problem when selected.
- Escaping scan: no other control characters in web/src. PRE-EXISTING (before this branch, in perf-latency 9853a59): `_ASKED_TO_WRITE` in server/app/services.py also has two U+0008 instead of `\b`, so it never matches. NOT changed here — fixing it relaxes a hint safeguard (questions containing "add"/"list" would let NOVA write the student's next step); needs a deliberate decision.
- Tests: web 90 (incl. real phrases, curly apostrophes, and a control-character scan of the edited files); server 266 unchanged.
- Browser regression (real build, real BharatCode, synthetic nothing): Explain A (∫₀² x² dx, 12.2 s) → dictate B (x² + 3x − 4 = 0) → clear selection → "I still don’t understand": request problem = A, page context = A only, reply about the integral (10.6 s) → select B → Hint: request problem = B (8.1 s).

### Handoff to Antigravity browser QA (build: http://127.0.0.1:5180/, backend 8010)
Report handwriting recognition time (last pen-up → reading) separately from computation and canvas rendering; use explicit maths tasks; mark synthetic audio vs a real microphone/speaker.
1. Handwritten derivative: write "dy/dx sin x²" → select → Full solution → expect a clarification card (sin(x²) / (sin x)² / dy/dx = sin(x²)) → pick each → d/dx sin(x²) = 2x cos(x²); d/dx (sin x)² = 2 sin x cos x; the equation stays an equation.
2. Voice: Speak → talk with a pause → Done & Ask (sends once); Cancel during "Finishing…" (nothing sent, draft kept); slow transcription → after 15 s the box unlocks with words kept + Retry transcription.
3. Move a dictated question (✥ Move) while a Full solution / Explain is pending → the answer lands next to the question's new position; Undo moves both back.
4. Phone width (390 px): toolbar Write/Speak, selection menu wraps, clarification card fits.
Known: advanced handwriting depends on BharatCode's vision call (measured 17.9 s for "sin(x+1)="); no real-microphone test has been done.

## _ASKED_TO_WRITE removed (2026-11-24, branch voice-dictation; local only)
- Product decision: words such as "write", "add", "list", "notes", "formula" never bypass teaching safeguards. The malformed `_ASKED_TO_WRITE` pattern (two U+0008 instead of `\b`) and its exemption in `_is_students_step` are gone; only the teaching mode (hint / next / explain / solution) and an explicit full-solution request decide. Unrevealed tests stay hint-only.
- "Write this question" (also copy/put … the/my question): the question itself is written on the page, nothing solved, no model call.
- Reference material (e.g. "Write a trigonometry table") is written; any unrelated solution step in the same reply is still validated away.
- Regressions (server/tests/test_write_requests.py, reply text AND canvas, with a deliberately over-sharing model reply): "Write a hint for this", "Help me add 3 to both sides", "Add notes explaining the rule", "Write this question", "Write a trigonometry table", "Write the full solution", and the same during an unrevealed test.
- Checks: server 273, web 90, typecheck clean, no control characters left in server/app or web/src. Backend 8010 restarted; 5180 serves the current build. Antigravity's four QA cases (above) are unchanged.

## Question handling: handwritten + imported-paper questions (2026-11-24, branch voice-dictation; local only)
Root causes
- Paper: exam requests carried no stable question id and all exam turns shared history (problemId undefined) → Q2's turns fed a Q3 request; Explain from the selection menu ignored the paper; general Ask picked the question under the latest-written line; ownership was re-guessed from position every time.
- Handwriting: one global clarification slot (a late reply replaced another line's card); Full solution flows were not tied to a request generation (a slow line-1 flow started its request after line 2's and cancelled it); calculus went through the auto path first (a needless model call, 30 s); a closed lasso counted as a tap; the phone "More" menu stayed open over the page after choosing Select.
Changes
- `web/src/tutor/questionContext.ts`: one question context (test/question ids, exam payload, history key `q:<id>`, the question's own work). Answer ownership recorded once per region (`PaperTest.answerOwners`, `ownAnswers`) — stable through reload, scrolling, edits, moves.
- Every help action (menu, readback card, Ask panel) resolves the selected work's question first (explicit selection > the question the student opened > latest work). Requests carry `exam.id`; history is per question; follow-ups ("Why?") keep the exam context. The Ask panel and cards name the question ("Question 3 — your answer: …"). An unreadable selected answer → a "type your answer" card for THAT answer.
- Clarifications are per line and tied to the line's content hash; resolving re-runs the same action with the same question context. Solve flows check a generation token before asking. Calculus/limits skip the auto path. "Type it" on failed readings; typed corrections are never re-read. Closed lasso fixed; More menu closes after picking Select; Ask-sheet chips gain Next step.
Tests: web 93, server 273; no control characters in server/app or web/src.
Browser results (real build, real BharatCode; handwriting = SIMULATED pointer strokes; delays/failures INJECTED where noted; phone = EMULATION with real touch events)
- PASS paper (paper5.pdf, 2 pages, numbers 1–2 repeat): import 23–38 s; answers attributed Q1/Q2/Q3; Explain Q3 → exam.id = Q3, Q3 text, Q3 answer, reply placed in Q3's area; edit Q2 then Explain Q3 → still Q3; Q2 reply delayed 10 s (INJECTED) while switching to Q3 → Q3 correct, Q2's late reply discarded (not placed under Q3); "Why?" → Q3 with Q3-only history; reload → owners kept, Explain Q3 correct.
- FAIL/limit: the FIRST Explain on Q3 while its cloud reading was still pending produced no reply within 83 s (the reading timed out; the type-your-answer recovery appears).
- UNTESTED in browser: repeated numbers on page 2 (harness could not open page 2) — covered by unit tests only.
- PASS handwriting: ink crop is complete and correctly grouped ("dy/dx sinx²" one region); cloud reading of it timed out at 30 s on every attempt today (server: provider 27.8 s of 27.8 s total — BharatCode, not NOVA); recovery via Edit/Type it with 0 extra recognitions; per-line cards: line A's delayed reply (INJECTED) did not replace line B's card; choices solved separately: d/dx sin(x²) = 2x cos x² ; d/dx (sin x)² = 2 sin x cos x = sin 2x ; dy/dx = sin(x²) kept as a differential equation (y = ∫ sin(x²) dx + C). Choice → solution on canvas 0.56 s (was 30.7 s).
- PASS phone emulation (390×844, touch): More → Select closes the menu; tapping the line selects it and opens its sheet (Hint | Next step | Explain | Full solution | Check, all on screen); Full solution by touch → working to x = 4 in 9.3 s.
Timings (last pen-up →): local reader 2.1–2.3 s (unsure on calculus); cloud reading 10–13 s on earlier runs, time-out at 30 s today; clarification card 75–106 ms after Full solution when the reading exists; exact computation + canvas 0.56 s.

## Bounded help requests (2026-11-24, branch voice-dictation; local only)
- One help budget per Explain/Solve (absolute 45 s deadline + one abort signal) carried through the recognition queue, joining a running read, the read itself, state waits and the tutor request; nothing restarts the clock; an expired budget is never extended (the old 3 s minimum is gone); Stop cancels queued/joined/active work and nothing starts afterwards. Retry repeats the exact request (question, work, mode) with a fresh budget.
- Unreadable selected answer: the card keeps the question ("Question 3: NOVA couldn't read your answer …") and offers Retry reading, Type my answer, and — where test rules allow — "Explain question 3 (not my answer)" (hint in an unrevealed test; no answer reviewed).
- Tests: web 98 (5 bounded-budget scheduler tests with fake timers), server 273.
- Browser (real build; INJECTED where noted): silent recognition while Explain joins the read → recovery card at 26.7 s, 0 tutor calls, ink kept; "Explain question 3" → Q3 id, hint, no answer; Q3 failure (injected 503) → Retry → Q3; Stop while waiting on a silent read → 0 tutor and 0 recognition calls afterwards, ink kept; page 2 of a two-page paper with repeated numbers → page-2 Q1 identity, own history, reply on page 2 (the earlier page-2 failure was the test script clicking the wrong element, not the app). Stop with BOTH slots occupied: unit-tested only.
- REAL handwriting recognition: FAILED/BLOCKED today — "dy/dx sin x²" timed out at 30 s (BharatCode 27.97 s per call; another call 20.5 s). Typed-correction tests prove clarification/solving only.
