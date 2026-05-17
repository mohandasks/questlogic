import type {
  ChatStreamRequest,
  CurriculumGenerateRequest,
  CurriculumGenerateResponse,
} from "@questlogic/shared";

function aiUrl(path: string): string {
  const base = process.env.AI_SERVICE_URL ?? "http://localhost:8000";
  return `${base.replace(/\/+$/, "")}${path}`;
}

function authHeaders(): Record<string, string> {
  const secret = process.env.AI_SERVICE_SHARED_SECRET;
  if (!secret) {
    throw new Error("AI_SERVICE_SHARED_SECRET is not set");
  }
  return {
    "content-type": "application/json",
    authorization: `Bearer ${secret}`,
  };
}

export async function generateCurriculum(
  req: CurriculumGenerateRequest,
): Promise<CurriculumGenerateResponse> {
  const res = await fetch(aiUrl("/quests/generate"), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(req),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `AI service /quests/generate failed: ${res.status} ${body}`,
    );
  }
  return (await res.json()) as CurriculumGenerateResponse;
}

/**
 * Returns a ReadableStream of UTF-8 SSE text from the AI service. The caller
 * forwards it to the browser unchanged.
 */
export async function streamTutorChat(
  req: ChatStreamRequest,
): Promise<Response> {
  const res = await fetch(aiUrl("/chat/stream"), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(req),
    cache: "no-store",
  });
  if (!res.ok || !res.body) {
    const body = await res.text();
    throw new Error(`AI service /chat/stream failed: ${res.status} ${body}`);
  }
  return res;
}
