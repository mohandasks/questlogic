import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

async function signInAction(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/dashboard");

  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirect(`/sign-in?error=${encodeURIComponent(error.message)}&next=${encodeURIComponent(next)}`);
  }
  redirect(next);
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: { error?: string; next?: string };
}) {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <form
        action={signInAction}
        className="panel grid w-full max-w-sm gap-4 p-6"
      >
        <h1 className="text-2xl font-bold">Sign in</h1>
        <p className="text-sm text-mute">Welcome back, level up.</p>

        {searchParams.error ? (
          <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            {searchParams.error}
          </div>
        ) : null}

        <input type="hidden" name="next" value={searchParams.next ?? "/dashboard"} />

        <div>
          <label className="text-sm text-mute">Email</label>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            className="mt-1 w-full rounded-lg border border-border bg-panel p-3"
          />
        </div>
        <div>
          <label className="text-sm text-mute">Password</label>
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            className="mt-1 w-full rounded-lg border border-border bg-panel p-3"
          />
        </div>

        <button type="submit" className="btn btn-primary">
          Sign in
        </button>

        <p className="text-sm text-mute">
          No account?{" "}
          <Link href="/sign-up" className="text-accent hover:underline">
            Sign up
          </Link>
        </p>
      </form>
    </main>
  );
}
