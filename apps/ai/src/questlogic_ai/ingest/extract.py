"""PDF text extraction and cleanup.

Assumes text-based PDFs (real transcripts, not scans). A scanned/image-only
PDF will extract to near-empty text — we detect that and raise rather than
silently ingesting garbage; OCR is out of scope for v1 (see design doc §8).
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

import pdfplumber

# Lines that are almost certainly running headers/footers/page numbers, not
# lecture content: bare page numbers, "Page N of M", repeated course-code
# headers. Heuristic, not exhaustive — reviewed by a human before publish.
_PAGE_NUMBER_RE = re.compile(r"^\s*(page\s+)?\d{1,4}(\s*(of|/)\s*\d{1,4})?\s*$", re.IGNORECASE)
_MIN_CHARS_PER_PAGE_FOR_TEXT_PDF = 40


class ExtractionError(RuntimeError):
    pass


def checksum_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def extract_pdf_text(path: Path) -> str:
    """Extracts and cleans text from a PDF. Raises ExtractionError if the PDF
    looks like a scan (near-zero extractable text) rather than silently
    returning near-empty content."""
    with pdfplumber.open(path) as pdf:
        pages = [p.extract_text() or "" for p in pdf.pages]

    if not pages:
        raise ExtractionError(f"{path}: no pages found")

    avg_chars = sum(len(p) for p in pages) / len(pages)
    if avg_chars < _MIN_CHARS_PER_PAGE_FOR_TEXT_PDF:
        raise ExtractionError(
            f"{path}: only {avg_chars:.0f} chars/page extracted on average — "
            "this looks like a scanned/image-only PDF. OCR isn't supported yet; "
            "skip this file or run it through OCR first."
        )

    return _clean(pages)


def _clean(pages: list[str]) -> str:
    cleaned_pages: list[str] = []
    for page in pages:
        lines = [ln for ln in page.splitlines() if not _PAGE_NUMBER_RE.match(ln)]
        text = "\n".join(lines)
        # Fix the most common PDF-extraction artifact: words hyphenated across
        # a line break ("exam-\nple" -> "example").
        text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)
        # Collapse runs of blank lines but keep paragraph breaks.
        text = re.sub(r"\n{3,}", "\n\n", text)
        cleaned_pages.append(text.strip())
    return "\n\n".join(p for p in cleaned_pages if p)


def estimate_tokens(text: str) -> int:
    """Rough ~4 chars/token estimate — same convention used elsewhere in the
    codebase (apps/web's estimateTokens). Good enough for ingestion-time
    sizing decisions; real usage is always provider-reported at tutor time."""
    return max(1, len(text) // 4)
