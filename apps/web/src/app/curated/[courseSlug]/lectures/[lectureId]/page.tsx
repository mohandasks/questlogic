import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ensureAppUser } from "@/lib/user";
import { getAdminSupabase } from "@/utils/supabase/admin";
import {
  markNodeMastered,
  markAssignmentReviewed,
  findOrCreateNodeSession,
} from "@/lib/node-actions";
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
  const courseSlug = String(formData.get("course_slug") ?? "");
  if (!questId || !nodeId || !courseSlug) {
    throw new Error("Missing quest_id, node_id, or course_slug");
  }

  await markNodeMastered({ appUserId, questId, nodeId });

  redirect(`/curated/${courseSlug}`);
}

async function markAssignmentAction(formData: FormData): Promise<void> {
  "use server";
  const { appUserId } = await ensureAppUser();
  const assignmentId = String(formData.get("assignment_id") ?? "");
  if (!assignmentId) throw new Error("Missing assignment_id");
  await markAssignmentReviewed({ appUserId, assignmentId });
}

export default async function CuratedLecturePage({
  params,
}: {
  params: { courseSlug: string; lectureId: string };
}) {
  const { appUserId } = await ensureAppUser();
  const sb = getAdminSupabase();

  const { data: template } = await sb
    .from("curriculum_templates")
    .select("id, topic, pedagogy_style")
    .eq("slug", params.courseSlug)
    .eq("source_type", "curated")
    .eq("status", "active")
    .single();
  if (!template) notFound();

  const { data: node } = await sb
    .from("template_nodes")
    .select("id, slug, title, summary")
    .eq("id", params.lectureId)
    .eq("template_id", template.id)
    .single();
  if (!node) notFound();

  const { data: quest } = await sb
    .from("quests")
    .select("id")
    .eq("user_id", appUserId)
    .eq("template_id", template.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!quest) redirect(`/curated/${params.courseSlug}`);

  const { data: progress } = await sb
    .from("node_progress")
    .select("status")
    .eq("quest_id", quest.id)
    .eq("template_node_id", node.id)
    .single();

  if (progress && progress.status === "locked") {
    return (
      <main className="mx-auto max-w-2xl px-6 py-10">
        <Link href={`/curated/${params.courseSlug}`} className="text-mute text-sm hover:text-ink">
          ← Back to course
        </Link>
        <h1 className="mt-4 text-2xl font-bold">This lecture is locked.</h1>
        <p className="mt-2 text-mute">Finish the previous lecture first.</p>
      </main>
    );
  }

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

  const { data: source } = await sb
    .from("curated_lecture_sources")
    .select("raw_text")
    .eq("template_node_id", node.id)
    .maybeSingle();

  const { data: assignment } = await sb
    .from("curated_assignments")
    .select("id, title, instructions")
    .eq("template_node_id", node.id)
    .limit(1)
    .maybeSingle();

  let assignmentReviewed = false;
  if (assignment) {
    const { data: completion } = await sb
      .from("curated_assignment_completions")
      .select("id")
      .eq("assignment_id", assignment.id)
      .eq("user_id", appUserId)
      .maybeSingle();
    assignmentReviewed = Boolean(completion);
  }

  const isMastered = progress?.status === "mastered";

  return (
    <main className="mx-auto flex h-screen max-w-3xl flex-col px-6 py-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <Link href={`/curated/${params.courseSlug}`} className="text-mute text-sm hover:text-ink">
            ← {template.topic}
          </Link>
          <h1 className="mt-2 text-2xl font-bold">{node.title}</h1>
          <p className="text-mute text-sm">{node.summary}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className="chip">Curated</span>
          <ShareChatButton sessionId={sessionId} initialSlug={shareSlug} />
          {isMastered ? (
            <span className="chip" style={{ borderColor: "#5ce0a8", color: "#5ce0a8" }}>
              Mastered
            </span>
          ) : (
            <form action={markMasteredAction}>
              <input type="hidden" name="quest_id" value={quest.id} />
              <input type="hidden" name="node_id" value={node.id} />
              <input type="hidden" name="course_slug" value={params.courseSlug} />
              <SubmitButton
                idleLabel={`Mark mastered (+${NODE_MASTERY_XP} XP)`}
                pendingLabel="Saving…"
                className="btn"
              />
            </form>
          )}
        </div>
      </header>

      {(source?.raw_text || assignment) && (
        <div className="mt-4 grid gap-3">
          {source?.raw_text && (
            <details className="panel p-4">
              <summary className="cursor-pointer text-sm font-semibold">
                Lecture material
              </summary>
              <div className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap text-sm text-mute">
                {source.raw_text}
              </div>
            </details>
          )}
          {assignment && (
            <details className="panel p-4">
              <summary className="cursor-pointer text-sm font-semibold">
                Assignment: {assignment.title}
              </summary>
              <div className="mt-3 whitespace-pre-wrap text-sm text-mute">
                {assignment.instructions}
              </div>
              <div className="mt-3">
                {assignmentReviewed ? (
                  <span className="chip" style={{ borderColor: "#5ce0a8", color: "#5ce0a8" }}>
                    Reviewed
                  </span>
                ) : (
                  <form action={markAssignmentAction}>
                    <input type="hidden" name="assignment_id" value={assignment.id} />
                    <SubmitButton idleLabel="Mark assignment reviewed" pendingLabel="Saving…" className="btn" />
                  </form>
                )}
              </div>
            </details>
          )}
        </div>
      )}

      <ChatWindow
        sessionId={sessionId}
        questId={quest.id}
        nodeId={node.id}
        nodeTitle={node.title}
        nodeSummary={node.summary}
        subjectSlug="curated"
        initialHistory={history}
      />
    </main>
  );
}
