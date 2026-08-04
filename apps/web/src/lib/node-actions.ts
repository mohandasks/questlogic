import { getAdminSupabase } from "@/utils/supabase/admin";

const NODE_MASTERY_XP = 100;

/**
 * Marks a node mastered, awards XP (idempotently), recomputes the cached
 * total_xp/level, and unlocks any downstream node whose prerequisites are
 * now all mastered. Shared between the generated-quest node page and the
 * curated-course lecture page — mastering a node means the same thing in
 * both (understood the material), regardless of where the content came
 * from.
 */
export async function markNodeMastered(args: {
  appUserId: string;
  questId: string;
  nodeId: string;
}): Promise<void> {
  const { appUserId, questId, nodeId } = args;
  const sb = getAdminSupabase();

  // 1. Confirm ownership + flip status. Only act if not already mastered, so
  //    re-clicks are no-ops at the data layer too.
  const { data: progress, error: pErr } = await sb
    .from("node_progress")
    .update({
      status: "mastered",
      mastered_at: new Date().toISOString(),
    })
    .eq("quest_id", questId)
    .eq("template_node_id", nodeId)
    .eq("user_id", appUserId)
    .neq("status", "mastered")
    .select("id")
    .maybeSingle();
  if (pErr) throw new Error(`Mark mastered: ${pErr.message}`);

  if (!progress) return;

  // 2. Award XP. Idempotency key gates repeated awards if the action runs twice.
  await sb.from("xp_events").upsert(
    {
      user_id: appUserId,
      amount: NODE_MASTERY_XP,
      source_type: "node_mastered",
      source_id: nodeId,
      idempotency_key: `node_mastered:${appUserId}:${progress.id}`,
    },
    { onConflict: "idempotency_key", ignoreDuplicates: true },
  );

  // 3. Recompute cached total_xp + level from the canonical xp_events ledger.
  const { data: events } = await sb
    .from("xp_events")
    .select("amount")
    .eq("user_id", appUserId);
  const totalXp = (events ?? []).reduce((n, e) => n + (e.amount as number), 0);
  const level = Math.floor(Math.sqrt(totalXp / 100)) + 1;
  await sb
    .from("student_profiles")
    .update({ total_xp: totalXp, current_level: level })
    .eq("user_id", appUserId);

  // 4. Unlock downstream nodes whose prereqs are all now mastered.
  const { data: downstream } = await sb
    .from("template_edges")
    .select("to_node_id")
    .eq("from_node_id", nodeId);

  for (const edge of downstream ?? []) {
    const downstreamNodeId = edge.to_node_id;

    const { data: prereqEdges } = await sb
      .from("template_edges")
      .select("from_node_id")
      .eq("to_node_id", downstreamNodeId);
    const prereqIds = (prereqEdges ?? []).map((e) => e.from_node_id);

    const { data: prereqProgress } = await sb
      .from("node_progress")
      .select("status")
      .eq("quest_id", questId)
      .eq("user_id", appUserId)
      .in("template_node_id", prereqIds);

    const allMastered =
      prereqIds.length > 0 &&
      (prereqProgress ?? []).length === prereqIds.length &&
      (prereqProgress ?? []).every((p) => p.status === "mastered");

    if (allMastered) {
      await sb
        .from("node_progress")
        .update({ status: "available" })
        .eq("quest_id", questId)
        .eq("template_node_id", downstreamNodeId)
        .eq("user_id", appUserId)
        .eq("status", "locked");
    }
  }
}

/**
 * Self-reported "I looked at this assignment" signal — distinct from node
 * mastery, which continues to mean "understood the lecture material," not
 * "did the homework." No auto-grading in v1 (see design doc §5).
 */
export async function markAssignmentReviewed(args: {
  appUserId: string;
  assignmentId: string;
}): Promise<void> {
  const sb = getAdminSupabase();
  await sb.from("curated_assignment_completions").upsert(
    { assignment_id: args.assignmentId, user_id: args.appUserId },
    { onConflict: "assignment_id,user_id", ignoreDuplicates: true },
  );
}

/**
 * Finds or creates the active session for a (user, quest, node) triple, and
 * flips node_progress from 'available' to 'in_progress' on first entry.
 * Shared between the generated-quest and curated-lecture node pages — same
 * session lifecycle either way.
 */
export async function findOrCreateNodeSession(args: {
  appUserId: string;
  questId: string;
  nodeId: string;
  currentStatus: string | undefined;
}): Promise<{ sessionId: string; shareSlug: string | null }> {
  const { appUserId, questId, nodeId, currentStatus } = args;
  const sb = getAdminSupabase();

  const { data: existing } = await sb
    .from("sessions")
    .select("id, share_slug")
    .eq("user_id", appUserId)
    .eq("quest_id", questId)
    .eq("current_node_id", nodeId)
    .is("ended_at", null)
    .is("deleted_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    return { sessionId: existing.id, shareSlug: existing.share_slug };
  }

  const { data: created, error: cErr } = await sb
    .from("sessions")
    .insert({ user_id: appUserId, quest_id: questId, current_node_id: nodeId })
    .select("id")
    .single();
  if (cErr || !created) throw new Error(`Session create: ${cErr?.message}`);

  if (currentStatus === "available") {
    await sb
      .from("node_progress")
      .update({ status: "in_progress", started_at: new Date().toISOString() })
      .eq("quest_id", questId)
      .eq("template_node_id", nodeId);
  }

  return { sessionId: created.id, shareSlug: null };
}
