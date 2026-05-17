"""Shared-secret bearer auth between the Next.js backend and this service."""

from __future__ import annotations

from fastapi import Header, HTTPException, status

from .settings import settings


async def require_shared_secret(authorization: str | None = Header(default=None)) -> None:
    if not settings.shared_secret:
        # Misconfigured — refuse rather than running open.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="AI_SERVICE_SHARED_SECRET is not set",
        )
    expected = f"Bearer {settings.shared_secret}"
    if authorization != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid bearer token"
        )
