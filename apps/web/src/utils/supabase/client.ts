"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Browser-side Supabase client. Uses the publishable key and respects RLS. */
export function getBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
