"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, SubjectSlug } from "@questlogic/shared";

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

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [history]);

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setStreaming(true);

    const userMsg: ChatMessage = { role: "user", content: text };
    const next = [...history, userMsg, { role: "assistant", content: "" } as ChatMessage];
    setHistory(next);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          quest_id: questId,
          node_id: nodeId,
          node_title: nodeTitle,
          node_summary: nodeSummary,
          subject_slug: subjectSlug,
          new_message: text,
        }),
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
          <p className="text-mute">
            Ask a question, share what you already know, or just say "teach me."
          </p>
        )}
        <div className="grid gap-4">
          {history.map((m, i) => (
            <Bubble key={i} msg={m} />
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

function Bubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  return (
    <div
      className={`max-w-[85%] whitespace-pre-wrap rounded-2xl border px-4 py-3 text-sm leading-relaxed ${
        isUser
          ? "ml-auto border-accent/50 bg-accent/10"
          : "mr-auto border-border bg-panel"
      }`}
    >
      {msg.content || (isUser ? "" : "…")}
    </div>
  );
}
