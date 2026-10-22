"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive, BarChart3, Bell, Calendar, CalendarClock, Check, CheckSquare, Filter, Home, Inbox,
  GitPullRequest, LayoutGrid, List, LogOut, Menu, MessageSquare, PenLine, Plus, Search, Settings, Sparkles, X,
} from "lucide-react";
import { applyFilters, initials, labelsOf, type Column, type Filters, type Member, type Task } from "@/lib/board";
import { archiveTask, fetchArchived, logoutAction, renameProject, renameWorkspace } from "@/lib/actions";
import { Modal } from "./modal";
import type { CanvasMeta, CanvasTag, FeedItem, MemberPresence, Project, ProjectMember, SearchCard, Unread } from "@/lib/queries";
import type { User } from "@/lib/auth";
import { Avatar } from "./avatar";
import { LogoMark } from "./logo-mark";
import { EditableTitle } from "./editable-title";
import { ThemeToggle } from "./theme-toggle";
import { TaskDialog } from "./task-dialog";
import { HomeView } from "./views/home-view";
import { BoardView } from "./views/board-view";
import { ListView } from "./views/list-view";
import { CalendarView } from "./views/calendar-view";
import { CanvasView } from "./views/canvas-view";
import { AnalyticsView, type Stats } from "./views/analytics-view";
import { MyTasksView, type MyTask } from "./views/my-tasks-view";
import { MembersPanel } from "./members-panel";
import { ProjectAgent } from "./project-agent";
import { GithubView } from "./views/github-view";
import { useGithubLinks } from "@/hooks/use-github-links";
import type { AiSettings } from "@/lib/ai";
import { ChatView, PresenceDot, UnreadBadge } from "./views/chat-view";
import { MeetingsView, startsIn } from "./views/meetings-view";
import { SearchPalette } from "./search-palette";
import { meetingState, type Meeting } from "@/lib/meetings";

const VIEWS = [
  { Icon: LayoutGrid, label: "Board" },
  { Icon: List, label: "List" },
  { Icon: Calendar, label: "Calendar" },
  { Icon: BarChart3, label: "Analytics" },
];
/** Only offered when the project is linked to a repo (Settings → Projects). */
const GITHUB_VIEW = { Icon: GitPullRequest, label: "GitHub" };

type SectionKey = "home" | "board" | "canvas" | "chat" | "inbox" | "mine" | "meetings" | "settings";

const SECTIONS: { key: SectionKey; Icon: typeof Home; label: string }[] = [
  { key: "home", Icon: Home, label: "Home" },
  { key: "board", Icon: LayoutGrid, label: "Board" },
  { key: "canvas", Icon: PenLine, label: "Canvas" },
  { key: "chat", Icon: MessageSquare, label: "Chat" },
  { key: "inbox", Icon: Inbox, label: "Inbox" },
  { key: "mine", Icon: CheckSquare, label: "My Tasks" },
  { key: "meetings", Icon: CalendarClock, label: "Meetings" },
  { key: "settings", Icon: Settings, label: "Settings" },
];

type Alert = { title: string; body: string };

/**
 * Registers the service worker and saves this browser's push subscription, so
 * alerts arrive with no tab open. False where push isn't available: plain http
 * (other than localhost), or a browser without it.
 */
async function subscribePush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription()
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: (await (await fetch("/api/push")).json()).key });
  const res = await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub) });
  return res.ok;
}

