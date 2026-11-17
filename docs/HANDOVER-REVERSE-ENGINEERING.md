# Handover — YouTube Experience Reverse Engineering with REA in DSH

Status: handover / kickoff
Owner: incoming engineering lead
Applies to: Viewly (`C:\Users\Asus\source\repos\Viewly`, `main` @ `3cb266d`, tag `v0.2.1`)

---

## 0. TL;DR

We are not cloning YouTube's backend. We are reverse engineering its **experience**:
flows, states, component behaviour, interaction timings and public API surface — then
re-implementing the good parts locally in Viewly on top of the official Data API and
the official embedded player.

The work is run by **REA**, a reverse-engineering agent module inside **DSH**
(the DeepSeek harness). REA observes, records evidence and writes specs; it does not
scrape media, bypass protections or invent data.

**End goal:** a documented `YouTube Experience Spec v1`, a repeatable REA pipeline that
produces it, and Viewly at measurable parity on the dozen flows that matter — clean
enough to hand to any engineer or agent without tribal knowledge.

---

## 1. Definitions and assumptions

| Term        | Meaning in this handover                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| **DSH**     | DeepSeek Harness — the agent runtime that executes tasks, tools and checkpoints                                         |
| **REA**     | Reverse-Engineering Agent — the DSH module that observes a target surface, captures evidence and writes behaviour specs |
| **Spec**    | A versioned markdown/JSON description of a flow: states, controls, timings, edge cases, accessibility                   |
| **Parity**  | Viewly reproduces the _behaviour_ of a YouTube flow, not its branding or assets                                         |
| **Surface** | A place YouTube renders: desktop web, mobile web, embedded player, Shorts, TV                                           |

If your DSH/REA implementation differs, keep the operating model and swap the tooling
section; the gates and artifacts are the durable part.

---

## 2. Scope — what we reverse engineer, and what we do not

### In scope

- Public web and embedded-player behaviour reachable in a normal browser session
- Network requests made by our own session, recorded as HAR, for **public** endpoints
- Component inventory: navigation, cards, watch layout, comments, queue, player chrome
- State machines: loading → ready → error → empty → disabled
- Interaction timings: hover, focus, seek, resume, autoplay countdown, transitions
- Accessibility behaviour: focus order, keyboard map, ARIA roles, reduced motion
- Performance characteristics: player startup, route transitions, INP/LCP budgets

### Out of scope (hard stops)

- Downloading, proxying or re-hosting video/audio streams
- Circumventing DRM, signatures, throttling, paywalls or bot checks
- Scraping private endpoints, tokens, cookies or account data
- Reproducing YouTube trademarks, logos, artwork or comment text at rest
- Automating logged-in actions (likes, comments, subscriptions) outside official APIs

Where a capability requires a private API or a protected surface, the spec records the
**behaviour** and Viewly ships a documented, user-visible limitation instead.

---

## 3. Guardrails (non-negotiable)

1. **Local-only evidence.** HAR files, screenshots and recordings stay on the machine,
   under `docs/re-evidence/` (git-ignored). No uploads.
2. **No PII.** Strip cookies, auth headers and query tokens before a HAR is stored.
3. **Rate discipline.** One session at a time, human-paced navigation; no crawlers.
4. **Official APIs first.** Any data Viewly persists comes from the YouTube Data API.
5. **Attribution.** Viewly keeps "Watch on YouTube", the official player and the
   YouTube attribution required by the Branding Guidelines.
6. **Deletion on request.** Evidence directories are disposable; specs must stand alone.

A task that cannot pass these is rejected at the REA gate, not worked around.

---

## 4. Method — evidence → spec → implementation

```
observe ──► capture ──► normalise ──► spec ──► contract tests ──► implement ──► verify
 (REA)      (HAR/DOM)   (REA)         (human)   (REA)             (engineer)    (REA)
```

### 4.1 Observe

REA opens one surface at a time and records: route, viewport, session state, visible
controls, console errors, network calls, timings. One artefact per flow.

### 4.2 Capture

- DOM/a11y snapshot before and after each interaction
- HAR with cookies/auth stripped
- Screenshot at 390 / 768 / 1280
- Timing marks for meaningful transitions

### 4.3 Normalise

REA converts raw captures into a stable shape:
`flow`, `states[]`, `controls[]`, `events[]`, `timings{}`, `a11y{}`, `gaps[]`.
No YouTube copy, no raw HTML, no identifiers that rot.

### 4.4 Spec

A human reviews and freezes `specs/<flow>.md` + `specs/<flow>.json`. Specs are the
contract; implementation follows the spec, not the memory of a screenshot.

### 4.5 Contract tests

For each spec, REA writes assertions Viewly must satisfy (structure, keyboard, states,
timings). These live in the normal test suite and fail loudly on drift.

### 4.6 Implement + verify

Engineer implements against the spec; REA re-runs the contract tests and records
deviations in `specs/<flow>.deviations.md` with a reason.

---

## 5. REA / DSH operating model

### Roles

- **REA-Observer** — captures evidence, no code changes
- **REA-Spec** — normalises evidence into spec drafts
- **REA-Test** — turns specs into contract tests
- **Engineer** — implements
- **Reviewer (human)** — freezes specs, accepts deviations

