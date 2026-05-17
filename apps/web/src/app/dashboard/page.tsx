import Link from "next/link";
import { ensureAppUser } from "@/lib/user";
import { getAdminSupabase } from "@/utils/supabase/admin";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { appUserId, email } = await ensureAppUser();
  const sb = getAdminSupabase();

  const { data: quests } = await sb
    .from("quests")
    .select("id, title, status, last_active_at, subject_id, subjects(name, color_hex)")
    .eq("user_id", appUserId)
    .is("deleted_at", null)
    .order("last_active_at", { ascending: false })
    .limit(20);

  const { data: profile } = await sb
    .from("student_profiles")
    .select("total_xp, current_level, current_streak")
    .eq("user_id", appUserId)
    .single();

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <p className="chip">Dashboard</p>
          <h1 className="mt-2 text-3xl font-bold">Welcome back.</h1>
        </div>
        <form action="/auth/sign-out" method="post" className="flex items-center gap-3">
          <span className="text-sm text-mute">{email}</span>
          <button type="submit" className="btn">
            Sign out
          </button>
        </form>
      </header>

      <section className="mt-8 grid grid-cols-3 gap-4">
        <Stat label="XP" value={profile?.total_xp ?? 0} />
        <Stat label="Level" value={profile?.current_level ?? 1} />
        <Stat label="Streak" value={`${profile?.current_streak ?? 0} d`} />
      </section>

      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Your quests</h2>
          <Link href="/quests/new" className="btn btn-primary">
            Start a new quest
          </Link>
        </div>

        <div className="mt-4 grid gap-3">
          {(!quests || quests.length === 0) && (
            <div className="panel p-6 text-mute">
              No quests yet. Start one to generate your first skill tree.
            </div>
          )}
          {quests?.map((q) => {
            const subject = Array.isArray(q.subjects) ? q.subjects[0] : (q.subjects as { name?: string; color_hex?: string } | null);
            return (
              <Link
                key={q.id}
                href={`/quests/${q.id}`}
                className="panel flex items-center justify-between p-4 hover:border-accent"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: subject?.color_hex ?? "#7c5cff" }}
                  />
                  <div>
                    <div className="font-semibold">{q.title}</div>
                    <div className="text-xs text-mute">
                      {subject?.name ?? "Subject"} · {q.status}
                    </div>
                  </div>
                </div>
                <span className="text-mute text-sm">Continue →</span>
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="panel p-5">
      <div className="text-xs uppercase tracking-wider text-mute">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}
