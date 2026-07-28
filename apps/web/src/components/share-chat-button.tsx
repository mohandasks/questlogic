"use client";

import { useEffect, useState } from "react";

interface Props {
  sessionId: string;
  /** share_slug already on the session row, if it was shared in a prior visit. */
  initialSlug: string | null;
}

/**
 * Publishes (or revokes) a read-only link to this node's chat session. Scoped
 * to a single session, so sharing one sub-topic never exposes the rest of the
 * quest.
 */
export function ShareChatButton({ sessionId, initialSlug }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Computed on the client (needs window.location.origin) after mount, so the
  // first render matches the server-rendered markup and avoids a hydration
  // mismatch.
  useEffect(() => {
    if (initialSlug) {
      setUrl(`${window.location.origin}/share/${initialSlug}`);
    }
  }, [initialSlug]);

  async function share() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/share`, {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to create share link");
      setUrl(body.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create share link");
    } finally {
      setLoading(false);
    }
  }

  async function unshare() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/share`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to revoke share link");
      setUrl(null);
      setCopied(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke share link");
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (url) {
    return (
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="w-48 truncate rounded-lg border border-border bg-panel px-2 py-1 text-xs sm:w-64"
        />
        <button className="btn" onClick={copy} disabled={loading}>
          {copied ? "Copied" : "Copy"}
        </button>
        <button className="btn" onClick={unshare} disabled={loading}>
          Unshare
        </button>
        {error && <span className="text-xs" style={{ color: "#ff5c7c" }}>{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button className="btn" onClick={share} disabled={loading}>
        {loading ? "Sharing…" : "Share this topic"}
      </button>
      {error && <span className="text-xs" style={{ color: "#ff5c7c" }}>{error}</span>}
    </div>
  );
}
