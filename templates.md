# Project Templates

Spec for the project templates offered when a workspace or project is created.
An agent reads this file to (a) build the template picker and seed data, or
(b) seed a project / draw a canvas from a template's **Agent prompt**.

## How to use this file (agent rules)

- **Fit the current schema.** A template can only seed what exists today:
  - `columns(title, color, position)`
  - `tasks(title, description, label, priority, due_date, position)`
  - `canvases` (one sheet; content is a `Flow` from `lib/canvas/flow.ts`)
- **Colours** are tokens, never hex: `var(--muted-foreground)` or `var(--chart-1)` … `var(--chart-7)` (`PALETTE` in `lib/board.ts`). Conventions from `DEFAULT_COLUMNS`: the first/intake column is `var(--muted-foreground)`, active work is `chart-1`, review is `chart-3`, done/won is `chart-2`. Never go past `chart-7`; reuse instead.
- **Priority** is one of `low | medium | high` (`PRIORITIES`). Each template says what the levels mean in that domain.
- **Label** is one free-text value per task. `labels[]` lists the values the template suggests for it, not a separate table.
- **Due dates** in starter tasks are offsets (`dueInDays`) and become `YYYY-MM-DD` relative to the creation date.
- **Canvas** uses the agent's `Flow` shape: `nodes[{id,label,shape}]` with `shape ∈ start | end | process | decision | data`, `edges[{from,to,label?}]`. Pass it through `parseFlow` → `layoutFlow` like an agent answer.
- Each template has one ```json block (machine-readable, valid JSON) and one **Agent prompt** (copy as-is, fill `{placeholders}`).
- Feature markers: ✅ exists today · 🟡 small change · 🔴 new feature.
- Starter tasks are examples. The picker should offer "with example tasks" vs "empty board". Default: columns only.

### Wiring (done for columns)

- `TEMPLATES` + `templateOf(id)` in `lib/board.ts` hold each template's `id, name, description, columns` (copied from the JSON blocks below; keep both in sync). `DEFAULT_COLUMNS` is gone; `general` (first entry) is the default and the fallback for unknown ids.
- Picker: `components/template-picker.tsx`, a 2-column grid of cards (1 column on phones). Each card shows a mini-board preview built from `TEMPLATES` columns, plus example-task blocks when the checkbox is ticked. It's used in `components/register-form.tsx` (picking a template refills the column chips below it) and in `components/new-project-dialog.tsx` (Settings → Projects → "New project").
- Server: `registerAction` reads `template` from the form; `addProject(name, templateId?)` seeds that template's columns.
- Examples: an "Add example tasks and a canvas sheet" checkbox in both forms. `seedProject()` in `lib/actions.ts` inserts `starterTasks` (skipping any whose column was unticked) and one canvas sheet in the same transaction. The sheet stores `{ elements: [], seed: { flow, by } }`; the first editor tab to open it claims the flow via `POST /api/canvas/[id]/seed` (one atomic UPDATE removes `seed` and returns it), draws it, and other tabs get it over live sync.
- Example data lives in `lib/template-examples.json`, **generated from the JSON blocks in this file**. After editing a block, regenerate it:
  `node -e 'const s=require("fs").readFileSync("templates.md","utf8");const o={};for(const m of s.matchAll(/```json\n([\s\S]*?)```/g)){const t=JSON.parse(m[1]);o[t.id]={tasks:t.starterTasks,canvas:t.canvas}}require("fs").writeFileSync("lib/template-examples.json",JSON.stringify(o,null,2)+"\n")'`
  then run `node --experimental-strip-types lib/board.check.ts`.
- Still not used: `labels` (the task label is free text, so there is nothing to seed).

---

## 1. Software / Tech

**For:** product and engineering teams shipping code. **Card =** a ticket (feature, bug, chore).

**Workflow:** Backlog → Todo → In Progress → In Review → QA → Done
- *In Review* = PR open. *QA* = merged to staging, being tested. *Done* = released.

**Priority:** high = blocks a release or production bug · medium = planned for this sprint · low = nice to have.

**What sets it apart:** cards are tied to code. The board should move by itself from Git and CI events (see [Git / CI-CD integration](#git--ci-cd-integration-tech)).

```json
{
  "id": "tech",
  "name": "Software / Tech",
  "description": "Sprint board for engineering teams, ready for Git and CI/CD.",
  "columns": [
    { "title": "Backlog", "color": "var(--muted-foreground)" },
    { "title": "Todo", "color": "var(--chart-4)" },
    { "title": "In Progress", "color": "var(--chart-1)" },
    { "title": "In Review", "color": "var(--chart-3)" },
    { "title": "QA", "color": "var(--chart-5)" },
    { "title": "Done", "color": "var(--chart-2)" }
  ],
  "labels": ["Feature", "Bug", "Chore", "Tech debt", "Docs", "Security"],
  "starterTasks": [
    { "column": "Backlog", "title": "Set up CI pipeline (lint, test, build)", "label": "Chore", "priority": "high", "description": "Run on every pull request. Block merge when it fails." },
    { "column": "Todo", "title": "Login page", "label": "Feature", "priority": "medium", "description": "Acceptance criteria:\n- Email + password\n- Error on wrong password\n- Redirect to dashboard", "dueInDays": 7 },
    { "column": "In Progress", "title": "Fix: session expires too early", "label": "Bug", "priority": "high", "description": "Steps to reproduce:\n1. Log in\n2. Wait 10 minutes\nExpected: still logged in. Actual: redirected to /login." },
    { "column": "Backlog", "title": "Write README setup section", "label": "Docs", "priority": "low" }
  ],
  "canvas": {
    "title": "Release flow",
    "flow": {
      "nodes": [
        { "id": "a", "label": "Ticket picked", "shape": "start" },
        { "id": "b", "label": "Branch + commits", "shape": "process" },
        { "id": "c", "label": "Pull request", "shape": "process" },
        { "id": "d", "label": "CI passes?", "shape": "decision" },
        { "id": "e", "label": "Code review", "shape": "process" },
        { "id": "f", "label": "Deploy to staging + QA", "shape": "process" },
        { "id": "g", "label": "Deploy to production", "shape": "end" }
      ],
      "edges": [
        { "from": "a", "to": "b" }, { "from": "b", "to": "c" }, { "from": "c", "to": "d" },
        { "from": "d", "to": "b", "label": "no" }, { "from": "d", "to": "e", "label": "yes" },
        { "from": "e", "to": "f" }, { "from": "f", "to": "g" }
      ]
    }
  }
}
```

**Features needed**
- ✅ Columns, labels, priority, assignee, due date, history (`task_events`), canvas for architecture diagrams.
- 🟡 Task key per project (`WEB-42`) so branches and commits can reference a card.
- 🟡 "Copy branch name" on the task dialog → `feat/WEB-42-login-page`.
- 🔴 Git/CI webhook (auto-move cards, PR/CI badges on the card).
- 🔴 Sprints / releases (group tasks by iteration), burndown in Analytics.
- 🔴 Bug template text in the description when label = Bug (steps / expected / actual).

**Agent prompt**
> Seed a software project named "{name}" using the Tech template: columns Backlog, Todo, In Progress, In Review, QA, Done. Create the starter tickets from templates.md, writing bug tickets as steps / expected / actual and features with acceptance criteria. On the canvas, draw the release flow: ticket → branch → pull request → CI check (fail loops back to branch) → code review → staging + QA → production. Answer in the same language as my message.

---

## 2. Sales / CRM pipeline

**For:** sales teams and founders tracking deals. **Card =** a deal (one prospect/company), not a task.

**Workflow:** Lead → Contacted → Qualified → Proposal → Negotiation → Won → Lost
- Moving right means the deal gets more likely. *Won* and *Lost* are both final.

**Priority:** high = big deal or closing this month · medium = active · low = early or cold.

**What's different from Tech:** the important data is **money and people**, not code. You need deal value, contact, company and an expected close date. Analytics should show pipeline value per stage and win rate, not throughput. The main action is the **follow-up**, so due date = next follow-up date.

```json
{
  "id": "sales",
  "name": "Sales pipeline",
  "description": "Track deals from first lead to won or lost.",
  "columns": [
    { "title": "Lead", "color": "var(--muted-foreground)" },
    { "title": "Contacted", "color": "var(--chart-4)" },
    { "title": "Qualified", "color": "var(--chart-1)" },
    { "title": "Proposal", "color": "var(--chart-3)" },
    { "title": "Negotiation", "color": "var(--chart-5)" },
    { "title": "Won", "color": "var(--chart-2)" },
    { "title": "Lost", "color": "var(--chart-6)" }
  ],
  "labels": ["Inbound", "Outbound", "Referral", "Renewal", "Upsell", "Partner"],
  "starterTasks": [
    { "column": "Lead", "title": "PT Contoh Jaya: website redesign", "label": "Inbound", "priority": "medium", "description": "Contact: Budi (Marketing Lead), budi@example.com\nValue: Rp 50.000.000\nSource: contact form\nNext step: intro call", "dueInDays": 2 },
    { "column": "Proposal", "title": "Acme Corp: annual license", "label": "Outbound", "priority": "high", "description": "Contact: Sarah (CFO)\nValue: $12,000/yr\nExpected close: end of month\nNext step: send revised quote", "dueInDays": 5 },
    { "column": "Negotiation", "title": "Globex: renewal + 10 seats", "label": "Renewal", "priority": "high", "description": "Value: $8,000\nBlocker: legal review of the contract", "dueInDays": 3 }
  ],
  "canvas": {
    "title": "Sales process",
    "flow": {
      "nodes": [
        { "id": "a", "label": "New lead", "shape": "start" },
        { "id": "b", "label": "First contact", "shape": "process" },
        { "id": "c", "label": "Budget + need + timing fit?", "shape": "decision" },
        { "id": "d", "label": "Demo / discovery call", "shape": "process" },
        { "id": "e", "label": "Send proposal", "shape": "process" },
        { "id": "f", "label": "Accepted?", "shape": "decision" },
        { "id": "g", "label": "Won: hand off to onboarding", "shape": "end" },
        { "id": "h", "label": "Lost: record reason", "shape": "end" }
      ],
      "edges": [
        { "from": "a", "to": "b" }, { "from": "b", "to": "c" },
        { "from": "c", "to": "d", "label": "yes" }, { "from": "c", "to": "h", "label": "no" },
        { "from": "d", "to": "e" }, { "from": "e", "to": "f" },
        { "from": "f", "to": "g", "label": "yes" }, { "from": "f", "to": "h", "label": "no" }
      ]
    }
  }
}
```

**Features needed**
- ✅ Columns as stages, due date as next follow-up, assignee as deal owner, history shows how long a deal sat in each stage.
- 🟡 Until custom fields exist: a description convention (`Contact:`, `Value:`, `Expected close:`, `Next step:`), as in the starter tasks.
- 🔴 Custom fields: `deal_value` (number + currency), `company`, `contact_email`, `expected_close`, `lost_reason`.
- 🔴 Pipeline analytics: total value per column, win rate (Won ÷ (Won + Lost)), average days to close.
- 🔴 "Lost reason" prompt when a card is dropped into Lost.
- 🔴 Later: email/WhatsApp logging, CSV import of leads.

**Agent prompt**
> Seed a sales pipeline project named "{name}": columns Lead, Contacted, Qualified, Proposal, Negotiation, Won, Lost. Create {n} example deals; in each description write Contact, Value, Expected close and Next step on separate lines, and set the due date to the next follow-up. On the canvas, draw the sales process: new lead → first contact → qualification decision (no → Lost with reason) → demo → proposal → accepted decision (yes → Won and hand off, no → Lost). Answer in the same language as my message.

---

## 3. Marketing / Content

**For:** marketing, social media and content teams. **Card =** one piece of content or a campaign task.

**Workflow:** Ideas → Planned → Writing / Design → Review → Scheduled → Published

**Priority:** high = time-bound (launch, holiday, campaign deadline) · medium = this month's calendar · low = evergreen backlog.

**What's different from Tech:** content is driven by **dates**, so the Calendar view (publish date = due date) matters more than the Board. It also needs a **channel** (Blog, Instagram, LinkedIn, Email…), an **approval** step by someone outside the writer, and attachments for drafts and visuals.

```json
{
  "id": "marketing",
  "name": "Marketing / Content",
  "description": "Content calendar from idea to published.",
  "columns": [
    { "title": "Ideas", "color": "var(--muted-foreground)" },
    { "title": "Planned", "color": "var(--chart-4)" },
    { "title": "Writing / Design", "color": "var(--chart-1)" },
    { "title": "Review", "color": "var(--chart-3)" },
    { "title": "Scheduled", "color": "var(--chart-5)" },
    { "title": "Published", "color": "var(--chart-2)" }
  ],
  "labels": ["Blog", "Instagram", "TikTok", "LinkedIn", "Email", "Ads", "Video"],
  "starterTasks": [
    { "column": "Ideas", "title": "Customer story: how X saved 10 hours a week", "label": "Blog", "priority": "low" },
    { "column": "Planned", "title": "Product launch announcement", "label": "Email", "priority": "high", "description": "Audience: all subscribers\nCTA: start free trial\nAssets: hero image, 30s video", "dueInDays": 10 },
    { "column": "Writing / Design", "title": "Carousel: 5 tips for getting started", "label": "Instagram", "priority": "medium", "dueInDays": 4 },
    { "column": "Review", "title": "Monthly newsletter", "label": "Email", "priority": "medium", "dueInDays": 2 }
  ],
  "canvas": {
    "title": "Content workflow",
    "flow": {
      "nodes": [
        { "id": "a", "label": "Idea", "shape": "start" },
        { "id": "b", "label": "Brief: audience, goal, channel", "shape": "process" },
        { "id": "c", "label": "Draft + visuals", "shape": "process" },
        { "id": "d", "label": "Approved?", "shape": "decision" },
        { "id": "e", "label": "Schedule", "shape": "process" },
        { "id": "f", "label": "Publish", "shape": "process" },
        { "id": "g", "label": "Measure results", "shape": "end" }
      ],
      "edges": [
        { "from": "a", "to": "b" }, { "from": "b", "to": "c" }, { "from": "c", "to": "d" },
        { "from": "d", "to": "c", "label": "changes" }, { "from": "d", "to": "e", "label": "yes" },
        { "from": "e", "to": "f" }, { "from": "f", "to": "g" }
      ]
    }
  }
}
```

**Features needed**
- ✅ Calendar view on due date, labels as channels, attachments in chat.
- 🟡 Open this template on the Calendar view by default.
- 🟡 Attachments on tasks (they exist for chat messages, not cards).
- 🔴 Campaign grouping (a parent/epic or a second "campaign" field).
- 🔴 Approver field and an "Approve / Request changes" action in Review.
- 🔴 Later: iCal export, performance numbers per published card.

**Agent prompt**
> Seed a content marketing project named "{name}": columns Ideas, Planned, Writing / Design, Review, Scheduled, Published. Plan {n} posts for the next {weeks} weeks across the channels {channels}; set the label to the channel and the due date to the publish date, and spread them evenly across the calendar. On the canvas, draw the content workflow: idea → brief → draft → approval (changes loop back to draft) → schedule → publish → measure. Answer in the same language as my message.

---

## 4. Customer Support / Helpdesk

**For:** support and customer success teams. **Card =** a ticket from a customer.

**Workflow:** New → Triaged → In Progress → Waiting on Customer → Resolved

**Priority (= severity):** high = service down or blocking the customer, respond within 1 hour · medium = broken feature with a workaround, within 1 day · low = question or request, within 3 days.

**What's different from Tech:** the work starts **outside** the team (a customer). Time to respond is the main metric (**SLA**), the "Waiting on Customer" state must not count against the team, and every ticket needs a **requester** (customer email). Bugs found here get passed to the Tech board.

```json
{
  "id": "support",
  "name": "Customer Support",
  "description": "Helpdesk queue with severity-based response times.",
  "columns": [
    { "title": "New", "color": "var(--muted-foreground)" },
    { "title": "Triaged", "color": "var(--chart-4)" },
    { "title": "In Progress", "color": "var(--chart-1)" },
    { "title": "Waiting on Customer", "color": "var(--chart-5)" },
    { "title": "Resolved", "color": "var(--chart-2)" }
  ],
  "labels": ["Bug", "Question", "Billing", "Feature request", "Account", "Outage"],
  "starterTasks": [
    { "column": "New", "title": "Cannot log in after password reset", "label": "Account", "priority": "high", "description": "Requester: rina@example.com\nPlan: Pro\nReported via: email", "dueInDays": 0 },
    { "column": "Triaged", "title": "Invoice shows the wrong company name", "label": "Billing", "priority": "medium", "description": "Requester: finance@acme.example", "dueInDays": 1 },
    { "column": "Waiting on Customer", "title": "Export to CSV missing columns", "label": "Bug", "priority": "medium", "description": "Asked customer for a screenshot and browser version." }
  ],
  "canvas": {
    "title": "Escalation path",
    "flow": {
      "nodes": [
        { "id": "a", "label": "Ticket received", "shape": "start" },
        { "id": "b", "label": "Triage: set severity + owner", "shape": "process" },
        { "id": "c", "label": "Known answer?", "shape": "decision" },
        { "id": "d", "label": "Reply with solution", "shape": "process" },
        { "id": "e", "label": "Is it a bug?", "shape": "decision" },
        { "id": "f", "label": "Create ticket on Tech board", "shape": "data" },
        { "id": "g", "label": "Investigate", "shape": "process" },
        { "id": "h", "label": "Resolved + confirm with customer", "shape": "end" }
      ],
      "edges": [
        { "from": "a", "to": "b" }, { "from": "b", "to": "c" },
        { "from": "c", "to": "d", "label": "yes" }, { "from": "c", "to": "e", "label": "no" },
        { "from": "e", "to": "f", "label": "yes" }, { "from": "e", "to": "g", "label": "no" },
        { "from": "f", "to": "h" }, { "from": "g", "to": "d" }, { "from": "d", "to": "h" }
      ]
    }
  }
}
```

**Features needed**
- ✅ Priority as severity, due date as the response deadline, assignee as owner, history.
- 🟡 When a ticket is created, set its due date from priority (high +0d, medium +1d, low +3d).
- 🔴 Requester field (email) + SLA timer that pauses while in "Waiting on Customer".
- 🔴 Intake: email-to-ticket or a public form that creates a card in New.
- 🔴 "Send to project" action: copy a ticket to the Tech board and link the two cards.
- 🔴 Analytics: first-response time, resolution time, tickets per label.

**Agent prompt**
> Seed a customer support project named "{name}": columns New, Triaged, In Progress, Waiting on Customer, Resolved. Use priority as severity (high = within 1 hour, medium = 1 day, low = 3 days) and set each ticket's due date from it. Put the requester's email on the first line of each description. On the canvas, draw the escalation path: received → triage → known answer? → reply, or a bug check that sends bugs to the Tech board → resolved and confirmed. Answer in the same language as my message.

---

## 5. HR / Recruiting

**For:** recruiters and hiring managers. **Card =** a candidate for one role.

**Workflow:** Applied → Screening → Interview → Offer → Hired → Rejected

**Priority:** high = strong candidate or urgent role · medium = in process · low = backup.

**What's different from Tech:** the data is **personal** (CV, contact, salary expectation), so access must be tighter: only the hiring team, others see nothing. Interviews are **scheduled events**, the CV is an attachment, and Analytics should show conversion between stages and time to hire.

```json
{
  "id": "recruiting",
  "name": "Recruiting",
  "description": "Hiring pipeline from application to offer.",
  "columns": [
    { "title": "Applied", "color": "var(--muted-foreground)" },
    { "title": "Screening", "color": "var(--chart-4)" },
    { "title": "Interview", "color": "var(--chart-1)" },
    { "title": "Offer", "color": "var(--chart-3)" },
    { "title": "Hired", "color": "var(--chart-2)" },
    { "title": "Rejected", "color": "var(--chart-6)" }
  ],
  "labels": ["Frontend", "Backend", "Design", "Sales", "Ops", "Intern"],
  "starterTasks": [
    { "column": "Applied", "title": "Andi Pratama: Frontend Engineer", "label": "Frontend", "priority": "medium", "description": "Source: LinkedIn\nExpected salary: -\nCV: attach here" },
    { "column": "Interview", "title": "Maya Lestari: Product Designer", "label": "Design", "priority": "high", "description": "Next: portfolio review with design lead", "dueInDays": 3 },
    { "column": "Offer", "title": "Rizky: Backend Engineer", "label": "Backend", "priority": "high", "description": "Offer sent, waiting for an answer", "dueInDays": 5 }
  ],
  "canvas": {
    "title": "Hiring process",
    "flow": {
      "nodes": [
        { "id": "a", "label": "Application", "shape": "start" },
        { "id": "b", "label": "CV screening", "shape": "process" },
        { "id": "c", "label": "Fit?", "shape": "decision" },
        { "id": "d", "label": "HR interview", "shape": "process" },
        { "id": "e", "label": "Technical / case interview", "shape": "process" },
        { "id": "f", "label": "Hire?", "shape": "decision" },
        { "id": "g", "label": "Offer + onboarding", "shape": "end" },
        { "id": "h", "label": "Reject with feedback", "shape": "end" }
      ],
      "edges": [
        { "from": "a", "to": "b" }, { "from": "b", "to": "c" },
        { "from": "c", "to": "d", "label": "yes" }, { "from": "c", "to": "h", "label": "no" },
        { "from": "d", "to": "e" }, { "from": "e", "to": "f" },
        { "from": "f", "to": "g", "label": "yes" }, { "from": "f", "to": "h", "label": "no" }
      ]
    }
  }
}
```

**Features needed**
- ✅ Per-project membership (`project_members`): unassigned users don't see the project at all, which fits private hiring data.
- 🟡 Template default: the project is created with only its creator as a member, never workspace-wide.
- 🟡 Attachments on tasks (the CV).
- 🔴 Custom fields: email, phone, source, expected salary, interview date.
- 🔴 Interview scheduling (date + interviewer), shown on Calendar.
- 🔴 Analytics: conversion per stage, time to hire, source breakdown.

**Agent prompt**
> Seed a recruiting project named "{name}" for the role(s) {roles}: columns Applied, Screening, Interview, Offer, Hired, Rejected. Card title format: "Candidate name: Role"; label = role family; description lists Source, Expected salary and Next step. Use only fake example names. On the canvas, draw the hiring process: application → CV screening → fit? (no → reject with feedback) → HR interview → technical interview → hire? → offer + onboarding or reject. Answer in the same language as my message.

---

## 6. General / Operations / Events

**For:** anything else: operations, events, personal projects, small teams. This is the **fallback** template and keeps today's behaviour close.

**Workflow:** Backlog → To Do → In Progress → Blocked → Done
- *Blocked* is explicit, because ops and event work mostly waits on other people.

**Priority:** high = on the critical path to the deadline · medium = planned · low = optional.

```json
{
  "id": "general",
  "name": "General",
  "description": "Simple board for any kind of work.",
  "columns": [
    { "title": "Backlog", "color": "var(--muted-foreground)" },
    { "title": "To Do", "color": "var(--chart-4)" },
    { "title": "In Progress", "color": "var(--chart-1)" },
    { "title": "Blocked", "color": "var(--chart-6)" },
    { "title": "Done", "color": "var(--chart-2)" }
  ],
  "labels": ["Admin", "Finance", "Logistics", "Vendor", "Personal"],
  "starterTasks": [
    { "column": "To Do", "title": "Book venue", "label": "Vendor", "priority": "high", "dueInDays": 7 },
    { "column": "Backlog", "title": "Draft budget", "label": "Finance", "priority": "medium", "dueInDays": 10 },
    { "column": "Blocked", "title": "Sign catering contract", "label": "Vendor", "priority": "high", "description": "Waiting on: venue confirmation" }
  ],
  "canvas": {
    "title": "Plan",
    "flow": {
      "nodes": [
        { "id": "a", "label": "Goal", "shape": "start" },
        { "id": "b", "label": "Plan + budget", "shape": "process" },
        { "id": "c", "label": "Execute", "shape": "process" },
        { "id": "d", "label": "Blocked?", "shape": "decision" },
        { "id": "e", "label": "Escalate / unblock", "shape": "process" },
        { "id": "f", "label": "Review + close", "shape": "end" }
      ],
      "edges": [
        { "from": "a", "to": "b" }, { "from": "b", "to": "c" }, { "from": "c", "to": "d" },
        { "from": "d", "to": "e", "label": "yes" }, { "from": "e", "to": "c" },
        { "from": "d", "to": "f", "label": "no" }
      ]
    }
  }
}
```

**Features needed**
- ✅ Everything needed for the basic version already exists.
- 🟡 "Blocked" needs a reason: a description convention `Waiting on: …`.
- 🔴 Checklists / subtasks inside a card.
- 🔴 Task dependencies ("B starts after A") and milestones.

**Agent prompt**
> Seed a project named "{name}" for {goal} with columns Backlog, To Do, In Progress, Blocked, Done. Break the goal into {n} concrete tasks with due dates working back from {deadline}; put anything that waits on someone else in Blocked with "Waiting on: …" in the description. On the canvas, draw the plan from goal to close, with a loop for blocked work. Answer in the same language as my message.

---

## Git / CI-CD integration (Tech)

The goal: developers don't drag cards by hand. Git and CI events move the cards and show the status.

### Phase 1: webhook, no OAuth (smallest useful version)

- **Endpoint:** `app/api/integrations/git/route.ts` (POST). One URL per project: `/api/integrations/git?project=<id>`.
- **Auth:** a per-project secret, shown once in project Settings. Verify `X-Hub-Signature-256` (GitHub) or `X-Gitlab-Token` (GitLab) with `crypto.timingSafeEqual`. Reject anything else. This is a trust boundary, so verify the signature before reading the event.
- **Linking:** find a task key (`[A-Z]+-\d+`, e.g. `WEB-42`) in the branch name, PR title or commit message. No key → ignore the event.
- **Rules (defaults, editable later):**

  | Event | Effect |
  |---|---|
  | Branch pushed / first commit | Todo → In Progress |
  | PR opened / ready for review | → In Review, store PR URL |
  | PR merged | → QA (or Done when there is no QA column) |
  | Deploy workflow succeeded on production | QA → Done |
  | CI failed on the PR | card stays; badge ❌ + notification to the assignee |

- **Reuse:** `moveTask` logic in `lib/actions.ts` for the move (call the shared helper, not the Server Action), one `task_events` row per change with actor "GitHub" so it shows in history, and the existing activity bell for notifications.
- **Storage:** `projects.git_secret`, `projects.key`; a small `task_links(task_id, kind, url, status)` table for PRs/commits/CI runs. Add the columns as append-only `ALTER TABLE … ADD COLUMN IF NOT EXISTS` at the bottom of `lib/schema.sql`.

### Phase 2: visible in the UI

- Task key on every card (`WEB-42`) and a per-project counter.
- "Copy branch name" in the task dialog: `feat/WEB-42-login-page` (`fix/` when label = Bug).
- On `task-card.tsx`: PR state (open / merged) and CI badge (✅ / ❌ / ⏳).
- In the task dialog: a list of linked PRs, commits and runs.

### Phase 3: release level

- Sprints/releases: group Done cards into a release and generate release notes from their titles.
- Environment status: which cards are on staging vs production.
- GitHub App / OAuth so users connect a repo with one click instead of pasting a webhook URL.

---

## Feature gaps across templates (ranked)

1. **Template picker at create time** 🟡: register form + create-project dialog. Unlocks everything above.
2. **Custom fields per project** 🔴: deal value, requester, SLA, candidate email, interview date. The biggest gap for Sales, Support and HR. Shape: `project_fields(id, project_id, name, type)` + `task_field_values(task_id, field_id, value)`; types `text | number | date | email | url | select`.
3. **Attachments on tasks** 🟡: storage already exists for chat (`attachments` table, `/api/files/[id]`); point it at tasks as well.
4. **Multiple labels per task** 🟡: `label` is a single TEXT today. Templates work with one label, so add this only if users ask.
5. **Integrations** 🔴: Git/CI (Tech), email intake (Support), iCal export (Marketing).

Later, when asked for: checklists/subtasks, dependencies, a per-template default view (Calendar for Marketing), per-template analytics (pipeline value, SLA, conversion).

## Agent prompt: build a custom template

> The user described their work as: "{description}". Pick the closest template from templates.md, or build a new one with the same JSON shape: 4–7 columns (intake column first in `var(--muted-foreground)`, done/won column in `var(--chart-2)`, the rest from `var(--chart-1..7)` with no repeats), 4–7 labels, priority meanings for low / medium / high, 3 starter tasks, and a canvas flow of 5–8 nodes. Use only fields that exist today (title, description, label, priority, due date); put anything else in the description as `Field: value` lines. Answer in the same language as my message.
