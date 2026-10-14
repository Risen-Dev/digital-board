"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addProject } from "@/lib/actions";
import { TEMPLATES } from "@/lib/board";
import { FormError } from "./form-bits";
import { Modal } from "./modal";
import { TemplatePicker } from "./template-picker";

export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState(TEMPLATES[0].id);
  const [withExamples, setWithExamples] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    const res = await addProject(name, templateId, withExamples);
    setBusy(false);
    if (res?.error) return setError(res.error);
    onClose();
    router.push(`/board?project=${res.id}`);
    router.refresh();
  }

  return (
    <Modal title="New project" onClose={onClose}>
      <form onSubmit={create} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            placeholder="Product v1"
            className="rounded-md border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-ring"
          />
        </label>
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium">Template</span>
          <TemplatePicker value={templateId} onChange={setTemplateId} withExamples={withExamples} />
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={withExamples} onChange={(e) => setWithExamples(e.target.checked)} className="accent-primary" />
          Add example tasks and a canvas sheet
        </label>
        <FormError error={error} />
        <button
          disabled={busy || !name.trim()}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40"
        >
          {busy ? "Creating…" : "Create project"}
        </button>
      </form>
    </Modal>
  );
}