/** On sign-out, so a shared device stops getting this person's alerts. */
async function dropPush() {
  try {
    const sub = await (await navigator.serviceWorker?.getRegistration())?.pushManager.getSubscription();
    if (!sub) return;
    await fetch("/api/push", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
    await sub.unsubscribe();
  } catch {
    // Signing out must not hang on this.
  }
}

export function Workspace({
  user, workspace, projects, project, columns, members, assignments, presence, feed, notifications: initialNotifications, unread: initialUnread, mine, meetings: initialMeetings, stats, sheets, tags: allTags, focus, openTask, today, dark, aiEnabled, ai,
}: {
  user: User;
  workspace: string;
  projects: Project[];
  project: Project | null;
  columns: Column[];
  members: Member[];
  assignments: ProjectMember[];
  feed: FeedItem[];
  notifications: FeedItem[];
  unread: Unread[];
  mine: MyTask[];
  meetings: Meeting[];
  stats: Stats | null;
  sheets: CanvasMeta[];
  tags: CanvasTag[];
  /** From `?sheet=&tag=`: an @tag clicked in another project lands here. */
  focus: { sheetId: string; tag: string } | null;
  /** From `?task=`: a card picked in search from another project opens here. */
  openTask: string | null;
  presence: MemberPresence[];
  today: string;
  dark: boolean;
  aiEnabled: boolean;
  ai: AiSettings | null;
}) {
  const router = useRouter();
  const [section, setSection] = useState<SectionKey>("home");
  const [view, setView] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  // Below md the sidebar is an off-canvas drawer; it always opens full width.
  const [drawer, setDrawer] = useState(false);
  const slim = collapsed && !drawer;
  // Refetched whenever the server sends a new board (a move, a new task…).
  const links = useGithubLinks(project?.id ?? null, !!project?.repo, columns);
  const [filters, setFilters] = useState<Filters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [notifications, setNotifications] = useState(initialNotifications);
  const [showNotifications, setShowNotifications] = useState(false);
  const [chatChannel, setChatChannel] = useState("all");
  const [alert, setAlert] = useState<Alert | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [canvasFocus, setCanvasFocus] = useState<{ sheetId: string; tag: string } | null>(null);
  const focusKey = focus ? `${focus.sheetId}:${focus.tag}` : undefined;
  const [prevFocusKey, setPrevFocusKey] = useState<string>();
  if (focusKey !== prevFocusKey) {
    setPrevFocusKey(focusKey);
    if (focus) {
      setCanvasFocus(focus);
      setSection("canvas");
    }
  }
  // `?task=` opens that card once per new value, like `focus` above.
  const [prevOpenTask, setPrevOpenTask] = useState<string | null>(null);
  if (openTask !== prevOpenTask) {
    setPrevOpenTask(openTask);
    const task = openTask && columns.flatMap((c) => c.tasks).find((t) => t.id === openTask);
    if (task) {
      setEditing(task);
      setSection("board");
    }
  }
  // Alerts already allowed: keep this browser's push subscription saved (it can rotate).
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") void subscribePush().catch(() => {});
  }, []);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearching((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // The open project's tags first, so a name used in two projects resolves here.
  const tags = useMemo(() => [...allTags.filter((t) => t.projectId === project?.id), ...allTags.filter((t) => t.projectId !== project?.id)], [allTags, project?.id]);
  // A tag is focused once: leaving the canvas forgets it, so reopening starts as usual.
  if (canvasFocus && section !== "canvas") setCanvasFocus(null);
  const seenCards = useRef(new Set(initialNotifications.map((item) => item.id)));
  const seenChats = useRef(new Map(initialUnread.map((item) => [item.channel, item.n])));
  const audio = useRef<AudioContext | null>(null);
  const alertTimer = useRef<number | undefined>(undefined);

  const filtered = useMemo(() => applyFilters(columns, filters), [columns, filters]);
  const readOnly = !!project && user.is_admin !== 1 && assignments.find((item) => item.user_id === user.id && item.project_id === project.id)?.role === "viewer";
  const activeFilters = [filters.assignee, filters.priority, filters.label].filter(Boolean).length;
  const shown = filtered.reduce((s, c) => s + c.tasks.length, 0);
  const total = columns.reduce((s, c) => s + c.tasks.length, 0);
  const labels = [...new Set(columns.flatMap((c) => c.tasks.flatMap((t) => labelsOf(t.label))))];
  const onBoard = section === "board";
  // Due reminders are derived from My Tasks on each load: no cron, no stored state.
  const due = mine.filter((t) => !t.done && t.dueDate && t.dueDate <= today);

  // Meetings come with the page and every presence ping; a save refreshes the page props.
  const [meetings, setMeetings] = useState(initialMeetings);
  const [prevMeetings, setPrevMeetings] = useState(initialMeetings);
  if (initialMeetings !== prevMeetings) {
    setPrevMeetings(initialMeetings);
    setMeetings(initialMeetings);
  }
  // The clock for meeting reminders. Null on the server render, which has no viewer time zone.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  // My meetings inside their reminder window or running now.
  const upcoming = useMemo(
    () => (now ? meetings.filter((m) => m.attendeeIds.includes(user.id)).flatMap((m) => {
      const s = meetingState(m, now);
      return s && s.state !== "later" ? [{ meeting: m, ...s }] : [];
    }) : []),
    [meetings, now, user.id],
  );
  const mentionsMe = useCallback(
    (e: FeedItem) => e.kind === "comment" && e.text.toLowerCase().includes(`@${user.name.toLowerCase()}`),
    [user.name],
  );

  const announce = useCallback((title: string, body: string) => {
    setAlert({ title, body });
    clearTimeout(alertTimer.current);
    alertTimer.current = window.setTimeout(() => setAlert(null), 5000);
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body, tag: "digital-board" });
    }
    const context = audio.current;
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.06, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.15);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.15);
  }, []);

  // One alert per meeting occurrence, when it enters the reminder window (or on load, if already in it).
  const announcedMeetings = useRef(new Set<string>());
  useEffect(() => {
    for (const u of upcoming) {
      const key = `${u.meeting.id}@${u.start.getTime()}`;
      if (announcedMeetings.current.has(key)) continue;
      announcedMeetings.current.add(key);
      announce(u.meeting.title, now ? `Meeting ${startsIn(u.start, now)}` : "Meeting");
    }
  }, [upcoming, announce, now]);

  // Keep presence and unread badges live outside the Chat section. The ping is
  // also what keeps this user's own status "online" while they sit on a board.
  const [live, setLive] = useState<MemberPresence[]>(presence);
  // A server refresh (e.g. after adding a member) brings a new list; don't wait for the next ping.
  const [prevPresence, setPrevPresence] = useState(presence);
  if (presence !== prevPresence) {
    setPrevPresence(presence);
    setLive(presence);
  }
  const [unread, setUnread] = useState<Unread[]>(initialUnread);
  useEffect(() => {
    let alive = true;
    const ping = async () => {
      try {
        const res = await fetch("/api/presence", { cache: "no-store" });
        if (!res.ok || !alive) return;
        const data = (await res.json()) as { members: MemberPresence[]; unread: Unread[]; notifications: FeedItem[]; meetings: Meeting[] };
        const fresh = data.notifications.filter((item) => !seenCards.current.has(item.id));
        const card = fresh.find(mentionsMe) ?? fresh[0];
        const chat = data.unread.find((item) => item.n > (seenChats.current.get(item.channel) ?? 0));
        seenCards.current = new Set(data.notifications.map((item) => item.id));
        // New card activity may come from outside this tab (another member, the GitHub webhook): reload the board.
        if (card) router.refresh();
        seenChats.current = new Map(data.unread.map((item) => [item.channel, item.n]));
        if (card) announce(mentionsMe(card) ? `${card.actor ?? "Someone"} mentioned you` : "Card updated", `${card.taskTitle} · ${card.text}`);
        else if (chat) announce("New chat message", chatName(chat.channel, user.id, data.members));
        setLive(data.members);
        setUnread(data.unread);
        setNotifications(data.notifications);
        setMeetings(data.meetings);
      } catch {
        // Offline for a tick; the next one recovers.
      }
    };
    void ping();
    const t = setInterval(ping, 45_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [announce, router, mentionsMe, user.id]);

  const online = live.filter((m) => m.presence === "online").length;
  const unreadTotal = section === "chat" ? 0 : unread.reduce((n, u) => n + u.n, 0);

  function markCardNotificationsRead() {
    setNotifications([]);
    void fetch("/api/presence", { method: "POST" });
  }

  function markAllNotificationsRead() {
    setNotifications([]);
    setUnread([]);
    void fetch("/api/presence?all=true", { method: "POST" });
  }

  function markNotificationItemsRead(ids: number[]) {
    setNotifications((items) => items.filter((item) => !ids.includes(item.id)));
    void fetch("/api/presence", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) });
  }

  async function enableAlerts() {
    if (typeof Notification === "undefined") {
      setAlert({ title: "Alerts unavailable", body: "This browser does not support device alerts." });
      return;
    }
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") {
      setAlert({ title: "Alerts blocked", body: "Allow notifications in your browser settings to enable device alerts." });
      return;
    }
    audio.current ??= new AudioContext();
    if (audio.current.state === "suspended") await audio.current.resume();
    const pushed = await subscribePush().catch(() => false);
    setAlert({
      title: "Alerts enabled",
      body: pushed
        ? "Mentions, direct messages and due cards reach this device even with the tab closed."
        : "New card and chat notifications will show here while this tab is open.",
    });
  }

  const close = () => {
    setEditing(null);
    setCreating(null);
    router.refresh();
  };

  const showTag = ({ tag, sheetId, projectId }: CanvasTag) => {
    if (projectId !== project?.id) {
      setEditing(null);
      setCreating(null);
      return router.push(`/board?${new URLSearchParams({ project: projectId, sheet: sheetId, tag })}`);
    }
    setCanvasFocus({ sheetId, tag });
    close();
    setSection("canvas");
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      {drawer && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setDrawer(false)} />}
      <aside
        style={{ width: slim ? 54 : 220, transition: "width 200ms cubic-bezier(0.4,0,0.2,1), transform 200ms cubic-bezier(0.4,0,0.2,1)" }}
        className={`fixed inset-y-0 left-0 z-40 flex shrink-0 flex-col overflow-hidden border-r bg-background md:static md:z-auto md:translate-x-0 ${
          drawer ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-14 items-center gap-2 border-b px-3">
          <button
            aria-label={drawer ? "Close menu" : "Collapse sidebar"}
            onClick={() => (drawer ? setDrawer(false) : setCollapsed((c) => !c))}
            className="shrink-0"
          >
            <LogoMark size={28} />
          </button>
          {!slim && (
            <EditableTitle
              value={workspace}
              onSave={(name) => renameWorkspace(name).then((r) => { router.refresh(); return r; })}
              className="min-w-0 text-sm font-semibold tracking-tight"
              inputClassName="min-w-0 w-full text-sm font-semibold tracking-tight"
            />
          )}
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 p-2 pt-3">
          {SECTIONS.map(({ key, Icon, label }) => (
            <button
              key={key}
              onClick={() => {
                setSection(key);
                if (key === "chat") setChatChannel("all");
                setDrawer(false);
              }}
              className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-all ${
                section === key ? "bg-secondary font-medium text-foreground" : "text-muted-foreground"
              }`}
            >
              <Icon className="size-4 shrink-0" />
              {!slim && <span className="whitespace-nowrap">{label}</span>}
              {!slim && key === "chat" && (
                unreadTotal > 0 ? (
                  <UnreadBadge n={unreadTotal} />
                ) : online > 0 ? (
                  <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
                    <PresenceDot presence="online" />
                    {online}
                  </span>
                ) : null
              )}
              {!slim && key === "inbox" && notifications.length > 0 && (
                <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                  {notifications.length}
                </span>
              )}
              {!slim && key === "mine" && mine.length > 0 && (
                <span className="ml-auto rounded-full border bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {mine.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        {!slim && projects.length > 0 && (
          <div className="border-t p-2">
            <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Projects</p>
            {projects.map((p) => (
              <Link
                key={p.id}
                href={`/board?project=${p.id}`}
                onClick={() => setDrawer(false)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-secondary ${
                  p.id === project?.id ? "bg-secondary" : ""
                }`}
              >
                <div
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: p.id === project?.id ? "var(--chart-1)" : "var(--muted-foreground)" }}
                />
                <span className="truncate text-xs">{p.name}</span>
              </Link>
            ))}
          </div>
        )}

        <div className="border-t p-2">
          <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
            <Avatar initials={initials(user.name)} color={user.color} size={26} />
            {!slim && (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{user.name}</p>
                  <p className="truncate text-[10px] text-muted-foreground">{user.email}</p>
                </div>
                <span className="md:hidden"><ThemeToggle /></span>
                <form action={async () => { await dropPush(); await logoutAction(); }}>
                  <button title="Sign out" className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                    <LogOut className="size-3.5" />
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:gap-4 sm:px-5">
          <button
            aria-label="Open menu"
            onClick={() => setDrawer(true)}
            className="-ml-1 rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground md:hidden"
          >
            <Menu className="size-4" />
          </button>
          {onBoard && project ? (
            <EditableTitle
              value={project.name}
              onSave={(name) => renameProject(project.id, name).then((r) => { router.refresh(); return r; })}
              className="min-w-0 truncate text-sm font-semibold"
              inputClassName="text-sm font-semibold w-48"
            />
          ) : (
            <h1 className="min-w-0 truncate text-sm font-semibold">
              {onBoard ? "Board" : SECTIONS.find((s) => s.key === section)!.label}
            </h1>
          )}

          {onBoard && project && (
            <div className="flex items-center gap-0.5 rounded-md border bg-secondary p-0.5">
              {(project?.repo ? [...VIEWS, GITHUB_VIEW] : VIEWS).map(({ Icon, label }, i) => (
                <button
                  key={label}
                  onClick={() => setView(i)}
                  title={label}
                  aria-label={label}
                  className={`flex items-center gap-1.5 rounded px-1.5 py-1 text-xs transition-all sm:px-2.5 ${
                    view === i ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  <Icon className="size-3.5" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
          )}

          <div className="flex-1" />

          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            {onBoard && project && view !== VIEWS.length && (
              <>
                <label className="hidden min-w-[180px] items-center gap-1.5 rounded-md border bg-secondary px-2.5 py-1.5 text-xs sm:flex">
                  <Search className="size-3.5 shrink-0 text-muted-foreground" />
                  <input
                    value={filters.q ?? ""}
                    onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
                    placeholder="Search tasks…"
                    className="w-full bg-transparent outline-none placeholder:text-muted-foreground"
                  />
                </label>
                <button
                  onClick={() => setShowFilters((s) => !s)}
                  className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors hover:bg-secondary ${
                    activeFilters ? "border-primary font-medium" : "text-muted-foreground"
                  }`}
                >
                  <Filter className="size-3.5" />
                  <span className="hidden sm:inline">Filter</span>
                  {activeFilters > 0 && (
                    <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{activeFilters}</span>
                  )}
                </button>
              </>
            )}
            <button
              onClick={() => setSearching(true)}
              title="Search (⌘K)"
              aria-label="Search"
              className="flex items-center gap-1.5 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Search className="size-4" />
              <kbd className="hidden rounded border px-1 text-[10px] lg:inline">⌘K</kbd>
            </button>
            {/* On phones the toggle lives in the drawer's footer instead. */}
            <span className="hidden md:contents"><ThemeToggle /></span>
            <div className="relative">
              <button
                aria-label="Notifications"
                aria-expanded={showNotifications}
                aria-haspopup="menu"
                onClick={() => setShowNotifications((open) => !open)}
                className="relative rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <Bell className="size-4" />
                {(notifications.length > 0 || unread.length > 0 || due.length > 0 || upcoming.length > 0) && <span className="absolute right-1 top-1 size-1.5 rounded-full bg-[var(--chart-7)]" />}
              </button>
              {showNotifications && (
                <NotificationMenu
                  cards={notifications}
                  due={due}
                  meetings={upcoming.map((u) => ({ id: u.meeting.id, title: u.meeting.title, when: u.state === "live" || !now ? "Now" : startsIn(u.start, now) }))}
                  onOpenMeetings={() => {
                    setShowNotifications(false);
                    setSection("meetings");
                  }}
                  today={today}
                  mentionsMe={mentionsMe}
                  onOpenMine={() => {
                    setShowNotifications(false);
                    setSection("mine");
                  }}
                  unread={unread}
                  meId={user.id}
                  members={live}
                  onOpenInbox={() => {
                    markCardNotificationsRead();
                    setShowNotifications(false);
                    setSection("inbox");
                  }}
                  onOpenChat={(channel) => {
                    setUnread((items) => items.filter((item) => item.channel !== channel));
                    setChatChannel(channel);
                    setShowNotifications(false);
                    setSection("chat");
                  }}
                  onMarkRead={markAllNotificationsRead}
                  onOpenInboxPage={() => {
                    setShowNotifications(false);
                    setSection("inbox");
                  }}
                  onEnableAlerts={enableAlerts}
                />
              )}
            </div>
            {project && !readOnly && section !== "canvas" && (
              <button
                onClick={() => setAgentOpen((o) => !o)}
                title="Project agent"
                aria-pressed={agentOpen}
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors hover:bg-secondary ${agentOpen ? "border-primary font-medium" : "text-muted-foreground"}`}
              >
                <Sparkles className="size-3.5" />
                <span className="hidden sm:inline">Agent</span>
              </button>
            )}
            {project && section !== "canvas" && (
              <button
                onClick={() => setCreating(columns[0]?.id ?? "")}
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                <Plus className="size-3" />
                <span className="hidden sm:inline">New Task</span>
              </button>
            )}
          </div>
        </header>

        {/* Filter bar */}
        {onBoard && showFilters && project && view !== VIEWS.length && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-secondary/50 px-5 py-2.5 text-xs">
            <select
              value={filters.assignee ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, assignee: e.target.value || undefined }))}
              className="rounded-md border bg-background px-2 py-1"
            >
              <option value="">All assignees</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <select
              value={filters.priority ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value || undefined }))}
              className="rounded-md border bg-background px-2 py-1"
            >
              <option value="">All priorities</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            {labels.length > 0 && (
              <select
                value={filters.label ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, label: e.target.value || undefined }))}
                className="rounded-md border bg-background px-2 py-1"
              >
                <option value="">All labels</option>
                {labels.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            )}
            <button
              onClick={() => setFilters({ q: filters.q })}
              className="flex items-center gap-1 rounded-md border px-2 py-1 text-muted-foreground transition-colors hover:bg-secondary"
            >
              <X className="size-3" />
              Reset
            </button>
            <button
              onClick={() => setShowArchived(true)}
              className="flex items-center gap-1 rounded-md border px-2 py-1 text-muted-foreground transition-colors hover:bg-secondary"
            >
              <Archive className="size-3" />
              Archived
            </button>
            <span className="ml-auto text-muted-foreground">
              {shown} of {total} tasks
            </span>
          </div>
        )}

        {/* Content. The key restarts the entrance on every section/view change. */}
        <div key={`${section}:${view}`} className="flex flex-1 flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-1 duration-200">
        {section === "home" ? (
          <HomeView
            userName={user.name}
            project={project}
            columnCount={columns.length}
            today={today}
            stats={stats}
            mine={mine}
            feed={feed}
            onGo={setSection}
          />
        ) : section === "chat" ? (
          <ChatView key={chatChannel} meId={user.id} initialMembers={live} initialChannel={chatChannel} tags={tags} onTag={showTag} />
        ) : section === "settings" ? (
          <MembersPanel workspace={workspace} memberId={user.id} presence={live} isAdmin={user.is_admin === 1} projects={projects} assignments={assignments} activeProjectId={project?.id ?? null} ai={ai} />
        ) : section === "meetings" ? (
          <MeetingsView meetings={meetings} members={members} meId={user.id} isAdmin={user.is_admin === 1} now={now} />
        ) : !project ? (
          <EmptyProject />
        ) : section === "canvas" ? (
          <CanvasView
            // A fresh sheet list per project, so an @tag's sheet is the one that opens.
            key={project.id}
            projectId={project.id}
            sheets={sheets}
            dark={dark}
            aiEnabled={aiEnabled}
            // Viewers can watch live but every save would be refused, so don't let them draw.
            readOnly={readOnly}
            onChanged={() => router.refresh()}
            focus={canvasFocus}
          />
        ) : section === "inbox" ? (
          <FeedView feed={notifications} mentionsMe={mentionsMe} onMarkRead={markNotificationItemsRead} onMarkAll={markCardNotificationsRead} />
        ) : section === "mine" ? (
          <MyTasksView tasks={mine} onOpen={(id) => setEditing(columns.flatMap((c) => c.tasks).find((t) => t.id === id) ?? null)} />
        ) : view === VIEWS.length && project.repo ? (
          <GithubView key={project.id} projectId={project.id} repo={project.repo} />
        ) : view === 0 ? (
          <BoardView columns={filtered} projectId={project.id} doneColumnId={project.doneColumnId} today={today} links={links} onOpen={setEditing} onAdd={setCreating} />
        ) : view === 1 ? (
          <ListView columns={filtered} members={members} readOnly={readOnly} onOpen={setEditing} />
        ) : view === 2 ? (
          <CalendarView columns={filtered} projectId={project.id} onOpen={setEditing} />
        ) : (
          stats && <AnalyticsView stats={stats} />
        )}
        </div>
      </div>

      {project && !readOnly && (
        <ProjectAgent
          key={project.id}
          projectId={project.id}
          enabled={aiEnabled}
          open={agentOpen && section !== "canvas"}
          tags={tags.filter((t) => t.projectId === project.id)}
          onTag={showTag}
          onClose={() => setAgentOpen(false)}
        />
      )}
      {(editing || creating !== null) && (
        <TaskDialog
          task={editing}
          columns={columns}
          members={members}
          mentionable={members.filter((m) => live.some((p) => p.id === m.id && p.is_admin === 1) || assignments.some((a) => a.user_id === m.id && a.project_id === project?.id))}
          defaultColumnId={creating ?? undefined}
          links={editing?.key ? links[editing.key] : undefined}
          repo={project?.repo}
          tags={tags}
          onTag={showTag}
          onClose={close}
        />
      )}
      {showArchived && project && (
        <ArchivedDialog projectId={project.id} readOnly={readOnly} onClose={() => setShowArchived(false)} />
      )}
      {searching && (
        <SearchPalette
          projects={projects}
          meetings={meetings}
          channelName={(channel) => chatName(channel, user.id, live)}
          onClose={() => setSearching(false)}
          onCard={(card: SearchCard) => {
            setSearching(false);
            const task = card.projectId === project?.id && columns.flatMap((c) => c.tasks).find((t) => t.id === card.id);
            if (!task) return router.push(`/board?${new URLSearchParams({ project: card.projectId, task: card.id })}`);
            setEditing(task);
            setSection("board");
          }}
          onProject={(projectId) => {
            setSearching(false);
            setSection("board");
            if (projectId !== project?.id) router.push(`/board?project=${projectId}`);
          }}
          onMessage={(channel) => {
            setSearching(false);
            setChatChannel(channel);
            setSection("chat");
          }}
          onMeeting={() => {
            setSearching(false);
            setSection("meetings");
          }}
        />
      )}
      {alert && (
        <button onClick={() => setAlert(null)} className="fixed bottom-5 right-5 z-50 w-80 rounded-lg border bg-card p-3 text-left shadow-lg animate-in fade-in slide-in-from-bottom-4 duration-300">
          <p className="text-sm font-medium">{alert.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{alert.body}</p>
        </button>
      )}
    </div>
  );
}

