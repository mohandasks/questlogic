"""POST /chat/stream — streams tutor response chunks as plain UTF-8 text."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, model_validator

from ..auth import require_shared_secret
from ..pipelines.tutor import stream_tutor_reply

router = APIRouter(prefix="/chat", tags=["chat"])


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatStreamRequest(BaseModel):
    user_id: str
    session_id: str
    quest_id: str
    node_id: str
    node_title: str
    node_summary: str
    subject_slug: str = Field(pattern="^(history|economics|philosophy|curated)$")
    history: list[ChatMessage] = Field(default_factory=list)
    new_message: str = Field(default="", max_length=4000)
    # True for the synthetic first turn of a session: the student hasn't sent
    # anything yet and the tutor should open with an intro. new_message is
    # allowed to be empty in that case only.
    kickoff: bool = False
    # Curated-course fields. Next.js resolves these from
    # curriculum_templates.pedagogy_style / curated_lecture_sources /
    # curated_assignments before calling this endpoint — the AI service stays
    # stateless and never queries Postgres for content, only for telemetry.
    pedagogy_style: str = Field(default="socratic", pattern="^(socratic|guided)$")
    transcript: str | None = Field(default=None, max_length=200_000)
    assignment_instructions: str | None = Field(default=None, max_length=20_000)

    @model_validator(mode="after")
    def _require_message_unless_kickoff(self) -> "ChatStreamRequest":
        if not self.kickoff and not self.new_message.strip():
            raise ValueError("new_message must be non-empty unless kickoff is set")
        return self


@router.post("/stream")
async def post_stream(
    body: ChatStreamRequest, _: None = Depends(require_shared_secret)
) -> StreamingResponse:
    history = [{"role": m.role, "content": m.content} for m in body.history]

    async def gen():
        try:
            async for chunk in stream_tutor_reply(
                user_id=body.user_id,
                session_id=body.session_id,
                subject_slug=body.subject_slug,
                node_title=body.node_title,
                node_summary=body.node_summary,
                history=history,
                new_message=body.new_message,
                kickoff=body.kickoff,
                pedagogy_style=body.pedagogy_style,  # type: ignore[arg-type]
                transcript=body.transcript,
                assignment_instructions=body.assignment_instructions,
            ):
                yield chunk
        except Exception as e:  # noqa: BLE001
            yield f"\n\n[tutor error: {type(e).__name__}: {e}]"

    return StreamingResponse(
        gen(),
        media_type="text/plain; charset=utf-8",
        headers={"cache-control": "no-cache, no-transform"},
    )
