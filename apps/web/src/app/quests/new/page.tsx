import { redirect } from "next/navigation";
import Link from "next/link";
import { ensureAppUser } from "@/lib/user";
import { getAdminSupabase } from "@/utils/supabase/admin";
import { generateCurriculum } from "@/lib/ai-client";
import type { SubjectSlug, CurriculumDepth } from "@questlogic/shared";

export const dynamic = "force-dynamic";

async function createQuestAction(formData: FormData): Promise<never> {
  "use server";
  const { appUserId } = await ensureAppUser();
  const subjectSlug = (formData.get("subject") ?? "") as SubjectSlug;
  const topic = String(formData.get("topic") ?? "").trim();
  const depth = (formData.get("depth") ?? "intro") as CurriculumDepth;

  if (!subjectSlug || !topic) {
    throw new Error("Subject and topic are required");
  }

  const sb = getAdminSupabase();
  const { data: subject } = await sb
    .from("subjects")
    .select("id")
    .eq("slug", subjectSlug)
    .single();
  if (!subject) throw new Error("Unknown subject");

  const contentHash = await hash(`${subjectSlug}|${topic}|${depth}|v1`);

  // Cache lookup: if we've already generated this template, reuse it. Saves an
  // AI call and avoids a unique-constraint violation on (content_hash, version).
  const { data: existingTemplate } = await sb
    .from("curriculum_templates")
    .select("id")
    .eq("content_hash", contentHash)
    .eq("version", 1)
    .maybeSingle();

  let templateId: string;
  let entryNodeIds: Set<string>;
  let allNodeIds: string[];

  if (existingTemplate) {
    templateId = existingTemplate.id;
    const { ids, entries } = await loadTemplateGraph(sb, templateId);
    allNodeIds = ids;
    entryNodeIds = entries;
  } else {
    // Cache miss — generate from the AI service and persist the whole template.
    const ai = await generateCurriculum({
      user_id: appUserId,
      subject_slug: subjectSlug,
      topic,
      depth,
    });

    const { data: template, error: tErr } = await sb
      .from("curriculum_templates")
      .insert({
        subject_id: subject.id,
        topic,
        depth,
        content_hash: contentHash,
        version: 1,
        status: "active",
        generator_model: ai.model,
        generated_by: appUserId,
      })
      .select("id")
      .single();
    if (tErr || !template) throw new Error(`Template insert: ${tErr?.message}`);
    templateId = template.id;

    const nodeRows = ai.template.nodes.map((n, i) => ({
      template_id: templateId,
      slug: n.slug,
      title: n.title,
      summary: n.summary,
      content: (n.content ?? {}) as Record<string, unknown>,
      order_hint: i,
      depth_level: n.prerequisites.length === 0 ? 0 : 1,
      estimated_minutes: n.estimated_minutes ?? null,
    }));
    const { data: insertedNodes, error: nErr } = await sb
      .from("template_nodes")
      .insert(nodeRows)
      .select("id, slug");
    if (nErr || !insertedNodes)
      throw new Error(`Nodes insert: ${nErr?.message}`);

    const slugToId = new Map(insertedNodes.map((r) => [r.slug, r.id]));

    const edgeRows: Array<{
      template_id: string;
      from_node_id: string;
      to_node_id: string;
    }> = [];
    for (const n of ai.template.nodes) {
      const toId = slugToId.get(n.slug);
      if (!toId) continue;
      for (const prereq of n.prerequisites) {
        const fromId = slugToId.get(prereq);
        if (!fromId || fromId === toId) continue;
        edgeRows.push({
          template_id: templateId,
          from_node_id: fromId,
          to_node_id: toId,
        });
      }
    }
    if (edgeRows.length > 0) {
      const { error: eErr } = await sb.from("template_edges").insert(edgeRows);
      if (eErr) throw new Error(`Edges insert: ${eErr.message}`);
    }

    allNodeIds = insertedNodes.map((r) => r.id);
    entryNodeIds = new Set(
      ai.template.nodes
        .filter((n) => n.prerequisites.length === 0)
        .map((n) => slugToId.get(n.slug))
        .filter((id): id is string => !!id),
    );
  }

  // Per-user quest row.
  const { data: quest, error: qErr } = await sb
    .from("quests")
    .insert({
      user_id: appUserId,
      subject_id: subject.id,
      template_id: templateId,
      title: topic,
    })
    .select("id")
    .single();
  if (qErr || !quest) throw new Error(`Quest insert: ${qErr?.message}`);

  // Per-user progress rows. Entry nodes start "available"; everything else "locked".
  const progressRows = allNodeIds.map((nodeId) => ({
    quest_id: quest.id,
    user_id: appUserId,
    template_node_id: nodeId,
    status: entryNodeIds.has(nodeId) ? "available" : "locked",
  }));
  const { error: pErr } = await sb.from("node_progress").insert(progressRows);
  if (pErr) throw new Error(`Progress insert: ${pErr.message}`);

  redirect(`/quests/${quest.id}`);
}

async function loadTemplateGraph(
  sb: ReturnType<typeof getAdminSupabase>,
  templateId: string,
): Promise<{ ids: string[]; entries: Set<string> }> {
  const { data: nodes } = await sb
    .from("template_nodes")
    .select("id")
    .eq("template_id", templateId);
  const { data: edges } = await sb
    .from("template_edges")
    .select("to_node_id")
    .eq("template_id", templateId);

  const ids = (nodes ?? []).map((n) => n.id);
  const withIncoming = new Set((edges ?? []).map((e) => e.to_node_id));
  const entries = new Set(ids.filter((id) => !withIncoming.has(id)));
  return { ids, entries };
}

async function hash(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default function NewQuestPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/dashboard" className="text-mute text-sm hover:text-ink">
        ← Back to dashboard
      </Link>
      <h1 className="mt-4 text-3xl font-bold">Start a new quest</h1>
      <p className="mt-2 text-mute">
        Pick a subject and a topic. The tutor will generate a small skill tree
        for you to work through.
      </p>

      <form action={createQuestAction} className="mt-8 grid gap-5">
        <div>
          <label className="text-sm text-mute">Subject</label>
          <select
            name="subject"
            required
            defaultValue="history"
            className="mt-1 w-full rounded-lg border border-border bg-panel p-3"
          >
            <option value="history">History</option>
            <option value="economics">Economics</option>
            <option value="philosophy">Philosophy</option>
          </select>
        </div>

        <div>
          <label className="text-sm text-mute">Topic</label>
          <input
            name="topic"
            required
            placeholder="e.g. The fall of the Roman Republic"
            className="mt-1 w-full rounded-lg border border-border bg-panel p-3"
          />
        </div>

        <div>
          <label className="text-sm text-mute">Depth</label>
          <select
            name="depth"
            defaultValue="intro"
            className="mt-1 w-full rounded-lg border border-border bg-panel p-3"
          >
            <option value="intro">Intro</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
        </div>

        <button type="submit" className="btn btn-primary justify-self-start">
          Generate quest
        </button>
        <p className="text-xs text-mute">
          Generation takes ~10–20 seconds the first time. Repeat topics load
          instantly.
        </p>
      </form>
    </main>
  );
}
