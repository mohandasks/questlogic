import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ensureAppUser } from "@/lib/user";
import { getAdminSupabase } from "@/utils/supabase/admin";
import { markNodeMastered, findOrCreateNodeSession } from "@/lib/node-actions";
import { ChatWindow } from "@/components/chat-window";
import { SubmitButton } from "@/components/submit-button";
import { ShareChatButton } from "@/components/share-chat-button";
import type { ChatMessage } from "@questlogic/shared";

export const dynamic = "force-dynamic";

const NODE_MASTERY_XP = 100;

async function markMasteredAction(formData: FormData): Promise<never> {
  "use server";
  const { appUserId } = await ensureAppUser();
  const questId = String(formData.get("quest_id") ?? "");
  const nodeId = String(formData.get("node_id") ?? "");
  if (!questId || !nodeId) throw new Error("Missing quest_id or node_id");

  await markNodeMastered({ appUserId, questId, nodeId });

  redirect(`/quests/${questId}`);
}

export default async function NodePage({
  params,
}: {
  params: { questId: string; nodeId: string };
}) {
  const { appUserId } = await ensureAppUser();
  const sb = getAdminSupabase();

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
        <p className="mt-2 text-mute">Finish its prerequisites first.</p>
      </main>
    );
  }

  // Find or create an active session for this (user, quest, node).
  const { sessionId, shareSlug } = await findOrCreateNodeSession({
    appUserId,
    questId: quest.id,
    nodeId: node.id,
    currentStatus: progress?.status,
  });

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

  const isMastered = progress?.status === "mastered";

  return (
    <main className="mx-auto flex h-screen max-w-3xl flex-col px-6 py-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <Link href={`/quests/${quest.id}`} className="text-mute text-sm hover:text-ink">
            ← {quest.title}
          </Link>
          <h1 className="mt-2 text-2xl font-bold">{node.title}</h1>
          <p className="text-mute text-sm">{node.summary}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className="chip">{subject?.name ?? "Quest"}</span>
          <ShareChatButton sessionId={sessionId} initialSlug={shareSlug} />
          {isMastered ? (
            <span className="chip" style={{ borderColor: "#5ce0a8", color: "#5ce0a8" }}>
              Mastered
            </span>
          ) : (
            <form action={markMasteredAction}>
              <input type="hidden" name="quest_id" value={quest.id} />
              <input type="hidden" name="node_id" value={node.id} />
              <SubmitButton
                idleLabel={`Mark mastered (+${NODE_MASTERY_XP} XP)`}
                pendingLabel="Saving…"
                className="btn"
              />
            </form>
          )}
        </div>
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
