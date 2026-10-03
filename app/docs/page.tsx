/* eslint-disable react/jsx-key -- table cells are keyed by <Table/> when it maps them */
import Link from "next/link";
import { LogoMark } from "@/components/logo-mark";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata = {
  title: "Documentation — Digital Board",
  description: "Install, configure, run and troubleshoot a self-hosted Digital Board.",
};

// ponytail: plain JSX, no MDX pipeline or content collection. One page, one
// file. Split it when a second docs page exists, not before.

/** Screenshot with a caption. Plain <img>: these are static files in /public, not layout-critical. */
const Shot = ({ src, alt }: { src: string; alt: string }) => (
  <figure className="my-2 overflow-hidden rounded-xl border">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={src} alt={alt} className="block w-full" />
    <figcaption className="border-t bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">{alt}</figcaption>
  </figure>
);

const TOC = [
  ["overview", "Overview"],
  ["requirements", "Requirements"],
  ["install", "Installation"],
  ["first-run", "First run"],
  ["config", "Configuration"],
  ["deploy", "Running in production"],
  ["features", "Features"],
  ["data", "Data model"],
  ["architecture", "Architecture"],
  ["backup", "Backup and restore"],
  ["upgrade", "Upgrading"],
  ["troubleshooting", "Troubleshooting"],
  ["limits", "Known limits"],
  ["develop", "Development"],
] as const;

function H({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-20 border-b pb-2 pt-10 text-xl font-semibold tracking-tight first:pt-0">
      {children}
    </h2>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border bg-card p-4 text-xs leading-relaxed">
      <code>{children}</code>
    </pre>
  );
}

