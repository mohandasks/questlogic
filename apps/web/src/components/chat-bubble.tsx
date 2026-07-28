import type { ChatMessage } from "@questlogic/shared";

/**
 * Pure rendering, no hooks — safe to use from both the live (client)
 * ChatWindow and the public (server-rendered) share page.
 */
export function ChatBubble({ msg }: { msg: ChatMessage }) {
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