### Task loop (one flow per task)

1. Input: flow name + surface + acceptance question
2. REA captures and produces `evidence/`, `spec.draft.md`, `spec.draft.json`
3. Reviewer freezes or rejects (24h SLA)
4. REA-Test writes contract tests
5. Engineer implements
6. REA verifies and writes a parity report

### Gates

| Gate        | Pass condition                                           |
| ----------- | -------------------------------------------------------- |
| G1 Evidence | Capture complete, PII stripped, guardrails respected     |
| G2 Spec     | States/controls/timings covered; gaps listed explicitly  |
| G3 Tests    | Contract tests fail on current Viewly and pass on target |
| G4 Parity   | Contract tests green; deviations documented              |
| G5 Handover | Spec + tests + report committed                          |

### Prompt template for REA

```
ROLE: REA-Observer
FLOW: <name>
SURFACE: <web | mweb | embed | shorts>
QUESTION: <what must we learn>
CONSTRAINTS: public pages only; no auth; no downloads; one session; strip PII
OUTPUT: evidence/<flow>/{har,doms,screens,timings}.json + spec.draft.md
DONE WHEN: every state and control is listed, gaps are named, no guardrail breached
```

---

## 6. Workstreams and ticket shape

| WS           | Flows                                          | Output            |
| ------------ | ---------------------------------------------- | ----------------- |
| A. Discovery | home, search, results, channel                 | 4 specs + tests   |
| B. Watch     | watch layout, description, comments, queue     | 4 specs + tests   |
| C. Player    | embed chrome, shortcuts, theater, listen, mini | 5 specs + tests   |
| D. Library   | history, playlists, continue watching, backup  | 3 specs + tests   |
| E. System    | loading/error/empty, a11y, perf budgets        | 3 specs + budgets |

Ticket shape (same as the FlowQuery board):
outcome, acceptance criteria, dependencies, evidence links, priority, owner.
No epics. One flow per ticket, independently verifiable.

---

## 7. Deliverables

```
docs/
  HANDOVER-REVERSE-ENGINEERING.md   ← this file
  specs/
    home.md / home.json
    watch.md / watch.json
    player.md / player.json
    ...
  parity/
    <flow>-report.md
  re-evidence/                      ← git-ignored, disposable
```

Plus:

- `specs/README.md` — spec format and versioning rules
- Contract test suite wired into `npm test`
- A parity dashboard (static page) generated from reports

---

## 8. End goal and definition of done

**End goal:** Viewly 1.0 ships as the best local-first YouTube _viewing_ experience,
built on a documented, reproducible understanding of YouTube's UX — not on private APIs.

Definition of done:

1. `YouTube Experience Spec v1` covers 12 core flows, frozen and versioned.
2. Every spec has contract tests in CI.
3. Viewly passes ≥ 90% of contract assertions; every miss is a documented deviation.
4. Performance budgets met locally: route transition < 300 ms, player ready < 1.5 s,
   INP < 200 ms, no layout shift on load.
5. Accessibility: full keyboard path for every flow, visible focus, reduced motion.
6. Zero private-API dependencies; official player and Data API only.
7. A new engineer can run the pipeline from this handover in under a day.

---

## 9. Ten-working-day plan

| Day | Work                                                              |
| --- | ----------------------------------------------------------------- |
| 1   | Set up REA/DSH workspace, evidence dir, guardrails, spec template |
| 2–3 | Workstream A (discovery) captured and specced                     |
| 4–5 | Workstream B (watch) + contract tests                             |
| 6–7 | Workstream C (player) with timing budgets                         |
| 8   | Workstream D (library)                                            |
| 9   | Workstream E (system states, a11y, perf)                          |
| 10  | Parity report, dashboard, handover review                         |

---

## 10. Risks

| Risk                                  | Mitigation                                                         |
| ------------------------------------- | ------------------------------------------------------------------ |
| YouTube changes a surface mid-project | Specs are behavioural; contract tests flag drift                   |
| Evidence leaks PII                    | Strip on capture; evidence git-ignored; disposable                 |
| Scope creep into "clone the backend"  | Hard out-of-scope list; reviewer gate                              |
| Agent invents behaviour               | Spec must cite evidence artefact + timestamp                       |
| Legal exposure                        | Public surfaces only, no protection bypass, official APIs for data |

---

## 11. Handover checklist

- [ ] Repo at `3cb266d`, `npm test` green, `.env.local` present locally
- [ ] `docs/specs/` and `docs/parity/` created
- [ ] `docs/re-evidence/` git-ignored
- [ ] REA prompt templates committed
- [ ] First flow (`home`) captured, specced and tested as the reference example
- [ ] Reviewer named and gate SLA agreed
- [ ] Parity dashboard builds from reports

---

## 12. What "clean and professional" means here

- Specs are evidence-backed, versioned and human-reviewed
- Every claim has an artefact and a timestamp
- Every deviation is written down, with a reason
- No shortcuts that create legal or ethical debt
- The pipeline is repeatable by someone who has never met us