/** Archived cards of the open project; Restore puts one back at the end of its column. */
function ArchivedDialog({ projectId, readOnly, onClose }: { projectId: string; readOnly: boolean; onClose: () => void }) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  useEffect(() => {
    fetchArchived(projectId).then(setTasks);
  }, [projectId]);
  return (
    <Modal title="Archived tasks" onClose={onClose}>
      {tasks === null ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : tasks.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing archived. Archive a card from its dialog.</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2">
              <span className="font-mono text-[11px] text-muted-foreground">{t.key}</span>
              <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
              {!readOnly && (
                <button
                  onClick={async () => {
                    await archiveTask(t.id, false);
                    setTasks((list) => list?.filter((x) => x.id !== t.id) ?? null);
                  }}
                  className="rounded-md border px-2 py-1 text-xs transition-colors hover:bg-secondary"
                >
                  Restore
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function EmptyProject() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center">
      <p className="text-sm font-medium">No project yet</p>
      <p className="max-w-sm text-xs text-muted-foreground">Re-run setup to create your first project.</p>
    </div>
  );
}

function FeedView({ feed: all, mentionsMe, onMarkRead, onMarkAll }: {
  feed: FeedItem[]; mentionsMe: (e: FeedItem) => boolean; onMarkRead: (ids: number[]) => void; onMarkAll: () => void;
}) {
  const [selected, setSelected] = useState(new Set<number>());
  const [onlyMentions, setOnlyMentions] = useState(false);
  const feed = onlyMentions ? all.filter(mentionsMe) : all;
  if (all.length === 0) {
    return <div className="flex flex-1 items-center justify-center p-10 text-center text-sm text-muted-foreground">No unread notifications.</div>;
  }
  function readSelected() {
    onMarkRead([...selected]);
    setSelected(new Set());
  }
  return (
    <main className="flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-2xl items-center gap-2 px-5 pt-6">
        <button onClick={readSelected} disabled={selected.size === 0} className="rounded border px-2 py-1 text-xs disabled:opacity-40">Mark selected read</button>
        <button onClick={onMarkAll} className="rounded border px-2 py-1 text-xs">Mark all read</button>
        <button
          onClick={() => setOnlyMentions((on) => !on)}
          aria-pressed={onlyMentions}
          className={`ml-auto rounded border px-2 py-1 text-xs ${onlyMentions ? "border-primary font-medium" : ""}`}
        >
          Mentioned me
        </button>
      </div>
      {feed.length === 0 && <p className="mx-auto max-w-2xl px-5 py-6 text-sm text-muted-foreground">No unread mentions.</p>}
      <ul className="mx-auto max-w-2xl divide-y px-5 py-3">
        {feed.map((e) => (
          <li key={e.id} onContextMenu={(event) => { event.preventDefault(); onMarkRead([e.id]); }} className="flex items-start gap-3 py-3">
            <button type="button" aria-label={`Select ${e.taskTitle}`} aria-pressed={selected.has(e.id)} onClick={() => setSelected((ids) => {
              const next = new Set(ids);
              if (next.has(e.id)) next.delete(e.id);
              else next.add(e.id);
              return next;
            })} className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition-colors ${
              selected.has(e.id) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-transparent hover:bg-secondary"
            }`}>
              <Check className="size-3" strokeWidth={3} />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-snug">
                {e.taskTitle}
                {mentionsMe(e) && <span className="ml-1.5 rounded bg-primary px-1 py-px text-[10px] font-semibold text-primary-foreground">@you</span>}
              </p>
              <p className="text-xs text-muted-foreground">{e.text}{e.actor ? ` · ${e.actor}` : ""}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="flex items-center gap-1.5 rounded-full border bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground"><span className="size-1.5 rounded-full" style={{ background: e.columnColor }} />{e.columnTitle}</span>
              <span className="w-28 text-right text-[11px] text-muted-foreground">{e.atLabel}</span>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}

/** A chat channel's name: the workspace, your private agent thread (a DM to yourself), or the other person. */
const chatName = (channel: string, meId: string, members: { id: string; name: string }[]) =>
  channel === "all" ? "Workspace" : channel === meId ? "Agent" : members.find((m) => m.id === channel)?.name ?? "Direct message";

function NotificationMenu({
  cards, due, meetings, onOpenMeetings, today, mentionsMe, onOpenMine, unread, meId, members, onOpenInbox, onOpenChat, onMarkRead, onOpenInboxPage, onEnableAlerts,
}: {
  cards: FeedItem[];
  due: MyTask[];
  meetings: { id: string; title: string; when: string }[];
  onOpenMeetings: () => void;
  today: string;
  mentionsMe: (e: FeedItem) => boolean;
  onOpenMine: () => void;
  unread: Unread[];
  meId: string;
  members: MemberPresence[];
  onOpenInbox: () => void;
  onOpenChat: (channel: string) => void;
  onMarkRead: () => void;
  onOpenInboxPage: () => void;
  onEnableAlerts: () => void;
}) {
  return (
    <div role="menu" className="absolute right-0 top-full z-40 mt-2 w-80 overflow-hidden rounded-lg border bg-card shadow-lg animate-in fade-in zoom-in-95 slide-in-from-top-1 duration-150">
      <div className="max-h-80 overflow-y-auto p-1">
        {meetings.length > 0 && (
          <>
            <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Meetings</p>
            {meetings.map((m) => (
              <button key={m.id} role="menuitem" onClick={onOpenMeetings} className="w-full rounded-md px-2 py-2 text-left hover:bg-secondary">
                <p className="truncate text-xs font-medium">{m.title}</p>
                <p className="truncate text-[11px] font-medium text-[var(--chart-2)]">{m.when}</p>
              </button>
            ))}
          </>
        )}
        {due.length > 0 && (
          <>
            <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Due</p>
            {due.map((t) => (
              <button key={t.id} role="menuitem" onClick={onOpenMine} className="w-full rounded-md px-2 py-2 text-left hover:bg-secondary">
                <p className="truncate text-xs font-medium">{t.title}</p>
                <p className={`truncate text-[11px] ${t.dueDate! < today ? "font-medium text-[var(--chart-7)]" : "text-muted-foreground"}`}>
                  {t.dueDate! < today ? `Overdue since ${t.dueDate}` : "Due today"} · {t.projectName}
                </p>
              </button>
            ))}
          </>
        )}
        {cards.length > 0 && (
          <>
            <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Card notifications</p>
            {cards.map((item) => (
              <button key={item.id} role="menuitem" onClick={onOpenInbox} className="w-full rounded-md px-2 py-2 text-left hover:bg-secondary">
                <p className="truncate text-xs font-medium">
                  {mentionsMe(item) && <span className="mr-1 font-semibold text-primary">@you</span>}
                  {item.taskTitle}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">{item.text}{item.actor ? ` · ${item.actor}` : ""}</p>
              </button>
            ))}
          </>
        )}
        {unread.length > 0 && (
          <>
            <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Chat notifications</p>
            {unread.map((item) => (
              <button key={item.channel} role="menuitem" onClick={() => onOpenChat(item.channel)} className="w-full rounded-md px-2 py-2 text-left hover:bg-secondary">
                <p className="text-xs font-medium">{chatName(item.channel, meId, members)}</p>
                <p className="text-[11px] text-muted-foreground">{item.n} new message{item.n === 1 ? "" : "s"}</p>
              </button>
            ))}
          </>
        )}
        {cards.length === 0 && unread.length === 0 && due.length === 0 && meetings.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">No unread notifications.</p>
        )}
      </div>
      <div className="flex border-t p-1">
        <button onClick={onMarkRead} disabled={cards.length === 0 && unread.length === 0} className="rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-secondary disabled:opacity-40">Mark all read</button>
        <button onClick={onEnableAlerts} className="rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-secondary">Enable alerts</button>
        <button onClick={onOpenInboxPage} className="ml-auto rounded px-2 py-1.5 text-xs font-medium hover:bg-secondary">Open inbox</button>
      </div>
    </div>
  );
}
