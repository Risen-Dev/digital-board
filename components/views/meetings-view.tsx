"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, ExternalLink, Plus, Repeat, Trash2 } from "lucide-react";
import { deleteMeeting, saveMeeting } from "@/lib/actions";
import { initials, type Member } from "@/lib/board";
import { MEETING_REPEATS, REPEAT_LABEL, meetingState, type Meeting } from "@/lib/meetings";
import { Avatar } from "../avatar";
import { Field, FormError, Select, SubmitButton } from "../form-bits";
import { Modal } from "../modal";

const REMINDERS = [0, 5, 10, 15, 30, 60];

const when = (d: Date) => d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const startsIn = (start: Date, now: Date) => {
  const min = Math.max(0, Math.round((start.getTime() - now.getTime()) / 60_000));
  return min === 0 ? "starting now" : `starts in ${min} min`;
};

/** Workspace meetings: the next occurrence of each, soonest first; ended one-offs last. */
export function MeetingsView({ meetings, members, meId, isAdmin, now }: {
  meetings: Meeting[];
  members: Member[];
  meId: string;
  isAdmin: boolean;
  /** Null until the browser has a clock (the server render has no time zone to show). */
  now: Date | null;
}) {
  const [editing, setEditing] = useState<Meeting | "new" | null>(null);
  const rows = meetings
    .map((m) => ({ m, s: now ? meetingState(m, now) : null }))
    .sort((a, b) => (a.s?.start.getTime() ?? Infinity) - (b.s?.start.getTime() ?? Infinity));

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-3 px-5 py-6">
        <div className="flex items-center gap-3">
          <p className="flex-1 text-xs text-muted-foreground">
            Attendees get a reminder before each meeting, in the bell and as a browser alert (Bell → Enable alerts).
          </p>
          <button onClick={() => setEditing("new")} className="flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
            <Plus className="size-3.5" /> New meeting
          </button>
        </div>

        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-10 text-center text-xs text-muted-foreground">
            No meetings yet. Add a daily standup or a weekly review.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map(({ m, s }) => {
              const people = members.filter((p) => m.attendeeIds.includes(p.id));
              const canEdit = m.createdBy === meId || isAdmin;
              return (
                <li key={m.id} className={`flex items-start gap-3 rounded-lg border bg-card p-3 ${s ? "" : "opacity-60"}`}>
                  <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      {m.title}
                      {s?.state === "live" && <span className="rounded-full bg-[var(--chart-2)] px-1.5 py-px text-[10px] font-semibold text-white">Now</span>}
                      {s?.state === "soon" && now && <span className="rounded-full border border-[var(--chart-3)] px-1.5 py-px text-[10px] text-[var(--chart-3)]">{startsIn(s.start, now)}</span>}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                      <span>{s ? when(s.start) : now ? "Ended" : `${m.startDate} ${m.startTime}`}</span>
                      <span>{m.durationMin} min</span>
                      {m.repeat !== "none" && <span className="flex items-center gap-1"><Repeat className="size-3" />{REPEAT_LABEL[m.repeat]}</span>}
                    </p>
                    {people.length > 0 && (
                      <div className="mt-2 flex -space-x-1.5">
                        {people.map((p) => (
                          <span key={p.id} title={p.name} className="rounded-full ring-2 ring-card">
                            <Avatar initials={initials(p.name)} color={p.color} size={22} />
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {m.link && (
                      <a href={m.link} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] hover:bg-secondary">
                        Join <ExternalLink className="size-3" />
                      </a>
                    )}
                    {canEdit && (
                      <button onClick={() => setEditing(m)} className="rounded-md border px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground">
                        Edit
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {editing && (
        <MeetingDialog meeting={editing === "new" ? null : editing} members={members} meId={meId} onClose={() => setEditing(null)} />
      )}
    </main>
  );
}

function MeetingDialog({ meeting, members, meId, onClose }: { meeting: Meeting | null; members: Member[]; meId: string; onClose: () => void }) {
  const router = useRouter();
  const [state, action] = useActionState(saveMeeting, null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);
  const today = new Date().toLocaleDateString("en-CA");

  async function remove() {
    if (!meeting || !confirm(`Delete "${meeting.title}" and all its future occurrences?`)) return;
    const res = await deleteMeeting(meeting.id);
    if (res.error) return setError(res.error);
    router.refresh();
    onClose();
  }

  return (
    <Modal title={meeting ? "Edit meeting" : "New meeting"} onClose={onClose}>
      <form action={action} className="flex flex-col gap-4">
        {meeting && <input type="hidden" name="id" value={meeting.id} />}
        <Field label="Title" name="title" required autoFocus defaultValue={meeting?.title ?? ""} placeholder="Daily standup" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts on" name="startDate" type="date" required defaultValue={meeting?.startDate ?? today} />
          <Field label="Time" name="startTime" type="time" required defaultValue={meeting?.startTime ?? "09:00"} />
          <Field label="Duration (minutes)" name="durationMin" type="number" min={5} max={720} step={5} required defaultValue={meeting?.durationMin ?? 30} />
          <Select label="Repeat" name="repeat" defaultValue={meeting?.repeat ?? "none"}>
            {MEETING_REPEATS.map((r) => <option key={r} value={r}>{REPEAT_LABEL[r]}</option>)}
          </Select>
          <Select label="Remind attendees" name="remindMin" defaultValue={meeting?.remindMin ?? 15}>
            {REMINDERS.map((n) => <option key={n} value={n}>{n === 0 ? "When it starts" : `${n} min before`}</option>)}
          </Select>
          <Field label="Meeting link" name="link" type="url" defaultValue={meeting?.link ?? ""} placeholder="https://meet.google.com/…" />
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Notes</span>
          <textarea name="notes" rows={3} defaultValue={meeting?.notes ?? ""} placeholder="Agenda, dial-in…" className="rounded-md border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-ring" />
        </label>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-xs font-medium">Attendees</legend>
          <div className="flex flex-wrap gap-1.5">
            {members.map((m) => (
              <label key={m.id} className="flex cursor-pointer items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-xs transition-colors has-[:checked]:border-primary has-[:checked]:bg-secondary">
                <input type="checkbox" name="attendeeIds" value={m.id} defaultChecked={meeting ? meeting.attendeeIds.includes(m.id) : m.id === meId} className="sr-only" />
                <Avatar initials={initials(m.name)} color={m.color} size={20} />
                {m.name}
              </label>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">Times are read in each person&rsquo;s own time zone.</p>
        </fieldset>
        <FormError error={state?.error ?? error} />
        <div className="flex items-center gap-2">
          <SubmitButton>{meeting ? "Save" : "Create meeting"}</SubmitButton>
          {meeting && (
            <button type="button" onClick={() => void remove()} className="ml-auto flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs text-[#ef4444] hover:bg-[rgba(239,68,68,0.08)]">
              <Trash2 className="size-3.5" /> Delete
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
