"""Data shapes shared across the ingestion pipeline."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path


def slugify(s: str) -> str:
    s = s.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return re.sub(r"-{2,}", "-", s).strip("-")[:80]


@dataclass
class CourseMeta:
    """Parsed from a course directory's course.yaml."""

    slug: str
    title: str
    description: str | None = None
    instructor: str | None = None
    term: str | None = None
    institution: str | None = None
    course_code: str | None = None
    pedagogy_style: str = "guided"  # 'guided' or 'socratic' — see design doc §4.1

    def metadata_dict(self) -> dict:
        return {
            k: v
            for k, v in {
                "instructor": self.instructor,
                "term": self.term,
                "institution": self.institution,
                "course_code": self.course_code,
            }.items()
            if v
        }


@dataclass
class LectureFile:
    """One discovered lecture PDF (plus an optional assignment PDF for its week)."""

    week: int
    lecture_number: int
    pdf_path: Path
    assignment_path: Path | None = None
    # Optional overrides from course.yaml (week entries), else drafted by the
    # cheap-tier LLM from the transcript at ingestion time.
    title: str | None = None
    summary: str | None = None

    @property
    def node_slug(self) -> str:
        return f"week-{self.week:02d}-lecture-{self.lecture_number}"


@dataclass
class ExtractedLecture:
    text: str
    token_count: int
    checksum: str


@dataclass
class IngestReport:
    slug: str
    version: int
    published: bool
    lecture_count: int
    unchanged: bool = False
    warnings: list[str] = field(default_factory=list)