const C = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded bg-secondary px-1 py-0.5 text-[0.85em]">{children}</code>
);

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            {head.map((h) => (
              <th key={h} className="py-2 pr-4 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b align-top">
              {r.map((cell, j) => (
                <td key={j} className="py-2 pr-4">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <LogoMark />
            <span className="text-sm font-semibold tracking-tight">Digital Board</span>
          </Link>
          <span className="text-sm text-muted-foreground">Docs</span>
          <div className="flex-1" />
          <ThemeToggle />
          <Link
            href="/board"
            className="rounded-md bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Open app
          </Link>
        </div>
      </nav>

      <div className="mx-auto flex max-w-5xl gap-10 px-6 py-10">
        {/* Anchors only — no scroll-spy, no client JS. */}
        <aside className="sticky top-24 hidden h-fit w-52 shrink-0 lg:block">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">On this page</p>
          <ul className="flex flex-col gap-0.5">
            {TOC.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="block rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col gap-4 leading-relaxed">
          <H id="overview">Overview</H>
          <p className="text-sm text-muted-foreground">
            Digital Board is a self-hosted work tracker. A kanban board with List, Calendar and Analytics views over
            the same tasks, a free-form drawing canvas with multiple sheets, and workspace chat with direct messages.
            Everything lives in a PostgreSQL database on your own machine.
          </p>
          <p className="text-sm text-muted-foreground">
            It is built for a team small enough to share one server: a homelab, a VPS, a machine in the office. There
            is no multi-tenancy, no background worker, no external queue, cache or object store. What it is not: a
            hosted SaaS. Every application record, including attachment bytes, lives in Postgres.
          </p>
          <Shot src="/screenshots/board.png" alt="The board — drag and drop between columns, with labels, priority, due dates and assignees" />

          <H id="requirements">Requirements</H>
          <Table
            head={["What", "Version", "Note"]}
            rows={[
              [<>Node.js</>, <>22 or newer</>, <>The self-checks use <C>--experimental-strip-types</C>, which needs 22+.</>],
              [<>npm</>, <>10 or newer</>, <>Ships with Node 22.</>],
              [<>PostgreSQL</>, <>14 or newer</>, <>Verified against 16. An empty database and a role that can create tables in it is all the app needs.</>],
              [<>Disk</>, <>~500 MB</>, <>Mostly <C>node_modules</C>. The database grows with use.</>],
            ]}
          />

          <H id="install">Installation</H>
          <p className="text-sm text-muted-foreground">
            Create an empty database and a role for it, point <C>DATABASE_URL</C> at it, then build and start. The
            tables create themselves on the first request — there is no migration command.
          </p>
          <Code>{`sudo -u postgres psql <<'SQL'
CREATE ROLE board LOGIN PASSWORD 'choose-something';
CREATE DATABASE board OWNER board;
SQL

git clone https://github.com/Mqdd27/digital-board.git
cd digital-board
npm install

cp .env.example .env
$EDITOR .env          # set DATABASE_URL

npm run build
npm start`}</Code>
          <p className="text-sm text-muted-foreground">
            The app listens on port 3000. Set <C>PORT</C> to change it. For development with hot reload use{" "}
            <C>npm run dev</C> instead of build + start.
          </p>

          <H id="first-run">First run</H>
          <p className="text-sm text-muted-foreground">
            Open <C>http://localhost:3000</C>. Because the database has no accounts yet, every route redirects to{" "}
            <C>/setup</C>. The wizard asks for four things:
          </p>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
            <li><strong className="text-foreground">Workspace name</strong> — shown in the sidebar; click it later to rename it.</li>
            <li><strong className="text-foreground">First project</strong> — a board. You can add more later.</li>
            <li><strong className="text-foreground">Board columns</strong> — pick from the presets or type your own. Columns can be added, renamed, recoloured, reordered and deleted from the board afterwards, so this is not a decision you are locked into.</li>
            <li><strong className="text-foreground">Admin account</strong> — name, email and a password of at least 8 characters. This account becomes the workspace admin.</li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Submitting creates everything, signs you in and drops you on the board. <C>/setup</C> refuses to run a
            second time once an account exists.
          </p>
          <Shot src="/screenshots/setup.png" alt="The first-run wizard — workspace, first project, columns and the admin account" />

          <H id="config">Configuration</H>
          <p className="text-sm text-muted-foreground">Environment variables only. There is no config file.</p>
          <Table
            head={["Variable", "Default", "Purpose"]}
            rows={[
              [<C>DATABASE_URL</C>, <>—</>, <><strong className="text-foreground">Required.</strong> Postgres connection string, e.g. <C>postgres://board:pw@localhost:5432/board</C>.</>],
              [<C>DATABASE_POOL_MAX</C>, <>10</>, <>Maximum Postgres connections held by the pool.</>],
              [<C>PORT</C>, <>3000</>, <>Port the server listens on.</>],
              [<C>TZ</C>, <>system</>, <>Timezone used to render timestamps. They are formatted on the server, so this decides what every user sees.</>],
              [<C>NODE_ENV</C>, <><C>production</C> via <C>npm start</C></>, <>Session cookies are marked <C>secure</C> in production, which means they require HTTPS.</>],
            ]}
          />

          <H id="deploy">Running in production</H>
          <p className="text-sm text-muted-foreground">
            Any host that runs Node works. Build once, then keep the process alive. pm2 is the path below; systemd,
            Docker or anything else you already run is equally fine.
          </p>

          <h3 className="pt-4 text-sm font-semibold">With pm2</h3>
          <p className="text-sm text-muted-foreground">
            Put an <C>ecosystem.config.js</C> next to <C>package.json</C>. Everything the service needs is in it, so a
            restart never depends on whatever was in your shell at the time:
          </p>
          <Code>{`module.exports = {
  apps: [{
    name: "digital-board",
    script: "npm",
    args: "start",
    cwd: "/srv/digital-board",
    instances: 1,
    autorestart: true,
    max_memory_restart: "512M",
    env: {
      NODE_ENV: "production",
      PORT: 3000,
      DATABASE_URL: "postgres://board:pw@localhost:5432/board",
      TZ: "Asia/Jakarta",
    },
  }],
}`}</Code>
          <Code>{`npm install
npm run build

pm2 start ecosystem.config.js
pm2 save          # remember the process list
pm2 startup       # print the command that re-runs pm2 at boot, then run it`}</Code>
          <p className="rounded-lg border border-[var(--chart-7)] bg-[rgba(239,68,68,0.06)] p-4 text-sm">
            <strong className="text-foreground">Raising <C>instances</C> is allowed.</strong> Postgres holds all
            application state. Raise <C>DATABASE_POOL_MAX</C> with care — each instance opens its own pool, so total
            connections is instances × pool size. Live canvas cursors and edits are relayed in-process, so they
            only reach people served by the same instance — keep <C>instances: 1</C> if you rely on them.
          </p>
          <p className="text-sm text-muted-foreground">Day-to-day:</p>
          <Code>{`pm2 logs digital-board        # tail logs
pm2 status                    # is it up, how many restarts
pm2 restart digital-board     # after a rebuild
pm2 stop digital-board        # before restoring a backup
pm2 flush digital-board       # truncate logs`}</Code>
          <p className="text-sm text-muted-foreground">
            Upgrading under pm2:
          </p>
          <Code>{`cd /srv/digital-board
git pull
npm install
npm run build
pm2 restart digital-board`}</Code>

          <h3 className="pt-4 text-sm font-semibold">Without pm2</h3>
          <p className="text-sm text-muted-foreground">A systemd unit does the same job:</p>
          <Code>{`[Unit]
Description=Digital Board
After=network.target

[Service]
WorkingDirectory=/srv/digital-board
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=DATABASE_URL=postgres://board:pw@localhost:5432/board
Environment=TZ=Asia/Jakarta
ExecStart=/usr/bin/npm start
Restart=always
User=digitalboard

[Install]
WantedBy=multi-user.target`}</Code>

          <p className="text-sm text-muted-foreground">
            Put it behind a reverse proxy for TLS. Session cookies are <C>secure</C> in production, so signing in over
            plain HTTP on a non-localhost address will not work — the browser refuses to store the cookie and you are
            bounced back to the login page. Either terminate TLS in front of it or run it on localhost only.
          </p>
          <Code>{`server {
  server_name board.example.com;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 12M;   # attachments are capped at 10 MB
  }
}`}</Code>
          <p className="text-sm text-muted-foreground">
            A load balancer in front of several instances works, as long as every instance points at the same Postgres.
          </p>

          <H id="features">Features</H>
          <Table
            head={["Area", "What it does"]}
            rows={[
              [<strong className="text-foreground">Board</strong>, <>Drag and drop with reordering inside a column and positional drops between columns. Works with a mouse, with touch (long-press to pick a card up, so a normal swipe still scrolls), and with the keyboard. Task details are editable and previewed up to three lines on cards. Click the project title to rename it. Columns are add/rename/recolour/reorder/delete; deleting one takes its tasks and asks first.</>],
              [<strong className="text-foreground">List</strong>, <>Every task as a table — status, label, priority, due date, assignee. Click a row to edit.</>],
              [<strong className="text-foreground">Calendar</strong>, <>Month grid, Monday-first. Dated tasks sit on their due date with a priority-coloured edge. Undated tasks are counted in the header.</>],
              [<strong className="text-foreground">Analytics</strong>, <>Totals, tasks per column, priority split, workload per member, and a 14-day activity chart built from the history log.</>],
              [<strong className="text-foreground">My Tasks</strong>, <>Everything assigned to you, soonest due first, overdue in red.</>],
              [<strong className="text-foreground">Inbox</strong>, <>Every change to every task, newest first, with who did it.</>],
              [<strong className="text-foreground">Notifications</strong>, <>The bell dropdown combines unread card activity and chat. Card items open Inbox; chat items open the right conversation. Mark card activity read to clear it. Enable alerts there for browser notifications, an in-app popup, and sound.</>],
              [<strong className="text-foreground">Task history</strong>, <>Creation, column moves, reorders, and title/details/priority/assignee/due-date edits are all recorded. Open a task to see its timeline.</>],
              [<strong className="text-foreground">Canvas</strong>, <>Excalidraw with sheet tabs. Each sheet keeps its own drawing, saved on an 800ms debounce as you draw and flushed when you switch sheets or close the tab; switching sheets never disturbs another one. Pasted images are embedded in the sheet&rsquo;s snapshot rather than stored as attachments, so an image-heavy sheet becomes a large row.</>],
              [<strong className="text-foreground">Chat</strong>, <>A workspace channel everyone reads, plus a direct message thread per member. Unread badges, file attachments with inline image previews, and 15 minutes to edit your own message.</>],
              [<strong className="text-foreground">Access</strong>, <>A workspace admin assigns each member a role per project from Settings — <C>viewer</C> reads, <C>editor</C> changes tasks and canvases, <C>admin</C> also manages the project&rsquo;s structure and members. No role means the project is not listed and its rows are never sent to that browser. Every action re-checks the role server-side.</>],
              [<strong className="text-foreground">Presence</strong>, <>Online / away / offline per member, derived from activity rather than stored.</>],
              [<strong className="text-foreground">Projects</strong>, <>Add and delete from Settings, switch from the sidebar, and rename workspace or project names from Settings or their titles. New projects start with the default columns.</>],
            ]}
          />

          <Shot src="/screenshots/canvas.png" alt="Canvas — Excalidraw sheets, one drawing per tab, saved as you draw" />
          <Shot src="/screenshots/chat.png" alt="Chat — the workspace channel plus a direct message thread per member" />
          <Shot src="/screenshots/analytics.png" alt="Analytics — tasks per column, priority split, workload per member and 14-day activity" />
          <Shot src="/screenshots/settings.png" alt="Settings — workspace name, members with presence, and the per-project role matrix" />

          <H id="data">Data model</H>
          <p className="text-sm text-muted-foreground">
            Thirteen tables, defined in <C>lib/schema.sql</C> as plain SQL and applied on first use. Foreign keys
            cascade, so deleting a parent row cleans up after itself.
          </p>
          <Table
            head={["Table", "Holds"]}
            rows={[
              [<C>users</C>, <>Accounts: email, name, scrypt password hash, avatar colour, admin flag, last-seen stamp, activity-notification read cursor.</>],
              [<C>sessions</C>, <>Login sessions: a random token, its owner, an expiry.</>],
              [<C>settings</C>, <>Key/value. Currently just the workspace name.</>],
              [<C>projects</C>, <>Boards.</>],
              [<C>project_members</C>, <>Who may see a project, and as <C>admin</C>, <C>editor</C> or <C>viewer</C>.</>],
              [<C>columns</C>, <>Board columns, ordered by a dense <C>position</C>.</>],
              [<C>tasks</C>, <>Cards: title, details, label, priority, assignee, due date, position within a column.</>],
              [<C>task_events</C>, <>The history log — one row per change, with the actor.</>],
              [<C>canvases</C>, <>Canvas sheets and their Excalidraw scenes.</>],
              [<C>messages</C>, <>Chat. A <C>NULL</C> recipient is the workspace channel; a user id is a direct message.</>],
              [<C>message_reads</C>, <>One read cursor per person per conversation, which is what drives unread badges.</>],
              [<C>attachments</C>, <>Uploaded-file metadata and bytes.</>],
              [<C>activity_reads</C>, <>How far each person has read the card-activity feed, which is what clears the bell.</>],
            ]}
          />

          <H id="architecture">Architecture</H>
          <p className="text-sm text-muted-foreground">
            Next.js App Router. <C>/board</C> is a Server Component that loads everything in one pass and hands it to a
            client shell; the sidebar sections switch in the browser without another round trip.
          </p>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
            <li>
              <strong className="text-foreground">Writes are Server Actions</strong> in <C>lib/actions.ts</C>, which
              revalidate the board. There is no REST layer to keep in sync.
            </li>
            <li>
              <strong className="text-foreground">Except four route handlers.</strong> Canvas snapshots and chat go
              through <C>/api/*</C> on purpose: Server Actions cap a request body at 1 MB, which a real drawing or a
              file attachment passes immediately, and chat polling through an action would revalidate the whole board
              on every message.
            </li>
            <li>
              <strong className="text-foreground">Reads are in <C>lib/queries.ts</C></strong>, writes in{" "}
              <C>lib/actions.ts</C>. Nothing else touches SQL. <C>lib/db.ts</C> is the only file that knows about the
              driver, and it rewrites <C>?</C> placeholders to <C>$1</C> so the queries stay portable.
            </li>
            <li>
              <strong className="text-foreground">Auth</strong> is <C>scrypt</C> from <C>node:crypto</C> — no bcrypt
              dependency. A session is a random 32-byte token in an <C>httpOnly</C> cookie plus a row, valid 30 days.
            </li>
            <li>
              <strong className="text-foreground">Presence is derived, not stored.</strong> Every authenticated request
              stamps <C>last_seen_at</C> (throttled to one write per 45 seconds). Online is under 2 minutes, away under
              15, offline beyond.
            </li>
            <li>
              <strong className="text-foreground">Chat polls every 3 seconds.</strong> No WebSocket: one instance does
              not justify a socket server, and the poll doubles as the presence heartbeat.
            </li>
            <li>
              <strong className="text-foreground">Timestamps are formatted on the server</strong> and shipped as
              strings, because <C>toLocaleString</C> on both sides of hydration disagrees about locale and timezone.
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">
            The schema applies itself with <C>CREATE TABLE IF NOT EXISTS</C> on the first query of each process, and
            columns added later sit at the bottom of <C>lib/schema.sql</C> as <C>ALTER TABLE … ADD COLUMN IF NOT
            EXISTS</C>. No migration command exists, by design — upgrading is <C>git pull &amp;&amp; npm run build</C>.
            Transactions bind one pooled client through <C>AsyncLocalStorage</C>, so a helper called inside{" "}
            <C>transaction()</C> cannot accidentally run on a different connection and land outside the transaction.
          </p>

          <H id="backup">Backup and restore</H>
          <p className="text-sm text-muted-foreground">Back up the database.</p>
          <Code>{`# safe while running
pg_dump --no-owner --format=custom "$DATABASE_URL" > /backups/board-$(date +%F).dump`}</Code>
          <p className="text-sm text-muted-foreground">
            To restore: stop the server, then{" "}
            <C>pg_restore --clean --if-exists --no-owner -d &quot;$DATABASE_URL&quot; board-YYYY-MM-DD.dump</C> and
            start again. For legacy file attachments, run <C>node scripts/files-to-postgres.mjs /path/to/uploads</C>
            before deleting that directory.
          </p>

          <H id="upgrade">Upgrading</H>
          <Code>{`git pull
npm install
npm run build
pm2 restart digital-board        # or: systemctl restart digital-board`}</Code>
          <p className="text-sm text-muted-foreground">
            New tables and new columns are applied on the next start. Take a backup first anyway — the schema step is
            additive and never drops anything, but a backup costs one command.
          </p>

          <H id="troubleshooting">Troubleshooting</H>
          <Table
            head={["Symptom", "Cause and fix"]}
            rows={[
              [<><C>ECONNREFUSED</C> or <C>password authentication failed</C> on first load</>, <>The app connects on the first request, not at build time, so a bad <C>DATABASE_URL</C> surfaces when you open a page. Check it with <C>psql &quot;$DATABASE_URL&quot; -c &apos;select 1&apos;</C>.</>],
              [<><C>permission denied for schema public</C></>, <>On Postgres 15+ a plain role cannot create tables in a database it does not own. Make it the owner: <C>ALTER DATABASE board OWNER TO board;</C></>],
              [<>&ldquo;too many clients already&rdquo;</>, <>instances × <C>DATABASE_POOL_MAX</C> exceeds the server&rsquo;s <C>max_connections</C>. Lower the pool or raise the limit.</>],
              [<>Signing in does nothing, bounces back to login</>, <>In production the session cookie is <C>secure</C> and needs HTTPS. Put it behind TLS, or reach it over <C>localhost</C>.</>],
              [<>Everyone shows as Offline / never signed in</>, <>Presence needs at least one authenticated request per user. A member who has never signed in has no last-seen stamp and correctly reads as offline.</>],
              [<>Attachment upload fails behind a proxy</>, <>The proxy body limit is below 10 MB. Raise <C>client_max_body_size</C> (nginx) or the equivalent.</>],
              [<>Drawing does not save, &ldquo;Save failed&rdquo; in the canvas tab bar</>, <>The snapshot POST is being rejected upstream — check the proxy body limit. Snapshots grow with the drawing: a pasted image is embedded in the snapshot and takes it to hundreds of KB.</>],
              [<>The canvas area is blank after a deploy</>, <>A tab open across a deploy asks for chunk files the new build replaced, and the canvas library loads as its own chunk. The canvas now says so and offers a reload; older builds showed an empty black panel. Nothing is lost — reload the page. It is also why the whole canvas toolbar disappears, not just the drawing.</>],
              [<>A pasted image vanishes from the canvas after reload</>, <>Fixed. The save used a <C>keepalive</C> fetch, whose body the Fetch standard caps at 64 KiB; anything larger was rejected outright, so drawings containing media were never stored. Upgrade past this fix and re-add the image.</>],
              [<>Times are hours off</>, <>Timestamps render in the server&rsquo;s timezone. Set <C>TZ</C> on the service.</>],
              [<>Port already in use</>, <>Set <C>PORT</C>, or stop whatever holds 3000. Under pm2, an old copy often survives a failed deploy — check <C>pm2 status</C>.</>],
              [<>Changes not live after a deploy</>, <>pm2 runs the built output, so <C>npm run build</C> has to come before <C>pm2 restart</C>. Restarting alone re-serves the old build.</>],
            ]}
          />

          <H id="limits">Known limits</H>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
            <li>No self-service password reset. An admin creates a replacement account.</li>
            <li>Chat has no deletion, reactions, threads or typing indicators, and polling means near-real-time, not instant.</li>
            <li>Columns move one step at a time from the editor; there is no drag-to-reorder for columns themselves.</li>
            <li>Project roles gate tasks, canvases and project structure. Chat is workspace-wide — it has no per-project scoping.</li>
                        <li>Every route renders dynamically, because the root layout reads the theme cookie.</li>
          </ul>

          <H id="develop">Development</H>
          <Code>{`npm run dev        # hot reload
npm run lint
npx tsc --noEmit

# runnable checks, no test framework
node --experimental-strip-types lib/board.check.ts   # pure board helpers
node --experimental-strip-types lib/chat.check.ts    # chat poll merge
DATABASE_URL=... node lib/postgres.check.mjs         # every app query, against your Postgres

# wipe everything and start from the wizard again
psql "$DATABASE_URL" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'`}</Code>
          <p className="text-sm text-muted-foreground">
            The checks are plain <C>node:assert</C> scripts. They cover the logic that fails quietly — index arithmetic
            when a card moves, the deduplication that stops a doubled chat poll producing duplicate React keys, and the
            delete cascades.
          </p>

          <div className="mt-12 flex items-center justify-between border-t pt-6 text-sm">
            <Link href="/" className="text-muted-foreground transition-colors hover:text-foreground">
              ← Back home
            </Link>
            <a
              href="https://github.com/Mqdd27/digital-board"
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Source on GitHub
            </a>
          </div>
        </main>
      </div>
    </div>
  );
}
