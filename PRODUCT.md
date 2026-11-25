# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Small teams of any discipline — engineering, sales, marketing, support, recruiting, general — that would rather run their own work tracker than rent one. Engineering is one audience among several; the six project templates exist so a non-technical team gets a board shaped for its work on day one. Someone on the team (often the most technical person) installs it on their own server; everyone else just signs in and works.

Roles inside a workspace: workspace admin (members, global projects), and per-project admin, editor and viewer.

## Product Purpose
Digital Board is a self-hosted, multi-user work tracker: one place where a team plans, discusses and tracks its work, running on the team's own machine against its own PostgreSQL. Success means a team can replace a stack of SaaS tools (board, whiteboard, chat, calendar sync, GitHub glue) with one install, with no per-seat bill and no data leaving their server.

## Positioning
Self-hosted and all-in-one. Board, list, calendar, analytics, Excalidraw canvas, workspace chat, meetings, GitHub sync and AI agents live in one app over one task set, on the team's own Postgres. No per-seat billing, no third-party services required. Trello, Linear and Jira cannot claim both halves: they are hosted, and each covers only part of this surface.

## Operating Context
- Installed via `npm` or `docker compose` on a server the team controls; Node 22+, PostgreSQL 14+. A fresh install starts empty and walks the first person through creating a workspace, a first project and a template.
- Daily use: the board (drag and drop by mouse, touch or keyboard), the task dialog, chat and DMs, the canvas, the bell, and ⌘K search.
- Connected tools: GitHub (cards move as branches and PRs progress), inbound webhook and email-to-ticket, outgoing webhook (Slack, Discord, Google Chat), iCal feed for calendar apps, Trello/CSV import.
- AI agents use the team's own provider key: a project agent, `@agent` in chat and card comments, and a canvas agent.
- Used on desktop and phones (below 768px the sidebar becomes a drawer).

## Capabilities and Constraints
- Monorepo: `apps/web` is the Next.js app (the product); `apps/site` is the static landing page and demo for GitHub Pages.
- UI languages: English and Bahasa Indonesia, per person. Every UI string must exist in both.
- Light and dark mode plus selectable palettes; entity colours are CSS variables, not stored hex.
- Terminology: workspace, project, board, column, card/task, card key (`WEB-42`), sheet (canvas), tag (`@name` on canvas shapes), Inbox, My Tasks, agent.
- Known limits are documented in README "Known limits" and `/docs`; future work must not claim past them.

## Brand Commitments
- Name: **Digital Board**. MIT licensed, open source.
- Voice (from existing copy): plain, factual, specific. States what a feature does and its limits rather than selling it. No hype.

## Evidence on Hand
- Screenshots from a running instance: `apps/web/public/screenshots/` (board, canvas, analytics, github, task, chat, settings, setup) and a 2-minute demo video `demo.webm`.
- Interactive demo: `apps/site/demo/`.
- No customer logos, testimonials, user counts or benchmarks exist. Do not invent them.

## Product Principles
1. **Your server, your data.** Nothing should require a third-party service to work; integrations are optional.
2. **One task set, many views.** A new surface reads the same tasks rather than adding something to keep in sync.
3. **Works for any team, not just engineers.** Developer features (GitHub, keys, webhooks) must not make the app feel foreign to a sales or hiring team.
4. **Say what it does, and what it doesn't.** Copy and UI are honest about limits.

## Accessibility & Inclusion
- Board is operable by keyboard and touch, not only mouse.
- Bilingual UI (English, Bahasa Indonesia); layouts must survive the longer Indonesian strings.
