import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { LogoMark } from "@/components/logo-mark";
import { RegisterForm } from "@/components/register-form";

export const metadata = { title: "Create a workspace — Digital Board" };

export default async function RegisterPage() {
  if (await currentUser()) redirect("/board");
  if (process.env.REGISTRATION_CLOSED === "1") redirect("/login");

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex items-center gap-3">
          <LogoMark />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Create a workspace</h1>
            <p className="text-sm text-muted-foreground">Your own board, projects and chat. You become its admin.</p>
          </div>
        </div>
        <RegisterForm />
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-foreground underline underline-offset-2">Sign in</Link>
        </p>
      </div>
    </main>
  );
}
