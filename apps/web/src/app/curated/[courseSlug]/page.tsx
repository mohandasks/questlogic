import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ensureAppUser } from "@/lib/user";
import { getAdminSupabase } from "@/utils/supabase/admin";
import { SkillTreeList } from "@/components/skill-tree-list";
import { SubmitButton } from "@/components/submit-button";
import type { CourseMetadata, NodeStatus } from "@questlogic/shared";

export const dynamic = "force-dynamic";

async function startCourseAction(formData: FormData): Promise<never> {
  "use server";
  const { appUserId } = await ensureAppUser();
  const templateId = String(formData.get("template_id") ?? "");
  const subjectId = String(formData.get("subject_id") ?? "");
  const title = String(formData.get("title") ?? "");
  const courseSlug = String(formData.get("course_slug") ?? "");
  if (!templateId || !subjectId || !courseSlug) {
    throw new Error("Missing template_id, subject_id, or course_slug");
  }

  const sb = getAdminSupabase();

  // A curated course's quest is instantiated directly from its (already
  // fixed) template — no curriculum generation, unlike /quests/new.
  const { data: quest, error: qErr } = await sb
    .from("quests")
    .insert({
      user_id: appUserId,
      subject_id: subjectId,
      template_id: templateId,
      title,
    })
    .select("id")
    .single();
  if (qErr || !quest) throw new Error(`Quest insert: ${qErr?.message}`);

  const { data: nodes } = await sb
    .from("template_nodes")
    .select("id")
    .eq("template_id", templateId);
  const { data: edges } = await sb
    .from("template_edges")
    .select("to_node_id")
    .eq("template_id", templateId);

  const allNodeIds = (nodes ?? []).map((n) => n.id);
  const withIncoming = new Set((edges ?? []).map((e) => e.to_node_id));
  const entryNodeIds = new Set(allNodeIds.filter((id) => !withIncoming.has(id)));

  const progressRows = allNodeIds.map((nodeId) => ({
    quest_id: quest.id,
    user_id: appUserId,
    template_node_id: nodeId,
    status: entryNodeIds.has(nodeId) ? "available" : "locked",
  }));
  const { error: pErr } = await sb.from("node_progress").insert(progressRows);
  if (pErr) throw new Error(`Progress insert: ${pErr.message}`);

  redirect(`/curated/${courseSlug}`);
}

export default async function CuratedCoursePage({
  params,
}: {
  params: { courseSlug: string };
}) {
  const { appUserId } = await ensureAppUser();
  const sb = getAdminSupabase();

  const { data: template } = await sb
    .from("curriculum_templates")
    .select("id, subject_id, topic, course_metadata")
    .eq("slug", params.courseSlug)
    .eq("source_type", "curated")
    .eq("status", "active")
    .single();
  if (!template) notFound();

  const meta = (template.course_metadata ?? {}) as CourseMetadata;

  const { data: nodes } = await sb
    .from("template_nodes")
    .select("id, slug, title, summary, order_hint, estimated_minutes")
    .eq("template_id", template.id)
    .order("order_hint", { ascending: true });

  const { data: edges } = await sb
    .from("template_edges")
    .select("from_node_id, to_node_id")
    .eq("template_id", template.id);

  const { data: quest } = await sb
    .from("quests")
    .select("id")
    .eq("user_id", appUserId)
    .eq("template_id", template.id)
    .is("deleted_at", null)
    .maybeSingle();

  const progressByNode = new Map<string, { status: string }>();
  if (quest) {
    const { data: progress } = await sb
      .from("node_progress")
      .select("template_node_id, status")
      .eq("quest_id", quest.id)
      .eq("user_id", appUserId);
    for (const p of progress ?? []) {
      progressByNode.set(p.template_node_id, { status: p.status });
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Link href="/curated" className="text-mute text-sm hover:text-ink">
        ← Curated courses
      </Link>
      <header className="mt-4">
        <p className="chip">
          {[meta.institution, meta.course_code].filter(Boolean).join(" · ") || "Curated course"}
        </p>
        <h1 className="mt-2 text-3xl font-bold">{template.topic}</h1>
        <p className="mt-1 text-mute">
          {[meta.instructor, meta.term].filter(Boolean).join(" · ")}
        </p>
      </header>

      {!quest ? (
        <form action={startCourseAction} className="mt-8">
          <input type="hidden" name="template_id" value={template.id} />
          <input type="hidden" name="subject_id" value={template.subject_id} />
          <input type="hidden" name="title" value={template.topic} />
          <input type="hidden" name="course_slug" value={params.courseSlug} />
          <SubmitButton idleLabel="Start course" pendingLabel="Setting up…" className="btn btn-primary" />
        </form>
      ) : (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Weeks</h2>
          <p className="text-mute text-sm">
            The tutor teaches each lecture from its actual transcript, in order.
          </p>
          <div className="mt-4">
            <SkillTreeList
              questId={quest.id}
              linkBase={`/curated/${params.courseSlug}/lectures`}
              nodes={(nodes ?? []).map((n) => ({
                id: n.id,
                slug: n.slug,
                title: n.title,
                summary: n.summary,
                estimated_minutes: n.estimated_minutes,
                status: (progressByNode.get(n.id)?.status ?? "locked") as NodeStatus,
              }))}
              edges={(edges ?? []).map((e) => ({
                from: e.from_node_id,
                to: e.to_node_id,
              }))}
            />
          </div>
        </section>
      )}
    </main>
  );
}
