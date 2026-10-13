# Decision gate: the studio's new look and structure

Rex, 2026-10-08: the interface looks too much like Claude, and it has to hold many design
systems, layouts and mockups; propose a new design, reorganising the structure if that helps.

The proposal is in `docs/design/redesign/` and, to look at, in the studio as the project
**Studio redesign** (its board has the proposal page and each look's studio and projects screens
side by side). Each structural change below stands on its own, so any of them can be taken with
any look. Nothing in the app changes until these are picked.

Settled calls this follows: `space-must-be-earned` (an element keeps its space only by earning
it), `visible-search-bar`, and `tab-bar` for phone navigation (your recorded pick, still draft).
All seven mockup pages pass `design-guide check` (no fails, no flags).

## 1. The look

**Proposal**: A, Workbench. Zero-chroma greys around the work, Geist and Geist Mono, black ink
for the one primary action, one blue for selection. A dark mode later uses the same greys
darkened, never a tint.

**Why**: the studio's main job is judging other people's colours, palettes and systems. A chrome
with no hue is the only one that can't shift how they read, and it is the furthest from Claude's
cream-and-serif look.

**Alternatives**:
- B, Nightshift: Rexorious as the chassis, restrained (Volt once per view). The most yours; loud
  chrome and a dark surround next to every design are the risk.
- C, Lightbox: the board as the whole screen on a proofing grey, floating controls, the agent as
  a command bar. The most room for the work and the biggest change in how the studio is used.

## 2. A section rail with Systems as its own section

**Proposal**: a left rail with Projects, Systems, Library and Rules (Rules shows its inbox
count). Design systems leave the project grid for their own section: tokens, components,
specimen, and which designs use each. On phones the rail is a bottom tab bar.

**Why**: today design systems are mixed into the projects grid and Library and Rules are header
links; the four kinds of thing the studio holds are not the same kind and should not share a grid.

## 3. A wide search, always visible

**Proposal**: one search field at the top of Home across projects, systems, techniques and
palettes, with `/` to focus it.

**Why**: your recorded stance is a visible search bar over a hidden icon, and with dozens of
projects and 41 techniques it earns the space.

## 4. Home without the create column

**Proposal**: the two create forms leave Home. One primary "New…" opens a sheet: a design, a
design system, or from a prompt. Home is the grid, with each card's state (approved, findings,
system, palette) and filters by state and by system.

**Why**: the forms take a quarter of the screen on every visit and are used once per project.

## 5. Studio: canvas in the centre, the agent in a right panel

**Proposal**: three columns. Left, the project's pages, directions and options. Centre, the
design on a neutral surround. Right, one panel with tabs: Agent (the chat and composer),
Inspect (today's Edit-mode inspector), Findings (design-guide's findings and the agent's declared
exceptions, with Dismiss), History.

**Why**: the chat as the left frame is the main thing that makes the studio read as Claude, and
findings, edits and versions each currently live somewhere different. One panel with tabs keeps
the agent one click away without making it the frame for everything.

**Open risks**: the chat column narrows from about 380 to 360 px, and a long agent reply competes
with Inspect for the same space; C's command bar is the alternative.

## 6. Versions as History thumbnails

**Proposal**: the full-width version slider becomes the History tab: one thumbnail per version
with its message, restore and branch on each. "Approve for build" moves to the top bar as the
studio's one primary action.

**Why**: the slider spends a whole row to pick a number; thumbnails show which version is which.

## 7. Project settings in a popover

**Proposal**: model, palette, design system, references, techniques read and cost move into a
popover from the project name. The top bar keeps one chip with the system and palette.

**Why**: today six controls sit permanently above the chat and are changed once per project.

## 8. The canvas surround is always neutral

**Proposal**: whatever the look, the area around a design is a neutral grey with no hue, light
or dark, never the chrome's own colour.

**Why**: it is the one property every direction shares, because it is what lets the studio judge
colour at all. Today's warm cream surround fails it.

## Rex's picks

Recorded 2026-10-08: "go with A, apply the structure too".

| decision | pick |
|---|---|
| 1. The look | A, Workbench |
| 2. A section rail with Systems as its own section | accepted |
| 3. A wide search, always visible | accepted |
| 4. Home without the create column | accepted |
| 5. Studio: canvas in the centre, the agent in a right panel | accepted |
| 6. Versions as History thumbnails | accepted |
| 7. Project settings in a popover | accepted |
| 8. The canvas surround is always neutral | accepted |
