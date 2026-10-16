"use client";

import { startTransition, useActionState, useEffect, useEffectEvent, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, FolderKanban, FolderPlus, KeyRound, Plus, Settings2, Sparkles, Trash2, UserRound, Users, X } from "lucide-react";
import { changeMyPassword, fetchAiModels, rotateGithubWebhook, rotateInboundToken, saveGithub, setProjectKey, saveAiConfig, deleteProject, inviteMember, renameProject, renameWorkspace, setMemberPassword, setProjectMember } from "@/lib/actions";
import { initials } from "@/lib/board";
import type { MemberPresence, Project, ProjectMember } from "@/lib/queries";
import { Avatar } from "./avatar";
import { PresenceDot } from "./views/chat-view";
import { Field, FormError, Select, SubmitButton } from "./form-bits";
import type { AiProvider, AiSettings } from "@/lib/ai";
import { EditableTitle } from "./editable-title";
import { Modal } from "./modal";
import { NewProjectDialog } from "./new-project-dialog";
import { REASONING_OPTIONS } from "./canvas-agent";

const ago = (iso: string | null) => {
  if (!iso) return "never signed in";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.floor(hrs / 24)}d ago`;
};

type Role = ProjectMember["role"];
const ROLE_LABEL: Record<Role, string> = { viewer: "View", editor: "Edit", admin: "Admin" };
const ROLES = Object.keys(ROLE_LABEL) as Role[];

const TABS = [
  { id: "general", label: "General", Icon: Settings2, adminOnly: false },
  { id: "members", label: "Members", Icon: Users, adminOnly: false },
  { id: "projects", label: "Projects", Icon: FolderKanban, adminOnly: false },
  { id: "ai", label: "AI agent", Icon: Sparkles, adminOnly: true },
  { id: "account", label: "Account", Icon: UserRound, adminOnly: false },
] as const;
type Tab = (typeof TABS)[number]["id"];

const list = "divide-y rounded-lg border bg-card";
const smallSelect = "rounded-md border bg-background px-2 py-1 text-xs outline-none focus:border-ring";

/** Title row of a tab: heading, one line of context, and its main action on the right. */
function TabHeader({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <header className="mb-4 flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {action}
    </header>
  );
}

function PrimaryButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
    >
      {children}
    </button>
  );
}

export function MembersPanel({
  workspace, memberId, presence, isAdmin, projects, assignments, activeProjectId, ai,
}: {
  workspace: string;
  memberId: string;
  presence: MemberPresence[];
  isAdmin: boolean;
  projects: Project[];
  assignments: ProjectMember[];
  activeProjectId: string | null;
  ai: AiSettings | null;
}) {
  const [tab, setTab] = useState<Tab>("general");
  const tabs = TABS.filter((t) => isAdmin || !t.adminOnly);
  const me = presence.find((m) => m.id === memberId);

  return (
    <main className="flex min-h-0 flex-1 flex-col md:flex-row">
      {/* Same divider as the chat's conversation list: border-r on desktop, border-b on phones. */}
      <nav aria-label="Settings" className="flex shrink-0 gap-1 overflow-x-auto border-b p-3 md:w-56 md:flex-col md:border-r md:border-b-0">
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            aria-current={tab === id ? "page" : undefined}
            className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
              tab === id ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            }`}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </nav>

      <div className="min-w-0 flex-1 overflow-y-auto px-4 py-6 md:px-8">
        <div className="max-w-xl">
          {tab === "general" && <GeneralTab workspace={workspace} isAdmin={isAdmin} />}
          {tab === "members" && <MembersTab presence={presence} isAdmin={isAdmin} projects={projects} assignments={assignments} />}
          {tab === "projects" && (
            <ProjectsTab
              memberId={memberId} presence={presence} isAdmin={isAdmin}
              projects={projects} assignments={assignments} activeProjectId={activeProjectId}
            />
          )}
          {tab === "ai" && isAdmin && (
            <>
              <TabHeader title="AI agent" hint="Powers the Agent chat on the canvas. The API key is never shown again after saving." />
              <AiSettingsForm ai={ai} />
            </>
          )}
          {tab === "account" && (
            <>
              <TabHeader title="Account" hint={me ? `${me.name} · ${me.email}` : undefined} />
              <h3 className="mb-1 text-sm font-medium">Password</h3>
              <p className="mb-3 text-xs text-muted-foreground">
                Changing it signs out your other devices. There is no email reset; an admin can set a new one for you.
              </p>
              <ChangePassword />
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function GeneralTab({ workspace, isAdmin }: { workspace: string; isAdmin: boolean }) {
  const router = useRouter();
  return (
    <>
      <TabHeader title="General" />
      <label className="mb-1.5 block text-xs font-medium">Workspace name</label>
      {isAdmin ? (
        <EditableTitle
          value={workspace}
          onSave={(name) => renameWorkspace(name).then((res) => { router.refresh(); return res; })}
          className="rounded-lg border bg-card px-3 py-2 text-sm font-medium"
          inputClassName="w-full text-sm font-medium"
        />
      ) : (
        <p className="rounded-lg border bg-card px-3 py-2 text-sm font-medium">{workspace}</p>
      )}
      {isAdmin && <p className="mt-1.5 text-[11px] text-muted-foreground">Click the name to rename it.</p>}
    </>
  );
}

function MembersTab({ presence, isAdmin, projects, assignments }: {
  presence: MemberPresence[];
  isAdmin: boolean;
  projects: Project[];
  assignments: ProjectMember[];
}) {
  const [inviting, setInviting] = useState(false);
  const online = presence.filter((m) => m.presence === "online").length;

  return (
    <>
      <TabHeader
        title="Members"
        hint={`${presence.length} in this workspace · ${online} online now`}
        action={isAdmin && <PrimaryButton onClick={() => setInviting(true)}><Plus className="size-3.5" /> Add member</PrimaryButton>}
      />
      <ul className={list}>
        {presence.map((m) => {
          const count = assignments.filter((a) => a.user_id === m.id).length;
          return (
            <li key={m.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="relative shrink-0">
                <Avatar initials={initials(m.name)} color={m.color} size={30} />
                <PresenceDot presence={m.presence} className="absolute -bottom-0.5 -right-0.5 ring-2 ring-card" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  {m.name}
                  {m.is_admin === 1 && (
                    <span className="ml-1.5 rounded-full border bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">admin</span>
                  )}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {m.email} · {m.is_admin === 1 ? "all projects" : `${count} project${count === 1 ? "" : "s"}`}
                </p>
              </div>
              <p className="hidden shrink-0 text-right text-[11px] text-muted-foreground sm:block">
                {m.presence === "online" ? "online" : ago(m.lastSeen)}
              </p>
              {isAdmin && <SetPassword userId={m.id} name={m.name} />}
            </li>
          );
        })}
      </ul>
      {inviting && <InviteDialog projects={projects} onClose={() => setInviting(false)} />}
    </>
  );
}

/** New member plus their project access in one go; unassigned means they see no project. */
function InviteDialog({ projects, onClose }: { projects: Project[]; onClose: () => void }) {
  const [state, action] = useActionState(inviteMember, null);
  const close = useEffectEvent(onClose);
  useEffect(() => { if (state?.ok) close(); }, [state]);

  return (
    <Modal title="Add member" onClose={onClose}>
      <form action={action} className="flex flex-col gap-4">
        <Field label="Name" name="name" required autoFocus />
        <Field label="Email" name="email" type="email" required />
        <Field label="Temporary password" name="password" type="password" required minLength={8} hint="Share it with them; they can change it under Account." />
        {projects.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Project access</span>
            <ul className={list}>
              {projects.map((p) => (
                <li key={p.id} className="flex items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                  <select name={`access:${p.id}`} defaultValue="" aria-label={`Access to ${p.name}`} className={smallSelect}>
                    <option value="">No access</option>
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          </div>
        )}
        <FormError error={state?.error} />
        <SubmitButton>Add member</SubmitButton>
      </form>
    </Modal>
  );
}

function ProjectsTab({ memberId, presence, isAdmin, projects, assignments, activeProjectId }: {
  memberId: string;
  presence: MemberPresence[];
  isAdmin: boolean;
  projects: Project[];
  assignments: ProjectMember[];
  activeProjectId: string | null;
}) {
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = projects.find((p) => p.id === openId);

  if (open) {
    return (
      <ProjectDetail
        project={open} memberId={memberId} presence={presence} isAdmin={isAdmin}
        assignments={assignments.filter((a) => a.project_id === open.id)} onBack={() => setOpenId(null)}
      />
    );
  }

  return (
    <>
      <TabHeader
        title="Projects"
        hint={isAdmin ? "Open a project to manage who can see and edit it." : "Projects you have access to."}
        action={isAdmin && <PrimaryButton onClick={() => setCreating(true)}><FolderPlus className="size-3.5" /> New project</PrimaryButton>}
      />
      {projects.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">No projects yet.</p>
      ) : (
        <ul className={list}>
          {projects.map((p) => {
            const count = assignments.filter((a) => a.project_id === p.id).length;
            return (
              <li key={p.id}>
                <button onClick={() => setOpenId(p.id)} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-secondary/50">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: p.id === activeProjectId ? "var(--chart-1)" : "var(--muted-foreground)" }}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{count} member{count === 1 ? "" : "s"}</span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}
    </>
  );
}

/** One project's settings: name, who has which role, and deletion. */
function ProjectDetail({ project, memberId, presence, isAdmin, assignments, onBack }: {
  project: Project;
  memberId: string;
  presence: MemberPresence[];
  isAdmin: boolean;
  assignments: ProjectMember[];
  onBack: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  const [addRole, setAddRole] = useState<Role>("editor");
  const canRename = isAdmin || assignments.some((a) => a.user_id === memberId && a.role === "admin");
  // Workspace admins reach every project, so they never appear as assignable.
  const assigned = assignments.flatMap((a) => {
    const m = presence.find((p) => p.id === a.user_id);
    return m ? [{ member: m, role: a.role }] : [];
  });
  const unassigned = presence.filter((m) => m.is_admin !== 1 && !assignments.some((a) => a.user_id === m.id));

  async function setRole(userId: string, role: Role | "") {
    const res = await setProjectMember(project.id, userId, role);
    if (res?.error) return setError(res.error);
    setError(null);
    router.refresh();
  }

  async function remove() {
    if (!confirm(`Delete "${project.name}"? Its columns, tasks, history and canvas sheets are deleted with it.`)) return;
    const res = await deleteProject(project.id);
    if (res?.error) return setError(res.error);
    router.push("/board");
    router.refresh();
  }

  return (
    <>
      <button onClick={onBack} className="mb-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-3.5" /> Projects
      </button>
      {canRename ? (
        <EditableTitle
          value={project.name}
          onSave={(name) => renameProject(project.id, name).then((res) => { router.refresh(); return res; })}
          className="mb-4 text-base font-semibold"
          inputClassName="mb-4 w-full text-base font-semibold"
        />
      ) : (
        <h2 className="mb-4 text-base font-semibold">{project.name}</h2>
      )}

      <div className="mb-6 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">Task key</h3>
          <p className="text-xs text-muted-foreground">
            Cards are numbered {project.key}-1, {project.key}-2… Put the key in a branch, PR title or commit to link it to the card.
          </p>
        </div>
        {canRename ? (
          <EditableTitle
            value={project.key}
            onSave={(key) => setProjectKey(project.id, key).then((res) => { router.refresh(); return res; })}
            className="shrink-0 rounded-md border bg-card px-2 py-1 font-mono text-sm"
            inputClassName="w-24 font-mono text-sm uppercase"
          />
        ) : (
          <span className="shrink-0 font-mono text-sm">{project.key}</span>
        )}
      </div>

      <h3 className="mb-1 text-sm font-medium">Members</h3>
      <p className="mb-3 text-xs text-muted-foreground">View can only look · Edit can change tasks and canvas · Admin can also rename it and manage columns. Workspace admins can open every project.</p>
      {assigned.length === 0 ? (
        <p className="mb-3 rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">Only workspace admins can see this project.</p>
      ) : (
        <ul className={`${list} mb-3`}>
          {assigned.map(({ member, role }) => (
            <li key={member.id} className="flex items-center gap-2.5 px-3 py-2">
              <Avatar initials={initials(member.name)} color={member.color} size={24} />
              <span className="min-w-0 flex-1 truncate text-sm">{member.name}</span>
              {isAdmin ? (
                <>
                  <select value={role} onChange={(e) => void setRole(member.id, e.target.value as Role)} aria-label={`${member.name} access`} className={smallSelect}>
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                  <button onClick={() => void setRole(member.id, "")} title={`Remove ${member.name}`} className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
                    <X className="size-3.5" />
                  </button>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">{ROLE_LABEL[role]}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {isAdmin && unassigned.length > 0 && (
        <div className="flex gap-2">
          <select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Member to add" className={`${smallSelect} min-w-0 flex-1 py-1.5`}>
            <option value="">Add a member…</option>
            {unassigned.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <select value={addRole} onChange={(e) => setAddRole(e.target.value as Role)} aria-label="Role" className={`${smallSelect} py-1.5`}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          <button
            disabled={!adding}
            onClick={() => { void setRole(adding, addRole); setAdding(""); }}
            className="rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-40"
          >
            Add
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-[var(--chart-7)]">{error}</p>}

      {canRename && <GithubSettings project={project} />}
      {canRename && <InboundWebhook project={project} />}

      {isAdmin && (
        <div className="mt-8 flex items-center gap-3 rounded-lg border border-[rgba(239,68,68,0.3)] px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Delete project</p>
            <p className="text-[11px] text-muted-foreground">Removes its columns, tasks, history and canvas sheets.</p>
          </div>
          <button onClick={() => void remove()} className="flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs text-[var(--chart-7)] hover:bg-[rgba(239,68,68,0.08)]">
            <Trash2 className="size-3.5" /> Delete
          </button>
        </div>
      )}
    </>
  );
}

/** Repo + fine-grained token for the project's GitHub view. The token is write-only from here. */
function GithubSettings({ project }: { project: Project }) {
  const router = useRouter();
  const [repo, setRepo] = useState(project.repo ?? "");
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; error?: string; repo?: string } | null>(null);
  const [busy, startBusy] = useTransition();

  const save = (nextRepo: string) =>
    startBusy(async () => {
      const res = await saveGithub(project.id, nextRepo, token);
      setMsg(res);
      if (res.ok) {
        setToken("");
        setRepo(res.repo ?? "");
        router.refresh();
      }
    });

  return (
    <section className="mt-8">
      <h3 className="mb-1 text-sm font-medium">GitHub</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Shows this repo&rsquo;s pull requests, issues, commits and branches in the project&rsquo;s GitHub view. Use a{" "}
        <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer" className="underline">
          fine-grained token
        </a>{" "}
        limited to this repo with read-only Contents, Issues, Pull requests and Metadata.
      </p>
      <form
        onSubmit={(e) => { e.preventDefault(); save(repo); }}
        className="flex flex-col gap-3 rounded-lg border bg-card p-3"
      >
        <Field label="Repository" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/name" autoComplete="off" />
        <Field
          label="Token"
          hint="Optional for a public repo (GitHub then allows 60 requests an hour)."
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
          placeholder={project.tokenHint ? `Saved (…${project.tokenHint}) — leave blank to keep` : "github_pat_…"}
        />
        {msg?.error && <FormError error={msg.error} />}
        {msg?.ok && <p className="text-xs text-[var(--chart-2)]">{msg.ok}</p>}
        <div className="flex items-center gap-2">
          <button disabled={busy || !repo.trim()} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {busy ? "Checking…" : project.repo ? "Save" : "Connect"}
          </button>
          {project.repo && (
            <button type="button" disabled={busy} onClick={() => save("")} className="rounded-md border px-3 py-2 text-xs text-muted-foreground hover:bg-secondary">
              Disconnect
            </button>
          )}
        </div>
      </form>
      {project.repo && <GithubWebhook project={project} />}
    </section>
  );
}

const noSubscribe = () => () => {};

/** A read-only value with a Copy button, for webhook URLs and secrets. */
const row = (label: string, value: string) => (
  <div className="flex flex-col gap-1">
    <span className="text-xs font-medium">{label}</span>
    <div className="flex gap-1.5">
      <input readOnly value={value} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 rounded-md border bg-background px-2.5 py-1.5 font-mono text-[11px]" />
      <button type="button" onClick={() => void navigator.clipboard.writeText(value)} className="rounded-md border px-2 text-[11px] text-muted-foreground hover:bg-secondary">
        Copy
      </button>
    </div>
  </div>
);

/**
 * Webhook setup: the URL and a secret to paste into the repo's Settings → Webhooks.
 * The secret is shown once, right after it is generated.
 */
function GithubWebhook({ project }: { project: Project }) {
  const router = useRouter();
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();
  // The address people use for this app is what GitHub must call; empty during SSR.
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => "");
  const url = origin && `${origin}/api/integrations/github?project=${project.id}`;

  const generate = () =>
    startBusy(async () => {
      if (project.webhookHint && !confirm("Make a new secret? The webhook stops working until you paste the new one into GitHub.")) return;
      const res = await rotateGithubWebhook(project.id);
      if ("error" in res) return setError(res.error ?? null);
      setError(null);
      setSecret(res.secret);
      router.refresh();
    });

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg border bg-card p-3">
      <div>
        <h4 className="text-xs font-semibold">Webhook — move cards automatically</h4>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          In {project.repo} → Settings → Webhooks → Add webhook, paste the URL and secret, set content type to{" "}
          <span className="font-mono">application/json</span>, and pick the events Pull requests, Pushes and Check suites. Then a push to a
          card&rsquo;s branch moves it to In Progress, an opened PR to In Review, a merged PR to QA (or Done), and failing checks show in its
          history. Cards only move forward. GitHub must be able to reach this address.
        </p>
      </div>
      {url && row("Payload URL", url)}
      {secret ? (
        <>
          {row("Secret", secret)}
          <p className="-mt-1 text-[11px] text-[var(--chart-3)]">Copy it now — it won&rsquo;t be shown again.</p>
        </>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          {project.webhookHint ? `Secret set (…${project.webhookHint}).` : "No secret yet."}
        </p>
      )}
      {error && <FormError error={error} />}
      <div>
        <button type="button" disabled={busy} onClick={generate} className="rounded-md border px-3 py-1.5 text-xs hover:bg-secondary disabled:opacity-50">
          {busy ? "Generating…" : project.webhookHint ? "Generate new secret" : "Generate secret"}
        </button>
      </div>
    </div>
  );
}

/**
 * Generic inbound webhook: a URL + bearer token that Zapier, Make, a form tool or
 * curl can POST to, creating a card. The token is shown once, right after it is made.
 */
function InboundWebhook({ project }: { project: Project }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => "");
  const url = origin && `${origin}/api/integrations/inbound?project=${project.id}`;

  const generate = () =>
    startBusy(async () => {
      if (project.inbound && !confirm("Make a new token? Anything using the old one stops working.")) return;
      const res = await rotateInboundToken(project.id);
      if ("error" in res) return setError(res.error ?? null);
      setError(null);
      setToken(res.token);
      router.refresh();
    });

  return (
    <section className="mt-8">
      <h3 className="mb-1 text-sm font-medium">Inbound webhook</h3>
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-3">
        <p className="text-[11px] text-muted-foreground">
          Create cards from Zapier, Make, a form tool or any script. POST JSON or form fields to the URL with the header{" "}
          <span className="font-mono">Authorization: Bearer &lt;token&gt;</span> (or add <span className="font-mono">&amp;token=&lt;token&gt;</span> to
          the URL). Fields: <span className="font-mono">title</span> (required), <span className="font-mono">description</span>,{" "}
          <span className="font-mono">label</span>, <span className="font-mono">priority</span> (low, medium, high),{" "}
          <span className="font-mono">due_date</span> (YYYY-MM-DD), <span className="font-mono">column</span> (its title; default the first column).
        </p>
        <p className="text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">Email-to-ticket:</span> point an inbound-mail service (Postmark, SendGrid Inbound Parse,
          Mailgun) at the URL with <span className="font-mono">&amp;token=&lt;token&gt;</span> added. Each email becomes a card (subject as title,
          sender and body in the description). A reply from the same sender is added to that card instead.
        </p>
        {url && row("URL", url)}
        {token ? (
          <>
            {row("Token", token)}
            <p className="-mt-1 text-[11px] text-[var(--chart-3)]">Copy it now — it won&rsquo;t be shown again.</p>
            {url && row("Try it", `curl -X POST '${url}' -H 'Authorization: Bearer ${token}' -H 'Content-Type: application/json' -d '{"title":"Hello from a webhook"}'`)}
          </>
        ) : (
          <p className="text-[11px] text-muted-foreground">{project.inbound ? "Token set." : "No token yet."}</p>
        )}
        {error && <FormError error={error} />}
        <div>
          <button type="button" disabled={busy} onClick={generate} className="rounded-md border px-3 py-1.5 text-xs hover:bg-secondary disabled:opacity-50">
            {busy ? "Generating…" : project.inbound ? "Generate new token" : "Generate token"}
          </button>
        </div>
      </div>
    </section>
  );
}

/** Own password: current one required, so a borrowed tab cannot take the account. */
function ChangePassword() {
  const [state, action] = useActionState(changeMyPassword, null);
  return (
    <form action={action} className="flex flex-col gap-3 rounded-lg border bg-card p-3">
      <Field label="Current password" name="current" type="password" required autoComplete="current-password" />
      <Field label="New password" name="next" type="password" required minLength={8} autoComplete="new-password" />
      <FormError error={state?.error} />
      {state?.ok && <p className="text-xs text-[var(--chart-2)]">Password changed.</p>}
      <SubmitButton>Change password</SubmitButton>
    </form>
  );
}

/** Admin reset. No current password — that is the point of a reset. */
function SetPassword({ userId, name }: { userId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); setDone(false); setError(null); }}
        title={`Set a new password for ${name}`}
        className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <KeyRound className="size-3.5" />
      </button>
    );
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await setMemberPassword(userId, value);
        if (res?.error) return setError(res.error);
        setDone(true);
        setValue("");
        setOpen(false);
      }}
      className="flex shrink-0 items-center gap-1"
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        type="text"
        autoFocus
        minLength={8}
        placeholder="New password"
        aria-label={`New password for ${name}`}
        className="w-32 rounded border bg-background px-1.5 py-1 text-xs outline-none focus:border-ring"
      />
      <button type="submit" className="rounded border px-1.5 py-1 text-xs hover:bg-secondary">Set</button>
      <button type="button" onClick={() => { setOpen(false); setValue(""); }} className="rounded p-1 text-xs text-muted-foreground hover:bg-secondary">
        ✕
      </button>
      {error && <span className="text-[10px] text-[var(--chart-7)]">{error}</span>}
      {done && <span className="text-[10px] text-[var(--chart-2)]">Set</span>}
    </form>
  );
}

const DEFAULT_MODEL: Record<AiProvider, string> = { anthropic: "claude-opus-5-5", openai: "gpt-4o-mini", gemini: "gemini-3.8-flash" };

function AiSettingsForm({ ai }: { ai: AiSettings | null }) {
  const [state, action, pending] = useActionState(saveAiConfig, null);
  const [provider, setProvider] = useState<AiProvider>(ai?.provider ?? "anthropic");
  const [model, setModel] = useState(ai?.model ?? DEFAULT_MODEL.anthropic);
  const [list, setList] = useState<{ provider: AiProvider; models: string[] } | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const sameProvider = ai?.provider === provider;

  /** Asks the provider which models this key can use; a blank key field means the saved key. */
  function loadModels(p: AiProvider) {
    const field = (name: string) => (form.current?.elements.namedItem(name) as HTMLInputElement | null)?.value ?? "";
    startLoading(async () => {
      const res = await fetchAiModels(p, field("baseUrl"), field("apiKey"));
      if ("error" in res) {
        setList(null);
        setListError(res.error ?? null);
        return;
      }
      setListError(null);
      setList({ provider: p, models: res.models });
      setModel((m) => (res.models.includes(m) ? m : res.models.includes(DEFAULT_MODEL[p]) ? DEFAULT_MODEL[p] : res.models[0]));
    });
  }

  const loadSaved = useEffectEvent(() => { if (ai) loadModels(ai.provider); });
  useEffect(() => loadSaved(), []);

  const models = list?.provider === provider ? list.models : null;

  return (
    // onSubmit, not action={}: React resets an action form afterwards, which snaps the
    // controlled selects back to their first option while state disagrees.
    <form
      ref={form}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => action(data));
      }}
      className="flex flex-col gap-3 rounded-lg border bg-card p-3"
    >
      <p className="text-[11px] text-muted-foreground">
        Status: {ai ? <span className="text-[var(--chart-2)]">on — {ai.provider} · {ai.model}</span> : "off"}
      </p>
      <Select
        label="Provider"
        name="provider"
        value={provider}
        onChange={(e) => {
          const p = e.target.value as AiProvider;
          setProvider(p);
          setModel(ai?.provider === p ? ai.model : DEFAULT_MODEL[p]);
          setList(null);
          setListError(null);
          // The key field remounts empty for the new provider, so only the saved key (or none, for local servers) can list now.
          if (ai?.provider === p || p === "openai") loadModels(p);
        }}
      >
        <option value="anthropic">Anthropic (Claude)</option>
        <option value="gemini">Google Gemini</option>
        <option value="openai">OpenAI-compatible (OpenAI, OpenRouter, Groq, Ollama…)</option>
      </Select>
      {provider === "openai" && (
        <Field
          label="Base URL"
          name="baseUrl"
          defaultValue={sameProvider ? ai.baseUrl : ""}
          placeholder="https://api.openai.com/v1"
          hint="Leave blank for OpenAI. Ollama: http://localhost:11434/v1"
          onBlur={() => loadModels(provider)}
        />
      )}
      {provider === "gemini" && (
        <p className="text-[11px] text-muted-foreground">
          Get a key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="underline">aistudio.google.com/apikey</a>. The free tier is rate-limited.
        </p>
      )}
      <Field
        key={`key-${provider}-${ai?.keyHint}`}
        label="API key"
        name="apiKey"
        type="password"
        autoComplete="off"
        placeholder={sameProvider && ai.keyHint ? `Saved (${ai.keyHint}) — leave blank to keep` : ""}
        onBlur={(e) => { if (e.target.value.trim()) loadModels(provider); }}
      />
      {models ? (
        <Select label="Model" name="model" value={model} onChange={(e) => setModel(e.target.value)}>
          {models.map((id) => <option key={id} value={id}>{id}</option>)}
        </Select>
      ) : (
        // Until the provider answers (or if it can't list, like some local servers), type the id.
        <Field label="Model" name="model" required value={model} onChange={(e) => setModel(e.target.value)} />
      )}
      <p className="-mt-2 text-[11px] text-muted-foreground">
        {loading ? "Loading models…"
          : listError ? <span className="text-[var(--chart-7)]">{listError}</span>
          : models ? `${models.length} models available to this key.`
          : "Enter the API key to choose from the models it can use."}
        {!loading && (
          <button type="button" onClick={() => loadModels(provider)} className="ml-1.5 underline">Refresh</button>
        )}
      </p>
      <Select
        key={`reasoning-${provider}`}
        label="Reasoning"
        name="reasoning"
        defaultValue={sameProvider ? ai.reasoning : provider === "gemini" ? "low" : ""}
      >
        {REASONING_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </Select>
      <p className="-mt-2 text-[11px] text-muted-foreground">
        The default for everyone; members can change it per message in the Agent chat. Higher thinks longer before answering.
      </p>
      <FormError error={state?.error} />
      {state?.ok && <p className="text-xs text-[var(--chart-2)]">{state.ok}</p>}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={pending} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
          {pending ? "Saving…" : "Save"}
        </button>
        {ai && (
          <button type="submit" name="disable" value="1" formNoValidate className="rounded-md border px-3 py-2 text-xs text-muted-foreground hover:bg-secondary">
            Turn off
          </button>
        )}
      </div>
    </form>
  );
}
