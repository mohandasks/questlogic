import Link from "next/link";
import { getServerSupabase } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

export default async function Landing() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto max-w-3xl px-6 py-24">
      <p className="chip mb-6">QuestLogic AI · v0</p>
      <h1 className="text-5xl font-bold tracking-tight">
        Level up your learning.
      </h1>
      <p className="mt-4 max-w-xl text-mute">
        Pick a subject. Pick a topic. The tutor generates a quest with a skill
        tree, you fight your way through it, and you earn XP for actually
        knowing things. Currently launching with History, Economics, and
        Philosophy.
      </p>

      <div className="mt-10 flex gap-3">
        {user ? (
          <>
            <Link className="btn btn-primary" href="/dashboard">
              Go to dashboard
            </Link>
            <Link className="btn" href="/curated">
              Browse curated courses
            </Link>
          </>
        ) : (
          <>
            <Link className="btn btn-primary" href="/sign-up">
              Start your first quest
            </Link>
            <Link className="btn" href="/sign-in">
              Sign in
            </Link>
          </>
        )}
      </div>

      <div className="mt-16 grid gap-4 sm:grid-cols-3">
        {[
          { name: "History", color: "#FF6B6B", blurb: "Eras, causation, primary sources." },
          { name: "Economics", color: "#4ECDC4", blurb: "Markets, policy, decision theory." },
          { name: "Philosophy", color: "#9B59B6", blurb: "Logic, ethics, inquiry." },
        ].map((s) => (
          <div key={s.name} className="panel p-5">
            <div
              className="h-2 w-12 rounded-full"
              style={{ background: s.color }}
            />
            <h3 className="mt-3 text-lg font-semibold">{s.name}</h3>
            <p className="mt-1 text-sm text-mute">{s.blurb}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
