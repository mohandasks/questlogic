"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, SubjectSlug } from "@questlogic/shared";
import { ChatBubble } from "./chat-bubble";

interface Props {
  sessionId: string;
  questId: string;
  nodeId: string;
  nodeTitle: string;
  nodeSummary: string;
  subjectSlug: SubjectSlug;
  initialHistory: ChatMessage[];
}

export function ChatWindow({
  sessionId,
  questId,
  nodeId,
  nodeTitle,
  nodeSummary,
  subjectSlug,
  initialHistory,
}: Props) {
  const [history, setHistory] = useState<ChatMessage[]>(initialHistory);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const kickedOffRef = useRef(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [history]);

  // First time a student opens a node with no prior messages, have the tutor
  // lead with an intro instead of sitting on a blank page waiting for them to
  // type something. Guarded by a ref (not just initialHistory) so React
  // strict-mode's double-invoke in dev can't fire it twice.
  useEffect(() => {
    if (initialHistory.length === 0 && !kickedOffRef.current) {
      kickedOffRef.current = true;
      void streamChat({
        session_id: sessionId,
        quest_id: questId,
        node_id: nodeId,
        node_title: nodeTitle,
        node_summary: nodeSummary,
        subject_slug: subjectSlug,
        new_message: "",
        kickoff: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function streamChat(payload: {
    session_id: string;
    quest_id: string;
    node_id: string;
    node_title: string;
    node_summary: string;
    subject_slug: string;
    new_message: string;
    kickoff?: boolean;
  }) {
    setStreaming(true);
    setHistory((h) => [...h, { role: "assistant", content: "" } as ChatMessage]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Chat request failed: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantSoFar = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        // The AI service emits raw text chunks; we just append.
        assistantSoFar += chunk;
        setHistory((h) => {
          const copy = h.slice();
          copy[copy.length - 1] = { role: "assistant", content: assistantSoFar };
          return copy;
        });
      }
    } catch (err) {
      setHistory((h) => {
        const copy = h.slice();
        copy[copy.length - 1] = {
          role: "assistant",
          content: `_(error: ${err instanceof Error ? err.message : "unknown"})_`,
        };
        return copy;
      });
    } finally {
      setStreaming(false);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setHistory((h) => [...h, { role: "user", content: text }]);

    await streamChat({
      session_id: sessionId,
      quest_id: questId,
      node_id: nodeId,
      node_title: nodeTitle,
      node_summary: nodeSummary,
      subject_slug: subjectSlug,
      new_message: text,
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="mt-6 flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className="panel min-h-0 flex-1 overflow-y-auto p-5"
      >
        {history.length === 0 && (
          <p className="text-mute">Loading your intro…</p>
        )}
        <div className="grid gap-4">
          {history.map((m, i) => (
            <ChatBubble key={i} msg={m} />
          ))}
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type your message…  (Enter to send, Shift+Enter for newline)"
          rows={2}
          className="min-h-[3rem] flex-1 resize-none rounded-lg border border-border bg-panel p-3"
          disabled={streaming}
        />
        <button
          className="btn btn-primary"
          onClick={send}
          disabled={streaming || input.trim().length === 0}
        >
          {streaming ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
