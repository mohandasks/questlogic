import Link from "next/link";
import { notFound } from "next/navigation";
import { ensureAppUser } from "@/lib/user";
import { getAdminSupabase } from "@/utils/supabase/admin";
import { ChatWindow } from "@/components/chat-window";
import type { ChatMessage } from "@questlogic/shared";

export const dynamic = "force-dynamic";

export default async function NodePage({
  params,
}: {
  params: { questId: string; nodeId: string };
}) {
  const { appUserId } = await ensureAppUser();
  const sb = getAdminSupabase();

  // Load quest, node, and subject context.
  const { data: quest } = await sb
    .from("quests")
    .select("id, title, template_id, subject_id, subjects(slug, name)")
    .eq("id", params.questId)
    .eq("user_id", appUserId)
    .is("deleted_at", null)
    .single();
  if (!quest) notFound();

  const { data: node } = await sb
    .from("template_nodes")
    .select("id, slug, title, summary")
    .eq("id", params.nodeId)
    .eq("template_id", quest.template_id)
    .single();
  if (!node) notFound();

  const { data: progress } = await sb
    .from("node_progress")
    .select("status")
    .eq("quest_id", quest.id)
    .eq("template_node_id", node.id)
    .single();

  if (progress && progress.status === "locked") {
    return (
      <main className="mx-auto max-w-2xl px-6 py-10">
        <Link href={`/quests/${quest.id}`} className="text-mute text-sm hover:text-ink">
          ← Back to quest
        </Link>
        <h1 className="mt-4 text-2xl font-bold">This node is locked.</h1>
        <p className="mt-2 text-mute">
          Finish its prerequisites first.
        </p>
      </main>
    );
  }

  // Find or create an active session for this (user, quest, node).
  let sessionId: string;
  const { data: existing } = await sb
    .from("sessions")
    .select("id")
    .eq("user_id", appUserId)
    .eq("quest_id", quest.id)
    .eq("current_node_id", node.id)
    .is("ended_at", null)
    .is("deleted_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    sessionId = existing.id;
  } else {
    const { data: created, error: cErr } = await sb
      .from("sessions")
      .insert({
        user_id: appUserId,
        quest_id: quest.id,
        current_node_id: node.id,
      })
      .select("id")
      .single();
    if (cErr || !created) throw new Error(`Session create: ${cErr?.message}`);
    sessionId = created.id;

    // Flip node_progress to in_progress on first entry.
    if (progress?.status === "available") {
      await sb
        .from("node_progress")
        .update({ status: "in_progress", started_at: new Date().toISOString() })
        .eq("quest_id", quest.id)
        .eq("template_node_id", node.id);
    }
  }

  // Load prior messages for this session.
  const { data: messages } = await sb
    .from("messages")
    .select("role, content, created_at")
    .eq("session_id", sessionId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  const history: ChatMessage[] = (messages ?? []).map((m) => ({
    role: m.role as ChatMessage["role"],
    content: m.content,
  }));

  const subject = Array.isArray(quest.subjects)
    ? quest.subjects[0]
    : (quest.subjects as { slug?: string; name?: string } | null);

  return (
    <main className="mx-auto flex h-screen max-w-3xl flex-col px-6 py-6">
      <header className="flex items-center justify-between">
        <div>
          <Link href={`/quests/${quest.id}`} className="text-mute text-sm hover:text-ink">
            ← {quest.title}
          </Link>
          <h1 className="mt-2 text-2xl font-bold">{node.title}</h1>
          <p className="text-mute text-sm">{node.summary}</p>
        </div>
        <span className="chip">{subject?.name ?? "Quest"}</span>
      </header>

      <ChatWindow
        sessionId={sessionId}
        questId={quest.id}
        nodeId={node.id}
        nodeTitle={node.title}
        nodeSummary={node.summary}
        subjectSlug={(subject?.slug ?? "history") as "history" | "economics" | "philosophy"}
        initialHistory={history}
      />
    </main>
  );
}
