"use client";

import { useActionState } from "react";
import { loginAction } from "@/lib/actions";
import { Field, FormError, SubmitButton } from "./form-bits";
import { useT } from "@/components/i18n";

export function LoginForm() {
  const tr = useT();
  const [state, action] = useActionState(loginAction, null);
  return (
    <form action={action} className="flex flex-col gap-4 rounded-xl border bg-card p-6">
      <Field label={tr("Email")} name="email" type="email" required autoComplete="email" defaultValue={state?.email} />
      <Field label={tr("Password")} name="password" type="password" required autoComplete="current-password" />
      <FormError error={state?.error} />
      <SubmitButton>{tr("Sign in")}</SubmitButton>
    </form>
  );
}
