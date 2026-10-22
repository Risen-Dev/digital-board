import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { mailEnabled } from "@/lib/mail";
import { LogoMark } from "@/components/logo-mark";
import { LoginForm } from "@/components/login-form";

export const metadata = { title: "Sign in — Digital Board" };

export default async function LoginPage() {
  if (await currentUser()) redirect("/board");

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <LogoMark />
          <h1 className="text-lg font-semibold tracking-tight">Sign in</h1>
        </div>
        <LoginForm />
        {process.env.REGISTRATION_CLOSED !== "1" && (
          <p className="mt-6 text-center text-sm text-muted-foreground">
            No account?{" "}
            <Link href="/register" className="font-medium text-foreground underline underline-offset-2">
              Create a workspace
            </Link>
          </p>
        )}
        <p className="mt-2 text-center text-xs text-muted-foreground">
          {mailEnabled() ? (
            <Link href="/forgot" className="underline underline-offset-2">Forgotten your password?</Link>
          ) : (
            "Forgotten your password? A workspace admin can set a new one from Settings."
          )}
        </p>
      </div>
    </main>
  );
}
