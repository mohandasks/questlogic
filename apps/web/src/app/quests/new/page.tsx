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

  // 1. Ask the AI service to generate a curriculum template.
  const ai = await generateCurriculum({
    user_id: appUserId,
    subject_slug: subjectSlug,
    topic,
    depth,
  });

  const contentHash = await hash(`${subjectSlug}|${topic}|${depth}|v1`);

  // 2. Insert curriculum_templates row.
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

  // 3. Insert template_nodes.
  const nodeRows = ai.template.nodes.map((n, i) => ({
    template_id: template.id,
    slug: n.slug,
    title: n.title,
    summary: n.summary,
    content: (n.content ?? {}) as Record<string, unknown>,
    order_hint: i,
    depth_level: n.prerequisites.length === 0 ? 0 : 1, // crude; refined when DAG layout pass added
    estimated_minutes: n.estimated_minutes ?? null,
  }));
  const { data: insertedNodes, error: nErr } = await sb
    .from("template_nodes")
    .insert(nodeRows)
    .select("id, slug");
  if (nErr || !insertedNodes) throw new Error(`Nodes insert: ${nErr?.message}`);

  const slugToId = new Map(insertedNodes.map((r) => [r.slug, r.id]));

  // 4. Insert edges.
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
        template_id: template.id,
        from_node_id: fromId,
        to_node_id: toId,
      });
    }
  }
  if (edgeRows.length > 0) {
    const { error: eErr } = await sb.from("template_edges").insert(edgeRows);
    if (eErr) throw new Error(`Edges insert: ${eErr.message}`);
  }

  // 5. Insert quest row.
  const { data: quest, error: qErr } = await sb
    .from("quests")
    .insert({
      user_id: appUserId,
      subject_id: subject.id,
      template_id: template.id,
      title: topic,
    })
    .select("id")
    .single();
  if (qErr || !quest) throw new Error(`Quest insert: ${qErr?.message}`);

  // 6. Initialize node_progress: entry nodes "available", others "locked".
  const progressRows = ai.template.nodes.map((n) => {
    const nodeId = slugToId.get(n.slug)!;
    return {
      quest_id: quest.id,
      user_id: appUserId,
      template_node_id: nodeId,
      status: n.prerequisites.length === 0 ? "available" : "locked",
    };
  });
  await sb.from("node_progress").insert(progressRows);

  redirect(`/quests/${quest.id}`);
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
          Generation takes ~10–20 seconds. Hang tight.
        </p>
      </form>
    </main>
  );
}
