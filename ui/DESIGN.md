---
name: T3 Company OS Board
description: The engineering workbook where contract-engineering execution is planned and recorded.
colors:
  sheet-dark: "oklch(0.145 0 0)"
  sheet-dark-raised: "oklch(0.205 0 0)"
  sheet-dark-cell: "oklch(0.269 0 0)"
  ink-dark: "oklch(0.985 0 0)"
  ink-dark-muted: "oklch(0.708 0 0)"
  rule-dark: "oklch(1 0 0 / 10%)"
  graphite-primary-dark: "oklch(0.922 0 0)"
  sheet-light: "oklch(1 0 0)"
  sheet-light-cell: "oklch(0.97 0 0)"
  ink-light: "oklch(0.145 0 0)"
  ink-light-muted: "oklch(0.556 0 0)"
  rule-light: "oklch(0.922 0 0)"
  graphite-primary-light: "oklch(0.205 0 0)"
  focus-ring-light: "oklch(0.708 0 0)"
  destructive-light: "oklch(0.577 0.245 27.325)"
  destructive-dark: "oklch(0.637 0.237 25.331)"
  status-inert: "#a8aeb2"
  status-live: "#2563eb"
  status-queued: "#f59e0b"
  status-review: "#7c3aed"
  status-done: "#22c55e"
  status-blocked: "#dc2626"
typography:
  title:
    fontFamily: "InterVariable, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1
  body:
    fontFamily: "InterVariable, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.43
  compact:
    fontFamily: "InterVariable, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  label:
    fontFamily: "InterVariable, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.33
  micro:
    fontFamily: "InterVariable, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    letterSpacing: "0.08em"
  nano:
    fontFamily: "InterVariable, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 500
    letterSpacing: "0.14em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
rounded:
  sm: "4.8px"
  md: "6.4px"
  lg: "8px"
  xl: "11.2px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
components:
  button-primary:
    backgroundColor: "{colors.graphite-primary-dark}"
    textColor: "{colors.sheet-dark-raised}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  button-outline:
    backgroundColor: "{colors.sheet-dark}"
    textColor: "{colors.ink-dark}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  button-ghost:
    textColor: "{colors.ink-dark}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  button-ghost-hover:
    backgroundColor: "{colors.sheet-dark-cell}"
  input:
    textColor: "{colors.ink-dark}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
    height: "36px"
  card:
    backgroundColor: "{colors.sheet-dark-raised}"
    textColor: "{colors.ink-dark}"
    rounded: "{rounded.lg}"
    padding: "24px"
  badge:
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
---

<!-- Scope: board UI (ui/). This file records the incumbent visual system in Impeccable's
     DESIGN.md format. Principles, the token-only rule and check:token-gates live in
     technical-spec/designs/DESIGN-UI.md, which wins on any conflict. The token source of
     truth is ui/src/index.css; values here are copied from it, never the reverse. -->

# Design System: T3 Company OS Board

## Overview

**Creative North Star: "The Engineering Workbook"**

The board is a workbook, not an app skin. It is part spreadsheet (rows, columns, cells you
scan), part printed tabular paper (plain sheet, ruled lines, nothing decorative) and part
CAD drawing (hairline precision, exact small type, a title block that says what the sheet
is). Engineers already trust these three objects to carry a record. The board borrows their
authority instead of inventing a brand world.

It is dense on purpose. The type ladder sits at 10–14px, the neutrals are zero-chroma
graphite, and colour appears only when it means something: the status of a card or an
agent, or the identity capsule of an agent. Dark is the default sheet (`<html class="dark">`)
and light is a full peer. Every value routes through `ui/src/index.css`.

The current colour and type values are **provisional**. DESIGN-UI.md records that brand
colour, type and iconography are being redesigned and will land only as token values. The
neutral graphite, the primary and Inter are placeholders. The status vocabulary, the
token-only structure and the workbook stance are what future work must keep.

**Key Characteristics:**
- Achromatic graphite neutrals (OKLCH chroma 0) in both themes; colour means status.
- Dense, small, exact type: Inter Variable, a named ladder at 10 / 11 / 12 / 13 / 14px.
- Flat like paper. Hairline rules and tonal cell steps carry structure, not shadows.
- Machine values (IDs, costs, timestamps, logs) set in the monospace stack.
- Dark-default sheet with a full light theme; status hues hold up in both.
- Touch floor of 44px on coarse pointers, because field engineers use it on a phone.

## Colors

A graphite sheet with no hue of its own. Chroma enters only through the status vocabulary
and the agent capsules.

### Primary
- **Graphite Ink** (`graphite-primary-dark` / `graphite-primary-light`): the primary action
  fill. Near-white on the dark sheet, near-black on the light sheet. It is a neutral, not a
  brand hue, and stays provisional until the brand redesign lands.

### Neutral
- **Dark Sheet** (`sheet-dark`): the page background in the default theme.
- **Raised Sheet** (`sheet-dark-raised`): cards, popovers and the sidebar on dark: one tonal
  step up, never a shadow.
