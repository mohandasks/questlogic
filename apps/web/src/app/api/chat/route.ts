import { NextResponse } from "next/server";
import { ensureAppUser } from "@/lib/user";
import { getAdminSupabase } from "@/utils/supabase/admin";
import { streamTutorChat } from "@/lib/ai-client";
import type { ChatMessage, SubjectSlug } from "@questlogic/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  session_id: string;
  quest_id: string;
  node_id: string;
  node_title: string;
  node_summary: string;
  subject_slug: SubjectSlug;
  new_message: string;
}

export async function POST(req: Request) {
  const { appUserId } = await ensureAppUser();
  const body = (await req.json()) as Body;

  if (!body.new_message || body.new_message.length > 4000) {
    return NextResponse.json(
      { error: "Message empty or too long" },
      { status: 400 },
    );
  }

  const sb = getAdminSupabase();

  // Token budget gate (rough — uses tokens_used from the budget row).
  const periodStart = firstOfMonth(new Date());
  const { data: budget } = await sb
    .from("user_token_budgets")
    .select("tokens_used, tokens_limit")
    .eq("user_id", appUserId)
    .eq("period_start", periodStart)
    .single();

  if (budget && budget.tokens_used >= budget.tokens_limit) {
    return NextResponse.json(
      {
        error:
          "Monthly token limit reached. Upgrade to Pro for unlimited tutoring.",
      },
      { status: 402 },
    );
  }

  // Confirm the session belongs to this user.
  const { data: session } = await sb
    .from("sessions")
    .select("id, user_id, quest_id, current_node_id")
    .eq("id", body.session_id)
    .single();
  if (!session || session.user_id !== appUserId) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Load prior message history.
  const { data: prior } = await sb
    .from("messages")
    .select("role, content")
    .eq("session_id", session.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(20);

  const history: ChatMessage[] = (prior ?? []).map((m) => ({
    role: m.role as ChatMessage["role"],
    content: m.content,
  }));

  // Persist the user message before calling the model. If the model fails, the
  // user message still exists so the next turn picks up cleanly.
  await sb.from("messages").insert({
    session_id: session.id,
    user_id: appUserId,
    role: "user",
    content: body.new_message,
  });

  // Call the AI service.
  const aiRes = await streamTutorChat({
    user_id: appUserId,
    session_id: session.id,
    quest_id: body.quest_id,
    node_id: body.node_id,
    node_title: body.node_title,
    node_summary: body.node_summary,
    subject_slug: body.subject_slug,
    history,
    new_message: body.new_message,
  });

  // Tee the stream: one copy to the browser, one to accumulate for persistence.
  const reader = aiRes.body!.getReader();
  let assistantText = "";

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) {
        controller.close();
        // Fire-and-forget persistence.
        void persistAssistantMessage({
          sb,
          sessionId: session.id,
          userId: appUserId,
          content: assistantText,
          tokensInGuess: estimateTokens(body.new_message),
          tokensOutGuess: estimateTokens(assistantText),
        });
        return;
      }
      assistantText += new TextDecoder().decode(value);
      controller.enqueue(value);
    },
    cancel() {
      void reader.cancel();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-cache, no-transform",
    },
  });
}

async function persistAssistantMessage(args: {
  sb: ReturnType<typeof getAdminSupabase>;
  sessionId: string;
  userId: string;
  content: string;
  tokensInGuess: number;
  tokensOutGuess: number;
}) {
  try {
    await args.sb.from("messages").insert({
      session_id: args.sessionId,
      user_id: args.userId,
      role: "assistant",
      content: args.content,
      tokens_in: args.tokensInGuess,
      tokens_out: args.tokensOutGuess,
      pipeline: "tutor",
    });

    // Update aggregate counters on the session and budget. (For v0 we treat
    // assistant-side accounting as approximate; the canonical record lives in
    // llm_calls written by the AI service.)
    const totalTokens = args.tokensInGuess + args.tokensOutGuess;
    const { data: sessionRow } = await args.sb
      .from("sessions")
      .select("tokens_used")
      .eq("id", args.sessionId)
      .single();
    await args.sb
      .from("sessions")
      .update({
        message_count: await fetchCount(args.sb, args.sessionId),
        tokens_used: (sessionRow?.tokens_used ?? 0) + totalTokens,
      })
      .eq("id", args.sessionId);

    const periodStart = firstOfMonth(new Date());
    const { data: budget } = await args.sb
      .from("user_token_budgets")
      .select("tokens_used")
      .eq("user_id", args.userId)
      .eq("period_start", periodStart)
      .single();

    await args.sb
      .from("user_token_budgets")
      .update({
        tokens_used: (budget?.tokens_used ?? 0) + totalTokens,
        last_updated_at: new Date().toISOString(),
      })
      .eq("user_id", args.userId)
      .eq("period_start", periodStart);
  } catch {
    // Persistence errors should not surface — the stream has already been sent.
  }
}

async function fetchCount(
  sb: ReturnType<typeof getAdminSupabase>,
  sessionId: string,
): Promise<number> {
  const { count } = await sb
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .is("deleted_at", null);
  return count ?? 0;
}

/** Very rough token estimate: ~4 chars/token. AI service reports real counts. */
function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

function firstOfMonth(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}
