---
name: Digital Board
description: Self-hosted work tracker; a plain, dense, neutral workspace where the team's work carries the colour.
colors:
  ink: "oklch(0.141 0.005 285.823)"
  graphite: "oklch(0.21 0.006 285.885)"
  paper: "oklch(1 0 0)"
  paper-on-dark: "oklch(0.985 0 0)"
  ash: "oklch(0.967 0.001 286.375)"
  pencil: "oklch(0.552 0.016 285.938)"
  rule: "oklch(0.92 0.004 286.32)"
  focus-grey: "oklch(0.705 0.015 286.067)"
  signal-red: "oklch(0.577 0.245 27.325)"
  entity-indigo: "#6366f1"
  entity-green: "#10b981"
  entity-amber: "#f59e0b"
  entity-pink: "#ec4899"
  entity-cyan: "#06b6d4"
  entity-violet: "#8b5cf6"
  entity-red: "#ef4444"
  priority-low: "#6b7280"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.43
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
  body-small:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.33
  meta:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    letterSpacing: "0.05em"
  mono:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "10px"
    fontWeight: 400
rounded:
  xs: "0.25rem"
  sm: "0.3rem"
  md: "0.4rem"
  lg: "0.5rem"
  xl: "0.7rem"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
components:
  button-primary:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.paper-on-dark}"
    typography: "{typography.title}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.pencil}"
    rounded: "{rounded.md}"
    padding: "4px 8px"
  button-outline-hover:
    backgroundColor: "{colors.ash}"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  task-card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "12px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px"
  nav-item-hover:
    backgroundColor: "{colors.ash}"
  modal:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.xl}"
    width: "512px"
---

# Design System: Digital Board

## Overview

**Creative North Star: "The Plain Ledger"**

Digital Board looks like a well-kept record book: factual, dense, and honest about what it holds. The chrome is zinc grey on white (or near-black at night) so the colour on screen belongs to the work itself: column swatches, labels, priority flags, avatars, a Blocked chip, a drawing on the canvas. Nothing in the frame competes with the entries.

Density is deliberate. Most text is 12–14px, metadata sits at 11px, and section labels at 10px uppercase. A card shows its key, title and a row of small icon counts, not a paragraph. Surfaces are flat and bordered; depth appears only where something is physically held (a card under the pointer, a dialog over the page). Small tactile responses — a card lifting 1px, a button pressing to 97% — make it feel handled rather than decorated.

Graphite is the canonical palette. Four themes (Harbor, Iris, Shanshui, Kanagawa) restate the same semantic tokens and may add a backdrop motif behind the page; every screen must survive all five, in light and dark.

**Key Characteristics:**
- Neutral zinc chrome; colour reserved for entities and status.
- Dense, small type with a clear 14 / 12 / 11 / 10px ladder.
- Flat bordered surfaces; shadows only on held or floating things.
- Quiet and tactile: small lifts and presses, no flourish.
- Semantic tokens only, so every palette and mode works unchanged.

## Colors

A near-monochrome zinc scale with a single destructive red; all chroma beyond that belongs to the work's entities.

### Primary
- **Graphite** (`graphite`): the primary action fill (Save, Create) and the active state in navigation. In dark mode it inverts to near-white with graphite text.

### Neutral
- **Ink** (`ink`): body text and headings; the dark-mode page background.
- **Paper** (`paper`): page, card, popover and input background in light mode.
- **Ash** (`ash`): secondary/muted/accent fill; hover background for rows, nav items and ghost buttons.
- **Pencil** (`pencil`): muted text — metadata, hints, timestamps, inactive icons.
- **Rule** (`rule`): every border and input stroke; scrollbar thumb.
- **Focus Grey** (`focus-grey`): focus ring (drawn at 50% opacity as the default outline).

### Status
- **Signal Red** (`signal-red`): destructive actions and form errors only.

### Entity palette
- **Entity Indigo, Green, Amber, Pink, Cyan, Violet, Red** (`entity-*`, the `--chart-1..7` variables): colours users assign to columns, labels and members, and the series in charts. Stored in the database as `var(--chart-n)`, never hex, so each mode and palette supplies its own validated step. Red (`--chart-7`) doubles as the Blocked / over-limit signal; Green (`--chart-2`) as the running-timer dot.
- Priorities: High uses Entity Red, Medium Entity Amber, Low a neutral grey (`priority-low`), each with an 8% tint behind it.

### Named Rules
**The Work Carries the Colour Rule.** Chrome (sidebar, header, toolbars, dialogs) is neutral. A hue appears only when it means something: an entity, a priority, a status, or an error.

**The Token-Only Rule.** New UI reads semantic variables (`--primary`, `--muted-foreground`, `--chart-n`), never a literal hex, so Harbor, Iris, Shanshui and Kanagawa restyle it for free.

## Typography

**Body Font:** Inter (with ui-sans-serif, system-ui)
**Mono Font:** Geist Mono, used for card keys (`WEB-42`) and code.
**Theme faces:** Iris swaps the body face for Plus Jakarta Sans; Shanshui sets h1–h3 in Noto Serif; Kanagawa sets h1–h3 in Shippori Mincho 700. They load lazily and only those themes use them.

