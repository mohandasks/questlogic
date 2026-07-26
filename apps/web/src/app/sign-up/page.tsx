import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getServerSupabase } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

async function signUpAction(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const displayName = String(formData.get("display_name") ?? "").trim();

  if (password.length < 8) {
    redirect(`/sign-up?error=${encodeURIComponent("Password must be at least 8 characters.")}`);
  }

  // Build the confirmation-link target explicitly rather than relying on the
  // Supabase dashboard's "Site URL" setting, which is easy to leave pointed
  // at the wrong environment (e.g. localhost) and silently breaks the link
  // in the confirmation email.
  const headersList = await headers();
  const host = headersList.get("host");
  const protocol = host?.startsWith("localhost") || host?.startsWith("127.0.0.1") ? "http" : "https";
  const origin = `${protocol}://${host}`;

  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName || null },
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });
  if (error) {
    redirect(`/sign-up?error=${encodeURIComponent(error.message)}`);
  }

  // Depending on the project's email-confirmation setting in Supabase:
  // - If confirmations are OFF, the user is already signed in; send them to /dashboard.
  // - If confirmations are ON, they need to verify by email first.
  redirect("/sign-up/check-email");
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <form
        action={signUpAction}
        className="panel grid w-full max-w-sm gap-4 p-6"
      >
        <h1 className="text-2xl font-bold">Start your first quest</h1>

        {searchParams.error ? (
          <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            {searchParams.error}
          </div>
        ) : null}

        <div>
          <label className="text-sm text-mute">Display name (optional)</label>
          <input
            type="text"
            name="display_name"
            autoComplete="nickname"
            className="mt-1 w-full rounded-lg border border-border bg-panel p-3"
          />
        </div>
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
          <label className="text-sm text-mute">Password (8+ characters)</label>
          <input
            type="password"
            name="password"
            required
            autoComplete="new-password"
            minLength={8}
            className="mt-1 w-full rounded-lg border border-border bg-panel p-3"
          />
        </div>

        <button type="submit" className="btn btn-primary">
          Create account
        </button>

        <p className="text-sm text-mute">
          Already have an account?{" "}
          <Link href="/sign-in" className="text-accent hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </main>
  );
}
