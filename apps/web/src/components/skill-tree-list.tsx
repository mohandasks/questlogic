"use client";

import Link from "next/link";
import clsx from "clsx";
import type { NodeStatus } from "@questlogic/shared";

interface Node {
  id: string;
  slug: string;
  title: string;
  summary: string;
  estimated_minutes: number | null;
  status: NodeStatus;
}

interface Edge {
  from: string;
  to: string;
}

/**
 * v0 skill-tree renderer: ordered list grouped by reachability. The full
 * React Flow DAG view is a follow-up vertical slice — this layout reads well
 * for ~6–12 node trees and proves the underlying data.
 */
export function SkillTreeList({
  questId,
  nodes,
  edges,
}: {
  questId: string;
  nodes: Node[];
  edges: Edge[];
}) {
  // Group: entry points (no incoming edges) first, then by topological order
  // approximation via depth from any entry node.
  const incoming = new Map<string, number>();
  for (const n of nodes) incoming.set(n.id, 0);
  for (const e of edges) {
    incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
  }

  // Sort: status priority (in_progress > available > mastered > locked > failed),
  // then by indegree, then by original order. Keeps the "what should I do next"
  // node at the top.
  const statusRank: Record<NodeStatus, number> = {
    in_progress: 0,
    available: 1,
    mastered: 2,
    locked: 3,
    failed: 4,
  };
  const sorted = [...nodes].sort((a, b) => {
    const r = statusRank[a.status] - statusRank[b.status];
    if (r !== 0) return r;
    return (incoming.get(a.id) ?? 0) - (incoming.get(b.id) ?? 0);
  });

  return (
    <ul className="grid gap-3">
      {sorted.map((n) => {
        const clickable = n.status === "available" || n.status === "in_progress" || n.status === "mastered";
        const inner = (
          <div
            className={clsx(
              "panel flex items-center justify-between p-4",
              clickable ? "hover:border-accent" : "opacity-60",
            )}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <StatusDot status={n.status} />
                <h3 className="truncate text-base font-semibold">{n.title}</h3>
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-mute">{n.summary}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3 pl-4 text-xs text-mute">
              {n.estimated_minutes ? <span>{n.estimated_minutes}m</span> : null}
              <span className="chip">{n.status.replace("_", " ")}</span>
            </div>
          </div>
        );
        return (
          <li key={n.id}>
            {clickable ? (
              <Link href={`/quests/${questId}/nodes/${n.id}`}>{inner}</Link>
            ) : (
              inner
            )}
          </li>
        );
      })}
    </ul>
  );
}

function StatusDot({ status }: { status: NodeStatus }) {
  const color =
    status === "mastered"
      ? "#5ce0a8"
      : status === "in_progress"
        ? "#22d3ee"
        : status === "available"
          ? "#7c5cff"
          : status === "failed"
            ? "#ff5c7c"
            : "#3a3a55";
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ background: color }}
    />
  );
}
