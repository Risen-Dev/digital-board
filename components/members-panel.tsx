"use client";

import { startTransition, useActionState, useEffect, useEffectEvent, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus, KeyRound, Plus, Trash2 } from "lucide-react";
import { addProject, changeMyPassword, fetchAiModels, saveAiConfig, deleteProject, inviteMember, renameProject, renameWorkspace, setMemberPassword, setProjectMember } from "@/lib/actions";
import { initials } from "@/lib/board";
import type { MemberPresence, Project, ProjectMember } from "@/lib/queries";
import { Avatar } from "./avatar";
import { PresenceDot } from "./views/chat-view";
import { Field, FormError, Select, SubmitButton } from "./form-bits";
import type { AiProvider, AiSettings } from "@/lib/ai";
import { EditableTitle } from "./editable-title";

const ago = (iso: string | null) => {
  if (!iso) return "never signed in";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.floor(hrs / 24)}d ago`;
};

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
  const router = useRouter();
  const [state, action] = useActionState(inviteMember, null);
  const [newProject, setNewProject] = useState("");
  const [projectError, setProjectError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const online = presence.filter((m) => m.presence === "online").length;

  async function createProject() {
    const name = newProject.trim();
    if (!name || busy) return;
    setBusy(true);
    const res = await addProject(name);
    setBusy(false);
    if (res?.error) return setProjectError(res.error);
    setNewProject("");
    setProjectError(null);
    router.push(`/board?project=${res.id}`);
    router.refresh();
  }

  async function removeProject(p: Project) {
    if (!confirm(`Delete "${p.name}"? Its columns, tasks, history and canvas sheets are deleted with it.`)) return;
    const res = await deleteProject(p.id);
    if (res?.error) return setProjectError(res.error);
    setProjectError(null);
    router.push("/board");
    router.refresh();
  }

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-lg flex-col gap-8 px-5 py-6">
        <section>
          <h2 className="text-sm font-semibold">Workspace</h2>
          <p className="mb-3 text-xs text-muted-foreground">Click the name to rename this workspace.</p>
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
        </section>

        {isAdmin && (
          <section>
            <h2 className="text-sm font-semibold">AI agent</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Powers the Agent chat on the canvas. Only admins can see this; the API key is never shown again after saving.
            </p>
            <AiSettingsForm ai={ai} />
          </section>
        )}

        <section>
          <h2 className="text-sm font-semibold">Your password</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Changing it signs out your other devices. There is no email reset — an admin can set a new one for you.
          </p>
          <ChangePassword />
        </section>

        {/* Members */}
        <section>
          <h2 className="text-sm font-semibold">Members</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            {presence.length} in this workspace · {online} online now
          </p>
          <ul className="flex flex-col gap-1">
            {presence.map((m) => (
              <li key={m.id} className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2">
                <span className="relative shrink-0">
                  <Avatar initials={initials(m.name)} color={m.color} size={28} />
                  <PresenceDot presence={m.presence} className="absolute -bottom-0.5 -right-0.5 ring-2 ring-card" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    {m.name}
                    {m.is_admin === 1 && (
                      <span className="ml-1.5 rounded-full border bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        admin
                      </span>
                    )}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">{m.email}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[11px] capitalize">{m.presence}</p>
                  <p className="text-[10px] text-muted-foreground">{ago(m.lastSeen)}</p>
                </div>
                {isAdmin && <SetPassword userId={m.id} name={m.name} />}
              </li>
            ))}
          </ul>
        </section>

        {isAdmin && (
          <section>
            <h2 className="text-sm font-semibold">Project permissions</h2>
            <p className="mb-3 text-xs text-muted-foreground">Assign each member to a project and choose their access level.</p>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-secondary/50 text-muted-foreground">
                  <tr><th className="px-3 py-2 font-medium">Member</th>{projects.map((project) => <th key={project.id} className="px-3 py-2 font-medium">{project.name}</th>)}</tr>
                </thead>
                <tbody>
                  {presence.map((member) => (
                    <tr key={member.id} className="border-b last:border-0">
                      <td className="whitespace-nowrap px-3 py-2 font-medium">{member.name}</td>
                      {projects.map((project) => (
                        <td key={project.id} className="px-3 py-2">
                          <select aria-label={`${member.name} ${project.name} access`} value={assignments.find((item) => item.user_id === member.id && item.project_id === project.id)?.role ?? ""} onChange={(event) => void setProjectMember(project.id, member.id, event.target.value as "admin" | "editor" | "viewer" | "").then(() => router.refresh())} className="rounded border bg-background px-1.5 py-1 text-xs">
                            <option value="">No access</option>
                            <option value="viewer">View</option>
                            <option value="editor">Edit</option>
                            <option value="admin">Admin</option>
                          </select>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Projects */}
        <section>
          <h2 className="text-sm font-semibold">Projects</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            New projects start with the default columns. {isAdmin ? "" : "Only admins can delete one."}
          </p>
          <ul className="mb-3 flex flex-col gap-1">
            {projects.map((p) => (
              <li key={p.id} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: p.id === activeProjectId ? "var(--chart-1)" : "var(--muted-foreground)" }}
                />
                {isAdmin || assignments.some((item) => item.user_id === memberId && item.project_id === p.id && item.role === "admin") ? (
                  <EditableTitle
                    value={p.name}
                    onSave={(name) => renameProject(p.id, name).then((res) => { router.refresh(); return res; })}
                    className="min-w-0 flex-1 text-sm"
                    inputClassName="min-w-0 flex-1 text-sm"
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                )}
                {isAdmin && (
                  <button
                    onClick={() => void removeProject(p)}
                    title="Delete project"
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-[rgba(239,68,68,0.08)] hover:text-[var(--chart-7)]"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>

          {isAdmin && (
            <div className="flex gap-2">
              <input
                value={newProject}
                onChange={(e) => setNewProject(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void createProject();
                  }
                }}
                placeholder="New project name"
                className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-ring"
              />
              <button
                onClick={() => void createProject()}
                disabled={busy || !newProject.trim()}
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-40"
              >
                <FolderPlus className="size-3.5" />
                {busy ? "Adding…" : "Add"}
              </button>
            </div>
          )}
          {projectError && <p className="mt-2 text-xs text-[var(--chart-7)]">{projectError}</p>}
        </section>

        {/* Invite */}
        {isAdmin && (
          <section>
            <h2 className="text-sm font-semibold">Add member</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Create the account, then share the email and password with them.
            </p>
            <form action={action} className="flex flex-col gap-4 rounded-xl border bg-card p-5">
              <Field label="Name" name="name" required />
              <Field label="Email" name="email" type="email" required />
              <Field label="Temporary password" name="password" type="password" required minLength={8} />
              <FormError error={state?.error} />
              {state?.ok && <p className="text-xs text-[var(--chart-2)]">Member added.</p>}
              <SubmitButton>
                <span className="flex items-center gap-1.5">
                  <Plus className="size-3.5" /> Add member
                </span>
              </SubmitButton>
            </form>
          </section>
        )}
      </div>
    </main>
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
