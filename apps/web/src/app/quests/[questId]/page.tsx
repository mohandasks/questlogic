import Link from "next/link";
import { notFound } from "next/navigation";
import { ensureAppUser } from "@/lib/user";
import { getAdminSupabase } from "@/utils/supabase/admin";
import { SkillTreeList } from "@/components/skill-tree-list";

export const dynamic = "force-dynamic";

export default async function QuestPage({
  params,
}: {
  params: { questId: string };
}) {
  const { appUserId } = await ensureAppUser();
  const sb = getAdminSupabase();

  const { data: quest } = await sb
    .from("quests")
    .select("id, title, status, template_id, subjects(name, color_hex, slug)")
    .eq("id", params.questId)
    .eq("user_id", appUserId)
    .is("deleted_at", null)
    .single();
  if (!quest) notFound();

  const subject = Array.isArray(quest.subjects)
    ? quest.subjects[0]
    : (quest.subjects as { name?: string; color_hex?: string; slug?: string } | null);

  const { data: nodes } = await sb
    .from("template_nodes")
    .select("id, slug, title, summary, order_hint, estimated_minutes")
    .eq("template_id", quest.template_id)
    .order("order_hint", { ascending: true });

  const { data: edges } = await sb
    .from("template_edges")
    .select("from_node_id, to_node_id")
    .eq("template_id", quest.template_id);

  const { data: progress } = await sb
    .from("node_progress")
    .select("template_node_id, status, last_score, best_score")
    .eq("quest_id", quest.id)
    .eq("user_id", appUserId);

  const progressByNode = new Map(
    (progress ?? []).map((p) => [p.template_node_id, p]),
  );

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Link href="/dashboard" className="text-mute text-sm hover:text-ink">
        ← Back to dashboard
      </Link>
      <header className="mt-4 flex items-center justify-between">
        <div>
          <p className="chip">{subject?.name ?? "Quest"}</p>
          <h1 className="mt-2 text-3xl font-bold">{quest.title}</h1>
        </div>
        <span
          className="h-3 w-3 rounded-full"
          style={{ background: subject?.color_hex ?? "#7c5cff" }}
        />
      </header>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Skill tree</h2>
        <p className="text-mute text-sm">
          Available nodes are unlocked. Mastering a node unlocks anything it
          gates.
        </p>
        <div className="mt-4">
          <SkillTreeList
            questId={quest.id}
            nodes={(nodes ?? []).map((n) => ({
              id: n.id,
              slug: n.slug,
              title: n.title,
              summary: n.summary,
              estimated_minutes: n.estimated_minutes,
              status: progressByNode.get(n.id)?.status ?? "locked",
            }))}
            edges={(edges ?? []).map((e) => ({
              from: e.from_node_id,
              to: e.to_node_id,
            }))}
          />
        </div>
      </section>
    </main>
  );
}
