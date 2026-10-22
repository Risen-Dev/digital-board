"use client";

import { useActionState } from "react";
import { requestPasswordReset, resetPassword } from "@/lib/actions";
import { Field, FormError, SubmitButton } from "./form-bits";

export function ForgotForm() {
  const [state, action] = useActionState(requestPasswordReset, null);
  if (state?.ok) {
    return (
      <p className="rounded-xl border bg-card p-6 text-sm">
        If that email has an account, a reset link is on its way. It works for one hour.
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4 rounded-xl border bg-card p-6">
      <Field label="Email" name="email" type="email" required autoComplete="email" />
      <FormError error={state?.error} />
      <SubmitButton>Send reset link</SubmitButton>
    </form>
  );
}

export function ResetForm({ token }: { token: string }) {
  const [state, action] = useActionState(resetPassword, null);
  return (
    <form action={action} className="flex flex-col gap-4 rounded-xl border bg-card p-6">
      <input type="hidden" name="token" value={token} />
      <Field label="New password" name="next" type="password" required minLength={8} autoComplete="new-password" hint="At least 8 characters." />
      <FormError error={state?.error} />
      <SubmitButton>Set password</SubmitButton>
    </form>
  );
}
