import Link from "next/link";
import { LogoMark } from "@/components/logo-mark";
import { ResetForm } from "@/components/reset-forms";
import { getTr } from "@/lib/i18n/server";

export const metadata = { title: "Choose a new password — Digital Board" };

export default async function ResetPage({ searchParams }: PageProps<"/reset">) {
  const tr = await getTr();
  const { token } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <LogoMark />
          <h1 className="text-lg font-semibold tracking-tight">{tr("Choose a new password")}</h1>
        </div>
        {typeof token === "string" && token ? (
          <ResetForm token={token} />
        ) : (
          <p className="rounded-xl border bg-card p-6 text-sm">{tr("This link is missing its token.")}</p>
        )}
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link href="/forgot" className="font-medium text-foreground underline underline-offset-2">{tr("Ask for a new link")}</Link>
        </p>
      </div>
    </main>
  );
}