- **Cell Gray** (`sheet-dark-cell` / `sheet-light-cell`): secondary, muted and accent fills;
  hover cells, selected rows, chips at rest.
- **Ink** (`ink-dark` / `ink-light`): body text.
- **Pencil** (`ink-dark-muted` / `ink-light-muted`): secondary text and metadata.
- **Hairline Rule** (`rule-dark` / `rule-light`): every border and divider. On dark it is
  white at 10% alpha, on light a 0.922 gray.
- **White Sheet** (`sheet-light`): page and card background in the light theme.

### Status vocabulary (the only working colour)
- **Inert Gray** (`status-inert`): backlog, cancelled, idle agent.
- **Live Blue** (`status-live`): in progress, running agent, in queue (blocked shape, blue).
- **Queued Amber** (`status-queued`): todo, paused agent.
- **Review Violet** (`status-review`): in review.
- **Done Green** (`status-done`): done.
- **Blocked Red** (`status-blocked`): blocked, agent error.
- **Destructive** (`destructive-light` / `destructive-dark`): irreversible actions only.

Status hues are seeds, not fills. Chips derive their fill, text and border through the
`.status-chip` colour-mix recipe (15% hue on white with 60%-hue/40%-black text in light;
22% alpha with 80%-hue/20%-white text in dark), which clears WCAG AA 4.5:1. Bare glyphs
use the separate AA-tuned `--status-task-icon-*` hues, which clear 3:1 against the page.

### Named Rules
**The Colour Means State Rule.** On a board surface, a hue other than graphite must name a
status, an agent, a match type or a destructive action. Decorative colour is not allowed.

**The One Vocabulary Rule.** A status renders through the same `--status-*` seed in a
chip, a row, an icon, a chart and a log line. Never introduce a parallel status palette.

Agent capsules (`--agent-1a/1b` … `--agent-10a/10b`) are brand-fixed two-stop gradients,
identical across themes, used only inside the agent capsule. They identify an agent; they
never signal state.

## Typography

**Body Font:** InterVariable (with Inter, ui-sans-serif, system-ui)
**Label/Mono Font:** ui-monospace stack (SFMono-Regular, Menlo, Consolas)

**Character:** one neutral grotesque used at small, exact sizes, like the lettering in a
drawing title block, with a monospace stack for anything a machine produced. There is no
display face; hierarchy comes from weight and position, not size jumps.

### Hierarchy
- **Title** (600, 14px, leading 1): card and section titles.
- **Body** (400, 14px / `text-sm`): default UI and content text. Inputs use 16px on
  mobile (`text-base`) to prevent iOS zoom, and 14px from `md` up.
- **Compact** (400, 13px, `--text-compact`): dense rows and secondary panels.
- **Label** (500, 12px / `text-xs`): badges, chips, metadata.
- **Micro** (500, 11px, `--text-micro`, tracking `--tracking-label` 0.08em): column
  headers, small caps labels.
- **Nano** (500, 10px, `--text-nano`, tracking `--tracking-eyebrow` 0.14em): eyebrows
  and the densest annotations. `--tracking-caps` (0.2em) is reserved for all-caps runs.
- **Mono** (400, 12px): IDs, costs, token counts, timestamps, logs.

Headings h1–h3 use `text-wrap: balance`.

### Named Rules
**The Title Block Rule.** Hierarchy is set by weight, position and ruling, not by size.
No new step above 14px enters the app chrome without a DESIGN-UI.md change.

**The Machine Type Rule.** If a machine generated the value, it is set in mono through
the shared formatting helpers. It is never formatted ad hoc per screen.

Vietnamese is the primary UI language. Inter covers Vietnamese diacritics. Labels must
allow for longer Vietnamese strings without truncating meaning.

## Layout

The spatial model is a sheet with a sidebar rail. A persistent left sidebar (raised tone)
holds navigation, and the main sheet scrolls inside `body { overflow: hidden }`. Spacing
uses the Tailwind 4px step scale, plus a family of verbatim-extracted `--sz-*` tokens. The
final spacing scale is deliberately **undecided**; per DESIGN-UI.md Principle 3, a human
picks it after the token audit, so do not normalize values here.

Inside a container, rhythm comes from one gap value, never per-element margins. Siblings
never carry both margin and gap. Breakpoints are Tailwind defaults (`md` 768px is the main
desktop/mobile switch). On mobile, a bottom nav auto-hides and the pinned composer offsets
above it (`--tc-composer-bottom`). Dialogs respect the visual viewport and safe-area insets
(`--new-issue-dialog-*-gap`). The chat-thread column caps at 60rem (`--tc-shell-max-w`).

**The Grid Before Whitespace Rule.** Density in service of scanning beats whitespace in
service of aesthetics. Space separates groups of information; it is never added to look
calm.

## Elevation & Depth

Flat, like paper. Surfaces sit on one plane and separate through hairline rules and one
tonal step (sheet → raised sheet → cell). Shadows exist only for layers that genuinely
float above the sheet: popovers, dialogs, the pinned composer. The `--shadow-extract-*`
family in index.css is verbatim debt from the token extraction, not a vocabulary to extend.
The `shadow-xs` on outline buttons and inputs is the shadcn default and is the ceiling for
in-plane elements.

