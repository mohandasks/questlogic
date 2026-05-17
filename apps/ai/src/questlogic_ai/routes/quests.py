"""POST /quests/generate — curriculum generation endpoint."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..auth import require_shared_secret
from ..pipelines.curriculum import generate_curriculum

router = APIRouter(prefix="/quests", tags=["quests"])


class GenerateRequest(BaseModel):
    user_id: str
    subject_slug: str = Field(pattern="^(history|economics|philosophy)$")
    topic: str = Field(min_length=2, max_length=200)
    depth: str = Field(pattern="^(intro|intermediate|advanced)$")


class GenerateResponse(BaseModel):
    template: dict
    model: str
    tokens_in: int
    tokens_out: int


@router.post("/generate", response_model=GenerateResponse)
async def post_generate(
    body: GenerateRequest, _: None = Depends(require_shared_secret)
) -> GenerateResponse:
    try:
        result = await generate_curriculum(
            user_id=body.user_id,
            subject_slug=body.subject_slug,
            topic=body.topic,
            depth=body.depth,
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"curriculum failed: {e}") from e

    return GenerateResponse(
        template=result.template.model_dump(),
        model=result.model,
        tokens_in=result.tokens_in,
        tokens_out=result.tokens_out,
    )
