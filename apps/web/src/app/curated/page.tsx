import Link from "next/link";
import { ensureAppUser } from "@/lib/user";
import { getAdminSupabase } from "@/utils/supabase/admin";
import type { CourseMetadata } from "@questlogic/shared";

export const dynamic = "force-dynamic";

export default async function CuratedBrowsePage() {
  await ensureAppUser();
  const sb = getAdminSupabase();

  const { data: templates } = await sb
    .from("curriculum_templates")
    .select("id, slug, topic, course_metadata")
    .eq("source_type", "curated")
    .eq("status", "active")
    .order("topic", { ascending: true });

  const templateIds = (templates ?? []).map((t) => t.id);
  const { data: nodeCounts } = templateIds.length
    ? await sb.from("template_nodes").select("template_id").in("template_id", templateIds)
    : { data: [] as { template_id: string }[] };

  const countByTemplate = new Map<string, number>();
  for (const n of nodeCounts ?? []) {
    countByTemplate.set(n.template_id, (countByTemplate.get(n.template_id) ?? 0) + 1);
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Link href="/dashboard" className="text-mute text-sm hover:text-ink">
        ← Back to dashboard
      </Link>
      <header className="mt-4">
        <p className="chip">Curated</p>
        <h1 className="mt-2 text-3xl font-bold">Curated courses</h1>
        <p className="mt-2 max-w-xl text-mute">
          Fixed courses built from real lecture material — the tutor teaches
          from the actual transcript for each week, not its own knowledge.
        </p>
      </header>

      <div className="mt-8 grid gap-3">
        {(!templates || templates.length === 0) && (
          <div className="panel p-6 text-mute">
            No curated courses are live yet.
          </div>
        )}
        {templates?.map((t) => {
          const meta = (t.course_metadata ?? {}) as CourseMetadata;
          const weekCount = countByTemplate.get(t.id) ?? 0;
          return (
            <Link
              key={t.id}
              href={`/curated/${t.slug}`}
              className="panel flex items-center justify-between p-5 hover:border-accent"
            >
              <div>
                <div className="font-semibold">{t.topic}</div>
                <div className="mt-1 text-sm text-mute">
                  {[meta.institution, meta.instructor, meta.term].filter(Boolean).join(" · ") ||
                    "Curated course"}
                </div>
              </div>
              <span className="chip shrink-0">{weekCount} lectures</span>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
