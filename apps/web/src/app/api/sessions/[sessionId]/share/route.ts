import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { ensureAppUser } from "@/lib/user";
import { getAdminSupabase } from "@/utils/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function generateShareSlug(): string {
  // 9 random bytes -> 12 base64url chars. Not sequential/guessable.
  return randomBytes(9).toString("base64url");
}

function shareUrlFor(req: Request, slug: string): string {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}/share/${slug}`;
}

/** Publish (or re-fetch) the read-only share link for one session/sub-topic. */
export async function POST(
  req: Request,
  { params }: { params: { sessionId: string } },
) {
  const { appUserId } = await ensureAppUser();
  const sb = getAdminSupabase();

  const { data: session } = await sb
    .from("sessions")
    .select("id, user_id, share_slug")
    .eq("id", params.sessionId)
    .single();

  if (!session || session.user_id !== appUserId) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  let slug = session.share_slug as string | null;

  if (!slug) {
    slug = generateShareSlug();
    const { error } = await sb
      .from("sessions")
      .update({ share_slug: slug, shared_at: new Date().toISOString() })
      .eq("id", session.id);
    // Extremely unlikely, but the column is UNIQUE — surface a clean retry
    // instead of a raw constraint-violation error if two slugs ever collide.
    if (error) {
      return NextResponse.json(
        { error: "Could not create a share link, please try again" },
        { status: 500 },
      );
    }
  } else {
    await sb
      .from("sessions")
      .update({ shared_at: new Date().toISOString() })
      .eq("id", session.id);
  }

  return NextResponse.json({ slug, url: shareUrlFor(req, slug) });
}

/** Revoke a previously published share link. */
export async function DELETE(
  req: Request,
  { params }: { params: { sessionId: string } },
) {
  const { appUserId } = await ensureAppUser();
  const sb = getAdminSupabase();

  const { data: session } = await sb
    .from("sessions")
    .select("id, user_id")
    .eq("id", params.sessionId)
    .single();

  if (!session || session.user_id !== appUserId) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  await sb
    .from("sessions")
    .update({ share_slug: null, shared_at: null })
    .eq("id", session.id);

  return NextResponse.json({ ok: true });
}
