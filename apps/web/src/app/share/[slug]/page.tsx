import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSupabase } from "@/utils/supabase/admin";
import { ChatBubble } from "@/components/chat-bubble";
import type { ChatMessage } from "@questlogic/shared";

export const dynamic = "force-dynamic";

/**
 * Public, unauthenticated read-only view of a single session's transcript —
 * i.e. the chat for one sub-topic/node, shared via /api/sessions/[id]/share.
 * Nothing else about the student's quest or account is exposed here.
 */
export default async function SharedSessionPage({
  params,
}: {
  params: { slug: string };
}) {
  const sb = getAdminSupabase();

  const { data: session } = await sb
    .from("sessions")
    .select("id, deleted_at, current_node_id, quests(title)")
    .eq("share_slug", params.slug)
    .maybeSingle();

  if (!session || session.deleted_at) notFound();

  const quest = Array.isArray(session.quests)
    ? session.quests[0]
    : (session.quests as { title?: string } | null);

  let node: { title: string; summary: string } | null = null;
  if (session.current_node_id) {
    const { data } = await sb
      .from("template_nodes")
      .select("title, summary")
      .eq("id", session.current_node_id)
      .maybeSingle();
    node = data;
  }

  const { data: messages } = await sb
    .from("messages")
    .select("role, content, created_at")
    .eq("session_id", session.id)
    .is("deleted_at", null)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: true });

  const history: ChatMessage[] = (messages ?? []).map((m) => ({
    role: m.role as ChatMessage["role"],
    content: m.content,
  }));

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-6">
      <header>
        <span className="chip">Shared conversation · read only</span>
        <h1 className="mt-3 text-2xl font-bold">
          {node?.title ?? "Tutoring session"}
        </h1>
        {node?.summary && <p className="text-mute text-sm">{node.summary}</p>}
        {quest?.title && (
          <p className="text-mute mt-1 text-xs">From the quest “{quest.title}”</p>
        )}
      </header>

      <div className="panel mt-6 flex-1 overflow-y-auto p-5">
        {history.length === 0 ? (
          <p className="text-mute">This conversation has no messages yet.</p>
        ) : (
          <div className="grid gap-4">
            {history.map((m, i) => (
              <ChatBubble key={i} msg={m} />
            ))}
          </div>
        )}
      </div>

      <footer className="panel mt-6 flex flex-col items-center gap-3 p-5 text-center">
        <p className="text-sm font-semibold">Want an AI tutor of your own?</p>
        <p className="text-mute text-sm">
          QuestLogic builds a personalized skill tree and tutors you through it,
          one topic at a time — like the conversation above.
        </p>
        <div className="flex items-center gap-3">
          <Link href="/sign-up" className="btn btn-primary">
            Sign up free
          </Link>
          <Link href="/sign-in" className="text-accent text-sm hover:underline">
            Log in
          </Link>
        </div>
      </footer>
    </main>
  );
}
