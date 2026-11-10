"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { lanesOf, type Group } from "@/lib/board";
import { BoardView } from "./board-view";
import { useT } from "@/components/i18n";

/** The board split into swimlanes, one BoardView per lane; the page scrolls both ways so lanes line up. */
export function Swimlanes({ group, ...board }: React.ComponentProps<typeof BoardView> & { group: Group }) {
  const tr = useT();
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const lanes = lanesOf(board.columns, group);
  const none = group === "assignee" ? tr("Unassigned") : tr("No label");
  const toggle = (key: string) => setClosed((s) => {
    const next = new Set(s);
    if (!next.delete(key)) next.add(key);
    return next;
  });

  return (
    <main className="flex-1 overflow-auto pt-3">
      {lanes.length === 0 && <p className="p-5 text-sm text-muted-foreground">{tr("No cards to group.")}</p>}
      {lanes.map((lane) => {
        const count = lane.columns.reduce((n, c) => n + c.tasks.length, 0);
        const open = !closed.has(lane.key);
        return (
          <section key={lane.key} className="border-b last:border-b-0">
            <button
              onClick={() => toggle(lane.key)}
              aria-expanded={open}
              className="sticky left-0 flex items-center gap-2 px-5 py-2 text-sm font-semibold"
            >
              <ChevronDown className={`size-3.5 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`} />
              {lane.key ? (group === "priority" ? tr(lane.name) : lane.name) : none}
              <span className="rounded-full border bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{count}</span>
            </button>
            {open && <BoardView {...board} columns={lane.columns} lane={{ key: lane.key || "none", all: board.columns }} />}
          </section>
        );
      })}
    </main>
  );
}