### Named Rules
**The Paper Rule.** Anything on the sheet is flat. If an element needs to stand out, give
it a rule, a tonal cell or a status seed. Do not lift it.

## Shapes

Corners come from one knob: `--radius` (0.5rem = 8px). Every step is a multiple of it
(sm 0.6×, md 0.8×, lg 1×, xl 1.4×, up to 4xl 2.6×), so changing `--radius` retunes the whole
app. Controls use md (6.4px), cards lg (8px). Badges and status chips are fully rounded
pills. Borders are always 1px hairlines in the rule colour.

The direction is **ruled and exact**: a control should read like a cell or a field on a
form sheet. When the corner language is revisited, it moves toward the smaller end of the
ladder by tuning `--radius`, never by per-component overrides.

## Components

The component philosophy is ruled and exact: hairline borders, small radii, no decoration.
Every primitive lives once in `ui/src/components/ui/` (shadcn base), and variants are props.

### Buttons
- **Shape:** gently squared (md, 6.4px).
- **Primary (`default`):** graphite ink fill with inverse text, 40px tall, 16px inline
  padding, 14px medium.
- **CTA:** foreground-on-background inversion, for the single strongest action on a
  surface.
- **Outline / Secondary / Ghost / Link:** a hairline outline on the sheet, a cell-gray
  fill, a fill on hover only, and underline on hover.
- **Destructive:** destructive red fill (60% in dark). Only for irreversible actions.
- **Hover / Focus:** hover drops the fill to 90%. Focus-visible shows the ring colour at
  50% via the `--rad-3` ring width; invalid state rings in destructive.
- **Sizes:** xs 24, sm 36, default and lg 40, icon 24/36/40. On coarse pointers controls
  get a 44px floor, except dense inline widgets whose row provides the touch area.

### Chips
- **Status chip:** a pill with a hairline border in the status seed and a colour-mix fill
  and text (see Colors).
- **Match chips:** title (blue 265), comment (green 145) and document (violet 295) tinted
  chips for search matches; identifier matches use the muted neutral.
- **Badge:** pill, 12px medium, 2px × 8px padding, a variant per role.

### Cards / Containers
- **Corner Style:** lg (8px).
- **Background:** raised sheet in dark, white sheet in light.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Border:** 1px hairline rule.
- **Internal Padding:** 24px block and inline, 24px gap between header, content and
  footer.

### Inputs / Fields
- **Style:** transparent on light; 30% input-tint fill on dark. Hairline input border, md
  radius, 36px tall, 12px inline padding.
- **Focus:** border shifts to the ring colour with the 50% ring.
- **Error / Disabled:** destructive ring and border; 50% opacity with not-allowed cursor.

### Navigation
- **Sidebar:** a raised-tone rail with its own token set (`--sidebar-*`). Rows are inset
  pills (lg radius). The active row gets the cell-gray accent fill at full ink; inactive
  rows sit at 80% ink and take a half-strength accent on hover. (`--sidebar-primary` is
  defined, as a saturated blue in dark, but no component uses it.)
- **Mobile:** an auto-hiding bottom nav. Content and the pinned composer reserve its
  height.

### Agent Capsule (signature)
Each agent is a capsule filled with its two-stop brand gradient (`--agent-Na` →
`--agent-Nb`), identical in both themes. "The capsule is the agent." It is the only
gradient in the system and the only place the agent palette appears.

## Do's and Don'ts

### Do:
- **Do** take every colour, size, radius, shadow and motion value from `ui/src/index.css`
  tokens, and run `pnpm check:token-gates` before committing UI changes.
- **Do** render every status through its `--status-*` seed and the `.status-chip` /
  `.status-fill` recipes, identically in chip, row, icon, chart and log.
- **Do** set IDs, costs, token counts, timestamps and logs in the mono stack via the shared
  formatters.
- **Do** separate surfaces with a 1px hairline rule or one tonal step.
- **Do** check both themes. Dark is the default, but light is a full peer.
- **Do** keep the 44px touch floor on coarse pointers for primary controls.
- **Do** use the motion tokens (`--motion-duration-*`, `--motion-ease-out-expo`,
  `--motion-ease-standard`) and honour `prefers-reduced-motion`.

### Don't:
- **Don't** add hue to the neutrals or introduce decorative colour. A hue must name a
  state, an agent, a match type or a destructive action.
- **Don't** lift in-plane elements with shadows, or extend the `--shadow-extract-*` debt.
- **Don't** use hex, raw px, Tailwind bracket values or palette classes (`bg-red-500`) in
  `ui/src/components/**` or `ui/src/pages/**`.
- **Don't** add a type size above 14px to app chrome, or a display face.
- **Don't** treat the current neutrals, primary or Inter as the final brand. They are
  provisional until the redesign lands as token values.
- **Don't** use the agent gradients for anything but the agent capsule.
