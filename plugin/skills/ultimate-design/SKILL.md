---
name: ultimate-design
description: Design a screen, page, flow or prototype in Ultimate Design's studio before building it, or build a design system from the codebase you are in. Use when the user asks to design, mock up, prototype or redesign UI, to "try a few directions", or to implement a design they made in Ultimate Design. The user reviews and approves the design in the studio; implement only what they approved.
---

# Ultimate Design

Ultimate Design is the user's local design studio: chat on the left, the live design on the
right, and a design agent that writes and checks HTML prototypes against design-guide's rules.
This plugin's tools drive it from here. Everything you do shows up in the studio at
http://localhost:8765, and the studio starts itself when it isn't running.

## The rule: the user confirms the design in the studio

You build and change designs from here, but the user decides in the studio. They look at the
design there, change it (chat, comments, direct edits), and press **Approve for build** when it
is right. Do not implement a design in the codebase until it is approved:

1. Make or change the design (`create_design`, `send_message`).
2. Give the user the studio link the tool returned, and say what to look at.
3. Call `wait_for_approval`. If it times out, say you are still waiting and call it again
   when they say they are done, rather than going ahead.
4. Then `get_handoff` and implement from it. `get_handoff` says "NOT APPROVED" when the design
   changed after approval; stop and ask again.

Their reasons and choices in the studio are recorded for design-guide; never answer or approve
on their behalf.

## Tools

- `list_designs` — the user's designs and design systems, with studio links.
- `create_design(name, prompt, design_system)` — a new design; with a prompt, the design agent
  builds it and the tool waits. Describe what the screen is for, who uses it and its one main
  action; leave the look open unless the user specified it. Without `design_system` it gets
  the user's default system.
- `send_message(project, message)` — a change, as if typed in the studio. If the design agent
  asked questions instead of building, the tool lists them: ask the user, then answer with
  another `send_message`. Don't invent answers.
- `wait_for_turn(project)` — keep following a turn that outlasted `wait_seconds`.
- `get_design(project)` — file paths, latest version and a thumbnail.
- `wait_for_approval(project)` — waits until the user approves the current version in the studio.
- `get_handoff(project, write_notes)` — HANDOFF.md (screens, tokens, components, interactions)
  and the design's files, with whether the current version is approved. `write_notes=true`
  asks the design agent to write or refresh HANDOFF.md first.
- `sync_design_system(source, name)` — build a design system from a folder (the repo you are
  in), a GitHub URL or a Figma URL. It is read, never changed.
- `use_design_system(project, design_system)` — attach a system to a design.

## Typical flows

- **"Design a settings page for this app."** `sync_design_system` on this repo if it has no
  system in the studio yet (`list_designs`), then `create_design` with it, then the rule above.
- **"Show me a few directions."** Say so in the prompt; the design agent puts them side by side
  on the board. The user picks one in the studio.
- **"Build the checkout we designed."** `get_handoff("Checkout", write_notes=true)`, check it
  says approved, then implement from the listed files in this codebase: use them as the spec,
  and the codebase's own components and tokens to build it.

A turn uses the user's Claude subscription, as the studio does. Prefer one clear message over
many small ones.
