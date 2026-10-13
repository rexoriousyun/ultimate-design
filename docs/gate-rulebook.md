# Decision gate: rule format and decision log (ultimate-design + design-guide)

Step 1 of the joint project: how design-guide writes rules so ultimate-design's `verify` can run
them (sections 1-8, drafted by the design-guide session), and how ultimate-design logs Rex's
design decisions so they can come back as proposed rules (sections 9-15, drafted by the
ultimate-design session). Each side reviewed the other's draft; the reviews are the
"**Review**" paragraphs. Nothing in step 2 starts until Rex has picked.

Today, for reference: design-guide's rules are markdown files with YAML frontmatter (`knowledge/`,
72 entries) checked by its own engine (`design-guide gate`). Nothing in ultimate-design reads them:
`verify` runs its own checks (contrast, design-system conformance, palette, hierarchy) and reports
plain sentences with no ids or severities, and no decision is logged anywhere.

## 1. ultimate-design reads one published rulebook, not design-guide's files

**Proposal**: design-guide publishes a generated, versioned JSON rulebook —
`design-guide export rulebook [--project <dir>] --json` — and ultimate-design reads only that.
With `--project`, it is scoped to that project: its users' traits, its tokens, its own
preferences. design-guide's markdown files, schema and app stay internal.

**Why**: step 4 redesigns design-guide's structure. A published contract lets that happen
without breaking ultimate-design, the same way the skill already reads a generated index
(`skill/references/`) that a test keeps in step with the source.

