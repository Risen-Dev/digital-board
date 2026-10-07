import Link from "next/link";
import {
  ArrowRight, BarChart3, Calendar, Database, LayoutGrid, ListChecks, Lock, Timer,
} from "lucide-react";
import { LogoMark } from "@/components/logo-mark";
import { currentUser } from "@/lib/auth";
import { ThemeToggle } from "@/components/theme-toggle";

const FEATURES = [
  { Icon: LayoutGrid, title: "Kanban board", desc: "Columns you define during setup. Drag tasks between them, or reorder within one — mouse, touch, or keyboard." },
  { Icon: ListChecks, title: "Four ways to look", desc: "Board, List, Calendar and Analytics read the same data — pick whichever fits the moment." },
  { Icon: Timer, title: "Full history", desc: "Every move, priority change and assignment is recorded with a timestamp and who did it." },
  { Icon: Calendar, title: "Due dates on a calendar", desc: "Tasks with a due date appear on the month grid, colour-coded by priority." },
  { Icon: BarChart3, title: "Analytics built in", desc: "Distribution per column and priority, workload per member, and the last 14 days of activity." },
  { Icon: Lock, title: "Multi-user", desc: "Real accounts with hashed passwords, cookie sessions, and per-member task assignment." },
];

export default async function Home() {
  // Anyone can make a workspace, so the header CTA no longer depends on whether
  // the instance has been "installed" — signed in goes to the board, everyone
  // else is offered registration.
  const cta = (await currentUser())
    ? { href: "/board", label: "Open board" }
    : { href: "/register", label: "Create a workspace" };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-6">
          <div className="flex items-center gap-2.5">
            <LogoMark />
            <span className="text-sm font-semibold tracking-tight">Digital Board</span>
          </div>
          <div className="flex-1" />
          <Link href="/docs" className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
            Docs
          </Link>
          <ThemeToggle />
          <Link
            href={cta.href}
            className="rounded-md bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            {cta.label}
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-6xl px-6 pb-20 pt-24 text-center">
        <div className="mb-8 inline-flex items-center gap-2 rounded-full border bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground">
          <Database className="size-3" />
          Self-hosted · PostgreSQL · no third-party services
        </div>

        <h1 className="mx-auto mb-6 max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl md:text-6xl">
          A team board
          <br />
          <span className="text-muted-foreground">whose data stays yours.</span>
        </h1>

        <p className="mx-auto mb-10 max-w-xl text-base leading-relaxed text-muted-foreground">
          Boards, deadlines and history in one app you run yourself. Your own PostgreSQL, no third-party account,
          no per-seat billing.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href={cta.href}
            className="flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            {cta.label}
            <ArrowRight className="size-3.5" />
          </Link>
          <Link
            href="/docs"
            className="rounded-md border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-secondary"
          >
            Read the docs
          </Link>
        </div>
      </section>

      <section className="border-y bg-secondary">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="mb-14 text-center">
            <h2 className="text-3xl font-semibold tracking-tight">What already works</h2>
            <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground">
              No roadmap items below — everything here works the moment setup finishes.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ Icon, title, desc }) => (
              <div key={title} className="rounded-xl border bg-card p-5">
                <div className="mb-4 flex size-9 items-center justify-center rounded-lg bg-secondary">
                  <Icon className="size-4" />
                </div>
                <h3 className="mb-1.5 text-sm font-semibold">{title}</h3>
                <p className="text-xs leading-relaxed text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="self-host" className="mx-auto max-w-2xl px-6 py-20">
        <h2 className="mb-3 text-center text-3xl font-semibold tracking-tight">Run it yourself</h2>
        <p className="mb-8 text-center text-sm text-muted-foreground">
          No extra services. The database is created on first run.
        </p>
        <pre className="overflow-x-auto rounded-xl border bg-card p-5 text-xs leading-relaxed">
{`git clone https://github.com/Risen-Dev/digital-board.git
cd digital-board
npm install
npm run build
npm start

# open http://localhost:3000 — the setup wizard appears`}
        </pre>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Configuration, deployment, backups and troubleshooting are in the{" "}
          <Link href="/docs" className="font-medium text-foreground underline underline-offset-2">
            documentation
          </Link>
          .
        </p>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-10 sm:flex-row">
          <div className="flex items-center gap-2">
            <LogoMark />
            <span className="text-sm font-semibold">Digital Board</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <Link href="/docs" className="transition-colors hover:text-foreground">Documentation</Link>
            <a href="https://github.com/Risen-Dev/digital-board" target="_blank" rel="noreferrer" className="transition-colors hover:text-foreground">
              GitHub
            </a>
            <span>Self-hosted. Your data never leaves your server.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
