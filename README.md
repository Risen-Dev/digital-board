# Digital Board

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-5FA04E.svg)](https://nodejs.org)
[![PostgreSQL](https://img.shields.io/badge/postgres-%E2%89%A514-336791.svg)](https://www.postgresql.org)

Self-hosted work tracker. A kanban board with List, Calendar and Analytics views
over the same tasks, a free-form drawing canvas with multiple sheets, and
workspace chat with direct messages. Multi-user, with per-project roles.
Runs on your own machine against your own PostgreSQL — no third-party services,
no per-seat billing.

![The board](public/screenshots/board.png)

<table>
  <tr>
    <td width="50%"><img src="public/screenshots/canvas.png" alt="Canvas"><br><sub><b>Canvas</b> — Excalidraw sheets per project</sub></td>
    <td width="50%"><img src="public/screenshots/analytics.png" alt="Analytics"><br><sub><b>Analytics</b> — column, priority, workload, 14-day activity</sub></td>
  </tr>
  <tr>
    <td><img src="public/screenshots/chat.png" alt="Chat"><br><sub><b>Chat</b> — workspace channel and direct messages</sub></td>
    <td><img src="public/screenshots/settings.png" alt="Settings"><br><sub><b>Settings</b> — members, presence, per-project roles</sub></td>
  </tr>
</table>

## Quick start

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE board LOGIN PASSWORD 'choose-something';
CREATE DATABASE board OWNER board;
SQL

git clone https://github.com/Risen-Dev/digital-board.git
cd digital-board
npm install

cp .env.example .env      # set DATABASE_URL
npm run build
npm start
```

Open <http://localhost:3000> and choose **Create a workspace** (`/register`) — it asks
for the workspace name, your first project, the board columns and the admin account.
Anyone can register a workspace of their own; set `REGISTRATION_CLOSED=1` to stop that.

![First-run setup](public/screenshots/setup.png)
 Tables create themselves on first use; there is no migration
command.

Requires **Node 22+** and **PostgreSQL 14+** (verified on 16). For development,
`npm run dev`.

## Features

| Area | |
|---|---|
| **Board** | Drag and drop with reordering inside a column and positional drops between columns. Mouse, touch and keyboard. Task details are editable and previewed up to three lines on cards. Click the workspace name in the sidebar or Settings, or the project title in the header or Settings, to rename it. Columns are add / rename / recolour / reorder / delete. |
| **List, Calendar, Analytics** | The same tasks as a table, on a month grid by due date, and as charts — column distribution, priority split, workload per member, 14-day activity. |
| **History** | Every move, reorder and field change is logged with its actor. Per task, and board-wide in the Inbox. |
| **Canvas** | Excalidraw with sheet tabs. Each sheet keeps its own drawing. Live collaboration: other members' cursors (with their names) and edits appear as they happen. |
| **Chat** | Workspace channel plus direct messages, with unread badges, attachments and a 15-minute edit window. |
| **Notifications** | Bell dropdown combines unread card activity and chat. Card items open Inbox; chat items open their conversation; card items can be marked read. Enable alerts there for browser notifications, an in-app popup, and sound. |
| **Accounts** | Multi-user with `scrypt` password hashing and cookie sessions. Presence shows who is online. |
| **Access** | Per-project roles — admin, editor, viewer — assigned from Settings by a workspace admin. A project you hold no role in is not listed and its data never reaches your browser. Enforced server-side in every action, not just hidden in the UI. |

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | **Required.** Postgres connection string. |
| `DATABASE_POOL_MAX` | `10` | Maximum pooled Postgres connections. |
| `REGISTRATION_CLOSED` | unset | `1` stops new workspaces being registered; admins still add members. |
| `PORT` | `3000` | Listen port. |
| `TZ` | system | Timezone for rendered timestamps — they are formatted server-side. |

Session cookies are `secure` in production, so serve it over HTTPS or reach it on
`localhost`.

## Documentation

The app serves its own documentation at **`/docs`** — installation,
configuration, deployment with pm2 or systemd, the data model, architecture,
backups, upgrading and troubleshooting. Run it and open
<http://localhost:3000/docs>, or read [`app/docs/page.tsx`](app/docs/page.tsx).

## Database

PostgreSQL via `pg`, plain SQL, no ORM. The schema is
[`lib/schema.sql`](lib/schema.sql), applied idempotently on the first query;
columns added later sit at the bottom of that file as
`ALTER TABLE … ADD COLUMN IF NOT EXISTS`.

[`lib/db.ts`](lib/db.ts) is the only file that knows about the driver. Every read
lives in [`lib/queries.ts`](lib/queries.ts) and every write in
[`lib/actions.ts`](lib/actions.ts).

Back up the database:

```bash
pg_dump --no-owner --format=custom "$DATABASE_URL" > board.dump
```

## Upgrading

```bash
git pull
npm install
npm run build
pm2 restart digital-board --update-env    # or restart however you run it
```

New columns apply themselves on the next query. Back up first anyway.

For pre-database attachments, migrate once before deleting the old uploads directory:

```bash
DATABASE_URL=... node scripts/files-to-postgres.mjs /path/to/uploads
```

## Development

```bash
npm run dev
npm run lint
npx tsc --noEmit
```

Runnable checks, no test framework:

```bash
node --experimental-strip-types lib/board.check.ts   # board helpers
node --experimental-strip-types lib/chat.check.ts    # chat poll merge
DATABASE_URL=... node lib/postgres.check.mjs         # every app query, against real Postgres
```

`postgres.check.mjs` is safe to point at your own server: it runs inside a
transaction and rolls back.

## Known limits

No self-service password reset. Chat polls every 3 seconds rather than using a
socket, and has no deletion, reactions or threads.

Full list in the [docs](/docs).

## Contributing

Issues and pull requests are welcome. Before opening a PR, run `npm run lint`,
`npx tsc --noEmit` and the checks above, and keep SQL in `lib/queries.ts` /
`lib/actions.ts` rather than in components.

## License

[MIT](LICENSE) © Mqdd
