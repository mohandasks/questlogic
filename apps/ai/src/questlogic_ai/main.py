"""FastAPI entrypoint."""

from __future__ import annotations

import logging

from fastapi import FastAPI

from .routes.chat import router as chat_router
from .routes.quests import router as quests_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

app = FastAPI(
    title="QuestLogic AI",
    version="0.1.0",
    description="Curriculum generation and tutor streaming for QuestLogic.",
)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(quests_router)
app.include_router(chat_router)
