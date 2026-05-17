import { redirect } from "next/navigation";
import { getServerSupabase } from "@/utils/supabase/server";
import { getAdminSupabase } from "@/utils/supabase/admin";

/**
 * Resolve the current Supabase Auth user, mirror them into `app.users` if not
 * already there, and ensure their student_profiles + monthly token_budget rows
 * exist. Returns the internal app user id.
 *
 * Redirects to /sign-in if no session.
 */
export async function ensureAppUser(): Promise<{
  appUserId: string;
  email: string;
}> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const email = user.email;
  if (!email) {
    throw new Error("Authenticated user has no email address");
  }
  const displayName =
    (user.user_metadata?.display_name as string | undefined) ?? null;

  const admin = getAdminSupabase();

  const { data: upserted, error: upErr } = await admin
    .schema("app")
    .from("users")
    .upsert(
      {
        auth_user_id: user.id,
        email,
        display_name: displayName,
      },
      { onConflict: "auth_user_id" },
    )
    .select("id")
    .single();

  if (upErr || !upserted) {
    throw new Error(`Failed to upsert app user: ${upErr?.message}`);
  }

  await admin
    .from("student_profiles")
    .upsert({ user_id: upserted.id }, { onConflict: "user_id" });

  const periodStart = firstOfMonth(new Date());
  const freeLimit = Number(process.env.FREE_TIER_TOKENS_PER_MONTH ?? 100_000);
  await admin.from("user_token_budgets").upsert(
    {
      user_id: upserted.id,
      period_start: periodStart,
      tokens_limit: freeLimit,
    },
    { onConflict: "user_id,period_start", ignoreDuplicates: true },
  );

  return { appUserId: upserted.id, email };
}

function firstOfMonth(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}
