import Link from "next/link";
import { notFound } from "next/navigation";
import { mailEnabled } from "@/lib/mail";
import { LogoMark } from "@/components/logo-mark";
import { ForgotForm } from "@/components/reset-forms";
import { getTr } from "@/lib/i18n/server";

export const metadata = { title: "Forgot password — Digital Board" };

export default async function ForgotPage() {
  const tr = await getTr();
  if (!mailEnabled()) notFound();

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <LogoMark />
          <h1 className="text-lg font-semibold tracking-tight">{tr("Forgot password")}</h1>
        </div>
        <ForgotForm />
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link href="/login" className="font-medium text-foreground underline underline-offset-2">{tr("Back to sign in")}</Link>
        </p>
      </div>
    </main>
  );
}
