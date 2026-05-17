"""POST /chat/stream — streams tutor response chunks as plain UTF-8 text."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

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
    subject_slug: str = Field(pattern="^(history|economics|philosophy)$")
    history: list[ChatMessage] = Field(default_factory=list)
    new_message: str = Field(min_length=1, max_length=4000)


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
            ):
                yield chunk
        except Exception as e:  # noqa: BLE001
            yield f"\n\n[tutor error: {type(e).__name__}: {e}]"

    return StreamingResponse(
        gen(),
        media_type="text/plain; charset=utf-8",
        headers={"cache-control": "no-cache, no-transform"},
    )
