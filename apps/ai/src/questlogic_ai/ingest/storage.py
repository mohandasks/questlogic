"""Optional Cloudflare R2 upload for original course PDFs (provenance / "view
original" links). Mirrors db.py's pattern: if not configured, calls become a
no-op that logs and returns None rather than raising — ingestion still works
end-to-end on text alone, storage is additive.
"""

from __future__ import annotations

import logging
from pathlib import Path

from ..settings import settings

log = logging.getLogger(__name__)

_client = None
_configured: bool | None = None


def _is_configured() -> bool:
    global _configured
    if _configured is None:
        _configured = bool(
            settings.r2_account_id
            and settings.r2_access_key_id
            and settings.r2_secret_access_key
            and settings.r2_bucket_name
        )
        if not _configured:
            log.info("R2 not configured — original PDFs will not be uploaded (text-only ingestion).")
    return _configured


def _get_client():
    global _client
    if _client is None:
        import boto3  # local import: keep boto3 off the FastAPI service's hot path

        _client = boto3.client(
            "s3",
            endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            region_name="auto",
        )
    return _client


def upload_pdf(*, local_path: Path, key: str) -> str | None:
    """Uploads a PDF to R2 under `key`. Returns the stored object key (what
    goes in curated_lecture_sources.original_pdf_path) or None if R2 isn't
    configured. Never raises for a missing configuration — only for an actual
    upload failure once we've committed to trying."""
    if not _is_configured():
        return None
    client = _get_client()
    client.upload_file(
        str(local_path),
        settings.r2_bucket_name,
        key,
        ExtraArgs={"ContentType": "application/pdf"},
    )
    log.info("Uploaded %s -> r2://%s/%s", local_path, settings.r2_bucket_name, key)
    return key


def public_url(key: str) -> str | None:
    if not settings.r2_public_base_url:
        return None
    return f"{settings.r2_public_base_url.rstrip('/')}/{key}"
