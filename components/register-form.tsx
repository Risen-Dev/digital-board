"use client";

import { useActionState, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { registerAction } from "@/lib/actions";
import { TEMPLATES, templateOf } from "@/lib/board";
import { Field, FormError, SubmitButton } from "./form-bits";
import { TemplatePicker } from "./template-picker";

export function RegisterForm() {
  const [state, action] = useActionState(registerAction, null);
  const [templateId, setTemplateId] = useState(TEMPLATES[0].id);
  const template = templateOf(templateId);
  const defaultColumns = template.columns;
  const [picked, setPicked] = useState(defaultColumns.map((c) => c.title));
  const [custom, setCustom] = useState("");
  const [withExamples, setWithExamples] = useState(false);

  const toggle = (title: string) =>
    setPicked((p) => (p.includes(title) ? p.filter((t) => t !== title) : [...p, title]));

  function addCustom() {
    const name = custom.trim();
    if (!name || picked.includes(name)) return setCustom("");
    setPicked((p) => [...p, name]);
    setCustom("");
  }

  const presets = defaultColumns.map((c) => c.title);

  return (
    <form action={action} className="flex flex-col gap-6 rounded-xl border bg-card p-6">
      <section className="flex flex-col gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Workspace</h2>
        <Field label="Workspace name" name="workspace" required placeholder="Tim Produk" />
        <Field label="First project" name="project" required placeholder="Product v1" />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Template</h2>
        <TemplatePicker
          value={templateId}
          withExamples={withExamples}
          onChange={(id) => {
            setTemplateId(id);
            setPicked(templateOf(id).columns.map((c) => c.title));
          }}
        />
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" name="examples" checked={withExamples} onChange={(e) => setWithExamples(e.target.checked)} className="accent-primary" />
          Add example tasks and a canvas sheet
        </label>
        <p className="mt-2 text-xs font-medium">Columns</p>
        <div className="flex flex-wrap gap-2">
          {defaultColumns.map((c) => {
            const on = picked.includes(c.title);
            return (
              <button
                type="button"
                key={c.title}
                onClick={() => toggle(c.title)}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  on ? "border-primary bg-secondary font-medium" : "text-muted-foreground"
                }`}
              >
                <span className="size-2 rounded-full" style={{ background: c.color }} />
                {c.title}
                {on && <Check className="size-3" />}
              </button>
            );
          })}
        </div>
        {picked.filter((t) => !presets.includes(t)).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {picked
              .filter((t) => !presets.includes(t))
              .map((t) => (
                <span key={t} className="flex items-center gap-1.5 rounded-full border border-primary bg-secondary px-3 py-1.5 text-xs font-medium">
                  {t}
                  <button type="button" onClick={() => toggle(t)} className="text-muted-foreground hover:text-foreground">
                    <X className="size-3" />
                  </button>
                </span>
              ))}
          </div>
        )}

        <div className="flex gap-2">
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustom();
              }
            }}
            placeholder="Your own column name"
            className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-ring"
          />
          <button
            type="button"
            onClick={addCustom}
            className="flex items-center gap-1.5 rounded-md border px-3 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Plus className="size-3.5" />
            Add
          </button>
        </div>

        {picked.map((t) => (
          <input key={t} type="hidden" name="columns" value={t} />
        ))}
        <p className="text-[11px] text-muted-foreground">Columns can be added, renamed, recoloured or reordered later from the board.</p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Admin account</h2>
        <Field label="Name" name="name" required placeholder="Your name" autoComplete="name" />
        <Field label="Email" name="email" type="email" required autoComplete="email" />
        <Field
          label="Password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          hint="At least 8 characters."
        />
      </section>

      <FormError error={state?.error} />
      <SubmitButton>Create workspace</SubmitButton>
    </form>
  );
}