**Character:** One workmanlike sans at small sizes; hierarchy comes from weight and muted colour more than from size.

### Hierarchy
- **Display** (600, 1.875rem, tight tracking): landing and first-run section headings only.
- **Headline** (600, 1.5rem): the task title in the task dialog; analytics stat values (700, tabular numerals).
- **Title** (600, 14px): dialog titles, workspace and project names, panel headers.
- **Body** (400–500, 14px): card titles (500, two-line clamp), form inputs, messages.
- **Body small** (12px): the workhorse — lists, menus, field labels (500), secondary rows.
- **Meta** (11px, muted): card metadata, hints, timestamps, counts.
- **Label** (600, 10px, uppercase, 0.05em tracking, muted): section headers in menus and the sidebar.

### Named Rules
**The Small Ladder Rule.** Application screens stay on 14 / 12 / 11 / 10px. Sizes above 14px are for one focal thing per surface (the task title, a stat), not for decoration.

## Layout

A fixed full-height shell: a collapsible left sidebar (Home, Board, Canvas, Chat, Inbox, My Tasks, Settings), a header with the view switcher, search and bell, and a scrolling content area. The board is horizontal columns of vertically stacked cards. Spacing runs on a 4px base (4, 8, 12, 16, 20, 24); cards pad 12px, dialogs 20px, menu rows 8px. Below 768px the sidebar becomes a drawer and the header goes icon-only; Settings' sub-nav becomes a horizontal row. Dialogs are top-aligned (40px down), max 512px wide and capped at 85vh with their own scroll.

## Elevation & Depth

Flat by default, with tonal layering (card on page, ash for hover). Shadows mark only things that are lifted or floating.

### Shadow Vocabulary
- **Resting card** (`shadow-sm`): task cards on the board.
- **Lifted card** (`shadow-md` + 1px rise): card under hover.
- **Held / floating** (`shadow-lg`): a card being dragged (also rotated 1°), dialogs, popovers and dropdowns.

### Named Rules
**The Held-Things-Cast-Shadows Rule.** A surface gets a heavier shadow only when the user is holding it or it floats over the page. Static panels stay flat and bordered.

## Shapes

Gently rounded rectangles from one `--radius` (0.5rem in Graphite): controls and inputs at ~6px, cards at 8px, dialogs at ~11px, avatars, presence dots and pills fully round. Every surface has a 1px border in the rule colour. Themes change the base radius (Kanagawa 2px, Shanshui 4px, Harbor 6px, Iris 12px), so components must use the radius tokens, not fixed pixels. Card cover images bleed to the card edge.

## Components

### Buttons
Quiet and tactile: small, low-contrast, and they press under the pointer.
- **Shape:** gently rounded (`rounded.md`).
- **Primary:** graphite fill, paper text, 14px medium, 8px × 16px. Hover drops to 90% opacity; disabled 50%. Shows "Saving…" while pending.
- **Outline / toolbar:** 1px rule border, pencil text and icon, 4px × 8px; hover fills ash.
- **Icon:** 4px padding, pencil icon, ash on hover, ink icon on hover.
- **Press:** every enabled button scales to 0.97 on `:active` (120ms ease-out).

### Cards / Containers
- **Task card:** paper fill, 1px border, 8px corners, 12px padding, resting shadow. Optional edge-to-edge cover image (max 192px). Stack: mono key with GitHub badge (10px) → title (14px medium, two lines) → a row of 14px icons with counts (11px muted) → labels and assignees. Hover lifts 1px; dragging rotates 1° with a large shadow.
- **Dialog (modal):** 40% black scrim, paper card, ~11px corners, header row with 14px semibold title and a close icon, bordered from the body; fades and zooms in from 95% (200ms).

### Inputs / Fields
- **Style:** 1px rule border, page background, ~6px corners, 8px × 12px, 14px text. Label above at 12px medium; hint below at 11px muted.
- **Focus:** border shifts to the ring colour; no glow.
- **Error:** 12px Entity Red text on an 8% red tint block, `role="alert"`.

### Chips
- **Blocked / over-limit:** Entity Red text and icon, medium weight, no fill.
- **Priority:** priority colour text on its 8% tint.
- **Labels:** entity colour from the palette.

### Navigation
Sidebar rows: full-width, 8px padding, left-aligned 14px text with an icon, ash on hover, graphite/accent for the active view. Section labels use the Label style. Collapses to icons; becomes a drawer on phones.

## Do's and Don'ts

### Do:
- **Do** use semantic tokens (`bg-card`, `text-muted-foreground`, `var(--chart-n)`) for every colour, and check the result in all five palettes, light and dark.
- **Do** keep app text on the 14 / 12 / 11 / 10px ladder and lead with weight and muted colour for hierarchy.
- **Do** give every surface a 1px rule border and keep it flat unless it is held or floating.
- **Do** let entity colour (columns, labels, priorities, avatars) be the colour on the screen.
- **Do** leave room for Bahasa Indonesia strings, which run longer than English.

### Don't:
- **Don't** hard-code hex or fixed radii in new components; it breaks the themes.
- **Don't** add brand colour to chrome (sidebar, header, dialog frames).
- **Don't** put heavy shadows on static panels or use shadows as decoration.
- **Don't** use display sizes inside the app beyond one focal element per surface.
