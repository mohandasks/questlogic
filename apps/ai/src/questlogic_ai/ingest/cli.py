"""CLI entry points, installed as `ingest-course` / `publish-course` (see
pyproject.toml [project.scripts]). Run from apps/ai with the venv active:

    uv run ingest-course courses/cs229-intro-ml
    uv run ingest-course courses/cs229-intro-ml --publish
    uv run publish-course cs229-intro-ml
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

from .models import IngestReport
from .pipeline import IngestError, ingest_course, publish_course

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger(__name__)


def _print_report(report: IngestReport) -> None:
    if report.unchanged:
        state = "unchanged, now published" if report.published else "unchanged"
    else:
        state = "published" if report.published else "ingested as draft"
    print(f"\n{report.slug} v{report.version} — {state} ({report.lecture_count} lectures).")
    if not report.published:
        print(f"Review the content, then run: publish-course {report.slug}")
    for w in report.warnings:
        print(f"  warning: {w}")


def ingest_main() -> None:
    parser = argparse.ArgumentParser(description="Ingest a curated course directory.")
    parser.add_argument("course_dir", type=Path, help="Path to the course directory (contains course.yaml)")
    parser.add_argument(
        "--publish",
        action="store_true",
        help="Make this version live immediately instead of leaving it as a draft for review.",
    )
    args = parser.parse_args()

    if not args.course_dir.is_dir():
        print(f"Not a directory: {args.course_dir}", file=sys.stderr)
        sys.exit(1)

    try:
        report = asyncio.run(ingest_course(args.course_dir, publish=args.publish))
    except IngestError as e:
        print(f"Ingestion failed: {e}", file=sys.stderr)
        sys.exit(1)

    _print_report(report)


def publish_main() -> None:
    parser = argparse.ArgumentParser(
        description="Flip a previously-ingested draft course template live."
    )
    parser.add_argument("slug", help="Course slug (as set in course.yaml, or derived from the directory name)")
    args = parser.parse_args()

    try:
        report = asyncio.run(publish_course(args.slug))
    except IngestError as e:
        print(f"Publish failed: {e}", file=sys.stderr)
        sys.exit(1)

    _print_report(report)


if __name__ == "__main__":
    ingest_main()