A missing or unreadable rulebook is a `verify` failure ("rulebook unavailable: <reason>"),
never a silent pass and never a stale bundled copy. ultimate-design caches the export per
project, keyed by its `version`, and exports again when design-guide's rules, or the
project's users, tokens or decisions, change — so `verify` does not call design-guide every
time. (Agreed with ultimate-design's review.)

**Open risks**: two representations of every rule. Mitigated by generating one from the
other and testing that they agree.

**Review (ultimate-design)**: raised that a packaged ultimate-design may run without design-guide; the missing-rulebook failure and the cache above are the result.

## 2. One record shape for every rule

**Proposal**: every rule is one record (full shape at the end):

| field | what it holds |
|---|---|
| `id` | stable, kebab-case — what a finding, a dismissal and a decision's `rule` all name |
| `layer` | `floor` (accessibility), `user` (because of the project's users), `taste` (Rex's call), `project` (this project's own preference), `art` (this project's tokens), `research` (rules about `docs/ux/` files), `recipe`, `method` |
| `status` | `confirmed` binds; `proposed` is shown, never binds |
| `statement` | the rule in one sentence, written for the design agent |
| `applies_when` | when it applies (page facts, the project's user traits) |
| `check` | how a program checks it — section 3 |
| `severity` | `fail` (blocks a clean verify) or `flag` (reported). `floor`, `art` and `research` fail; the rest flag. |
| `fix` | one line telling the agent how to fix a finding |
| `stance` | taste rules only: Rex's choice, the alternatives (with ids), and his reason in his words |
| `evidence` | sources, each with who benefits from the claim |
| `provenance` | who confirmed it and when, and the decision ids it was proposed from |

**Why**: ultimate-design's facts say a finding needs an id (for dismissals and the log), a
severity and a fix hint; these are those, plus what design-guide already keeps.

**Open risks**: `user` rules flag. Some are close to a floor for their project — 44 px
targets when the project's users have limited motor precision — so `flag` may be too weak
there. Rex's call: keep `flag`, or let a `user` rule backed by evidence (not an assumed
trait) fail when the project's Lead is `users`.

## 3. Every rule says how it is checked, in one of three ways

**Proposal**:
- **`measure`** — a declarative check from a small vocabulary that ultimate-design evaluates
  in the page it already has open: `contrast` (min ratio, large-text ratio), `target-size`
  (min px), `reflow` (width), `token-only` (which CSS properties must use project tokens),
  `palette` (the project's palette). The vocabulary grows only when a rule needs it.
- **`engine`** — a named design-guide check for what a few numbers cannot express (keyboard
  reach, focus order, accessible names). ultimate-design runs these through
  `design-guide gate <page> --project <dir> --json`, about 5–7 s a page.
- **`review`** — a checklist question for Rex or the design agent, with what to look for.
  Never blocks. This is where taste rules without a measurable form live, and the design
  review checklist.

Every `measure` and `engine` check lists the CSS properties it looks at (`check.properties`),
so an Edit-mode change can be matched to the rule it touches (`rule` in the decision log),
and the viewports it holds at (`check.viewports`; default both of `verify`'s, 1440 and 390 —
`reflow` says 320).

**Why**: Rex asked for rules "written as a check a program can run where possible". Most of
the floor is `engine` today; most taste rules are `review`. Saying so per rule keeps a
checklist question from passing itself off as enforcement.

**Review (ultimate-design)**: raised `check.viewports`; folded in above.

## 4. One implementation of each check

**Proposal**: a check has one implementation, and it is design-guide's:
- `engine` checks run only in design-guide's engine.
- `measure` checks are defined once, with test fixtures (a page that passes, a page that
  fails), in design-guide. ultimate-design's in-page evaluator implements the vocabulary and
  must pass the same fixtures, run in ultimate-design's tests;
  `design-guide export fixtures <dir>` hands them over with the measure, params and expected
  verdict each one exercises.
- ultimate-design's own `contrast.js` is replaced by the rulebook's `contrast` measure.
  Conformance, palette and hierarchy become rulebook rules too (`token-only`, `palette`, and a
  `hierarchy` measure ultimate-design contributes), so every finding `verify` reports carries
  a rule id.

**Why**: two definitions of "passes contrast" will disagree about the same page. The shared
fixtures are what keeps the in-page evaluator honest.

Timing: `measure` checks on every `verify`; `engine` checks once per turn, after the last
write, since they add 5–7 s a page. (Agreed with ultimate-design's review.)

**Review (ultimate-design)**: raised the fixtures hand-over and the timing; folded in above.

## 5. The floor never comes from decisions

**Proposal**: `floor` rules are WCAG-backed, `severity: fail`, and cannot be dismissed,
overridden or proposed from decisions. A decision touching one is marked `floor: true` (as the
decision-log draft says) and the periodic pass ignores it. Changing the floor is a
design-guide change Rex makes directly, with a source.

Everything else Rex may dismiss for one project — a `fail` from `art` or `research`, or any
`flag` — logged as an `override` with the rule's id. The design agent's own declared
exceptions (`--ds-override-*`, `--palette-override-*` properties) stay its mechanism, are
listed in `verify`'s report so Rex sees them, and are never counted as his decisions.

**Review (ultimate-design)**: raised who may dismiss what; folded in above, with design-guide's addition that `verify` lists the agent's own overrides.

## 6. One project's choice stays a project preference

**Proposal**: a decision applies to its own project first. The rulebook export for that
project includes the project's own preferences as `layer: project` rules, so the design agent
does not reopen them. Across projects, a pattern becomes a proposed rule only when:
- **at least 3 decisions, from at least 2 projects, go the same way**, and
- **none in the opposite direction from the last 3 months** (a newer contrary decision means
  his taste moved, and the pass says so instead of proposing).

A decision with `rule` set counts toward that rule. One without counts toward its
`topic` + `subject.property` (e.g. type / `font-family`), so new rules can emerge from
choices no rule covers yet.

Dismissals of an existing rule that meet the same threshold produce a proposed *revision*
of that rule — a narrower `applies_when`, or a lower severity — never a silent drop.

**Why**: one bakery's serif is a preference. The same choice across unrelated projects is
the start of a rule. The numbers are a proposal for Rex to set.

**Review (ultimate-design)**: raised what repeated dismissals produce; folded in above as revisions.

## 7. Proposals bind nothing until Rex confirms them in his own words

**Proposal**: the periodic pass writes proposed rules (`status: proposed`) citing the
decision ids behind them, with each decision's `chose`, `over` and `why`. A proposal binds
nothing. Rex confirms or rejects it; confirming requires his reason in his own words (the
`why`s in the decisions are shown, not reused). A rejection is kept, so the same proposal is
not raised again from the same decisions. Only design-guide writes rules: wherever Rex
confirms, the write goes through design-guide's command (`capture.js` and `confirm.js` today,
which already refuse to confirm without a human's words).

**Why**: design-guide's hard rule. A taste rule that fills itself with the model's taste is
the failure this exists to prevent.

## 8. Every result names the rulebook it came from

**Proposal**: the rulebook carries a `version` (a hash of its content) and a generation date.
Each `verify` report records the version it checked against, and so does each decision
logged from a finding. A rule that changes later does not rewrite what an old decision meant.

## 9. What counts as a decision

**Proposal**: three kinds, recorded only when Rex acts: `pick` (he chose one of the alternatives he was shown), `reject` (he turned something down without choosing among alternatives) and `override` (he changed what the agent made, or dismissed a finding). The agent's own choices are never recorded, and leaving the agent's work as it is records nothing: silence is not a pick.

**Where they come from in the studio today**:
- `pick`: an `ask_questions` answer (the options chosen and the ones not chosen); a board direction he goes on with; a `[data-option]` section he chooses; a design system or Wada palette he sets on the project.
- `reject`: restoring an earlier version, logged once per restore with `over` = the versions restored away (not once per change they held); a direction or option he says no to.
- `override`: Edit-mode style and text edits; tweak defaults; a finding he dismisses (section 12).

A comment is a request, not a decision. Its note can be the `why` of the decision it leads to.

**Review (design-guide)**: agreed, "silence is not a pick" is right. Asked for one `reject` per restore rather than one per change, since one restore can undo many unrelated changes and would flood the pass. Taken.

## 10. The reason is Rex's words, or it is missing

**Proposal**: `why` is text Rex wrote, copied verbatim, or `null`. The model never writes, summarises or infers it. When the design agent records a decision Rex made in chat ("go with B, the serif is warmer"), the server stores the quote only if it is an exact substring of Rex's message in that turn; anything else is stored as `null`, and a test covers a paraphrase being dropped.

**Sources of his words**: the free-text field of an `ask_questions` answer; the chat message in which he made the pick; the note of the comment that led to an override; an optional "why?" field the studio offers after an Edit-mode change, a restore and a tweak default (left empty, `why` is `null`).

A proposed rule may rest on decisions whose `why` is `null`. Confirming a rule needs his words, given fresh at confirmation (section 7).

**Review (design-guide)**: agreed; this is design-guide's hard rule, enforced rather than trusted.

## 11. Where the log lives and its shape

**Proposal**: one append-only file per project, `data/<slug>/decisions.jsonl`, one JSON object per line, next to the project's chat log. Records are never edited; a correction is a new record with `supersedes`. A JSON Schema ships at `docs/decision-log.schema.json`, and the studio's tests validate every record they write against it. Packaging (step 3) may move the data folder; the file's name and format stay. Full record in the appendix.

**Fields that matter for the pass**:
- `kind`, `chose`, `over`, `why`, `why_source`.
- `rule`: the rule id the decision touches. A dismissed finding always has one. An Edit-mode change gets one mechanically, from the rulebook's `check.properties` (section 3). On a contested call that has a taste rule, `chose` and `over` use the rule's alternative ids, so the pass counts them as votes for it.
- `topic` (`color`, `type`, `layout`, `spacing`, `density`, `shape`, `motion`, `imagery`, `copy`, `component`, `hierarchy`, `direction`, `other`) and `subject` (`page`, plus `selector` and `property` for one element's style). Together they group decisions no rule covers yet.
- `context`: the project kind, design system, palette, design version, and the rulebook `version` verify used (section 8).

**Review (design-guide)**: keep `topic` (visual dimensions) and design-guide's `category` (UI-pattern categories from the ux-master taxonomy, not to be renamed) as separate lists rather than merging them. Use `check.properties` for `rule` on edits, alternative ids for taste picks, and record the rulebook version. All taken.

## 12. Dismissing a finding, and the accessibility floor

**Proposal**: Rex can dismiss any finding except a floor one, for one project, in the studio: a `fail` from an `art` or `research` rule, or any `flag`. That is an `override` with `rule` set: the strongest signal the pass gets that a rule does not fit him. Floor rules cannot be dismissed: `verify` keeps failing, the studio offers no dismiss button for them, and any decision touching a floor rule is marked `"floor": true` and excluded from the pass entirely. The agent's own declared exceptions (`--ds-override-*`, `--palette-override-*`) remain the agent's mechanism: `verify` lists them so Rex sees each one, and they never count as his decisions, so the agent cannot quietly switch a rule off for itself.

**Review (design-guide)**: agreed (matches section 5); added that `verify` lists the agent's exceptions.

## 13. Edit-mode changes are coalesced

**Proposal**: one decision per (page, selector, property) per chat turn: the value before the turn's first edit in `from`, the last value in `chose`. Undoing back to the original value logs nothing. Dragging a colour picker through forty values is one decision, not forty.

## 14. A project's decisions are settled within it

**Proposal**: within a project, its decisions are settled. The design agent sees them (through the project-scoped rulebook's `layer: project` rules, section 6) and does not reopen them. Across projects nothing is applied automatically; only the periodic pass, at section 6's threshold, turns a pattern into a proposed rule. One project's choices, however many, are never a rule.

**Review (design-guide)**: agreed; section 6 owns the threshold (3 decisions, 2 projects, nothing contrary in 3 months), and Rex sets the numbers.

## 15. Rex confirms proposals in the studio

**Proposal**: a "Proposed rules" list in ultimate-design, read from design-guide, shows each proposal with the decisions behind it: their `chose`, `over`, `why` and projects. Confirm asks for his reason in his own words, fresh (the decisions' `why`s are shown, not reused). Reject keeps the rejection, with his reason or none, so the same decisions don't raise it again. Every write goes through design-guide's command, so design-guide stays the only writer of rules.

**Alternative**: confirm in design-guide's own app, as its drafts are reviewed today. Rejected because the studio is where Rex works and the decisions behind each proposal are its own data.

**Review (design-guide)**: agreed: the studio, through design-guide's command; `capture.js` and `confirm.js` already refuse to confirm without a human's words.

## Rex's picks

Recorded 2026-10-07. All fifteen proposals accepted as written; step 2 starts from them.

| decision | pick |
|---|---|
| 1. ultimate-design reads one published rulebook, not design-guide's files | accepted the proposal |
| 2. One record shape for every rule | accepted the proposal |
| 3. Every rule says how it is checked, in one of three ways | accepted the proposal |
| 4. One implementation of each check | accepted the proposal |
| 5. The floor never comes from decisions | accepted the proposal |
| 6. One project's choice stays a project preference | accepted the proposal |
| 7. Proposals bind nothing until Rex confirms them in his own words | accepted the proposal |
| 8. Every result names the rulebook it came from | accepted the proposal |
| 9. What counts as a decision | accepted the proposal |
| 10. The reason is Rex's words, or it is missing | accepted the proposal |
| 11. Where the log lives and its shape | accepted the proposal |
| 12. Dismissing a finding, and the accessibility floor | accepted the proposal |
| 13. Edit-mode changes are coalesced | accepted the proposal |
| 14. A project's decisions are settled within it | accepted the proposal |
| 15. Rex confirms proposals in the studio | accepted the proposal |

## Appendix A: the decision record

```json
{
  "v": 1,
  "id": "d-20261007-184012-3f9a",
  "at": "2026-10-07T18:40:12Z",
  "project": "acme-landing",
  "kind": "pick",
  "topic": "type",
  "subject": {"page": "index.html", "selector": "h1", "property": "font-family"},
  "chose": "Fraunces, serif",
  "over": ["Inter, sans-serif"],
  "why": "the serif is warmer, this is a bakery",
  "why_source": "chat",
  "rule": null,
  "floor": false,
  "dismissed": false,
  "context": {"kind": "design", "design_system": null, "palette": "wada-112", "version": "a1b2c3d", "rulebook": "9f2e41c0"},
  "supersedes": null
}
```

An `override` adds `from` (the value before). `dismissed` (added in step 2 at design-guide's request) is true only for a dismissed finding. The schema is `docs/decision-log.schema.json`. A restore's `reject` has `over` = the version shas restored away and `chose` = the version restored to.

## Appendix B: the rule record

```json
{
  "id": "target-size-enhanced",
  "layer": "user",
  "status": "proposed",
  "statement": "Interactive targets are at least 44x44 CSS px.",
  "applies_when": [{ "subject_has": "interactive-elements" }, { "user_trait": "motor-precision:limited" }],
  "check": { "kind": "measure", "measure": "target-size", "params": { "min": 44 }, "properties": ["width", "height", "padding"], "viewports": [1440, 390] },
  "severity": "flag",
  "fix": "Enlarge the hit area to 44x44 with padding, not visual size.",
  "evidence": [{ "name": "WCAG 2.2 SC 2.5.5", "url": "https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html", "incentive": "consensus standards body, no commercial stake" }],
  "provenance": { "confirmed_by": null, "confirmed_on": null, "from_decisions": [] },
  "category": "a11y"
}
```

The example is real but unconfirmed: `target-size-enhanced` is still a draft Rex has not
accepted, so it shows `status: proposed` and no confirmer.

A taste rule adds `"stance": { "choice": "top-aligned-labels", "alternatives": ["top-aligned-labels", "left-aligned-labels"], "why": "<Rex's words>" }`.
The rulebook as a whole:
`{ "version": "<hash>", "generated": "<date>", "project": "<slug or null>", "lead": "users | taste | null", "rules": [ … ] }`.
