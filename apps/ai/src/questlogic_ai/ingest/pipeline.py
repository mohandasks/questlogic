"""Course ingestion pipeline: course directory -> curriculum_templates graph.

Two supported directory conventions (see design doc §3) — discover_lectures()
picks whichever one matches:

1. week-NN/ subdirectories (original design doc convention):

    courses/cs229-intro-ml/
      course.yaml
      week-01/
        lecture-1.pdf
        assignment.pdf        # optional; attaches to the week's first lecture node
      week-02/
        lecture-1.pdf
        lecture-2.pdf

2. Flat folder, week/lecture encoded in the filename ("Lec<week>.<lecture>.pdf"):

    courses/cs229-intro-ml/
      course.yaml
      Lec1.1.pdf
      Lec2.1.pdf
      Lec2.2.pdf
      Assignment2.pdf          # optional; matches "AssignmentN" / "HWN" / "HomeworkN",
                                # attaches to week N's first lecture

Case-insensitive on both. If any week-NN/ directory exists, convention 1 is
used exclusively; otherwise the whole course_dir is scanned for LecN.M.pdf.

Idempotent by per-lecture checksum: re-running ingestion on an unchanged
directory is a no-op. A changed directory creates a new template version,
leaving any existing active version (and the quests pinned to it) untouched
until `--publish` / `publish-course` flips the new version live.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

import asyncpg
import yaml

from ..db import get_pool
from .drafting import draft_title_and_summary
from .extract import ExtractionError, checksum_bytes, estimate_tokens, extract_pdf_text
from .models import CourseMeta, ExtractedLecture, IngestReport, LectureFile, slugify
from .storage import upload_pdf

log = logging.getLogger(__name__)

_WEEK_DIR_RE = re.compile(r"^week-(\d+)$", re.IGNORECASE)
_LECTURE_FILE_RE = re.compile(r"^lecture-(\d+)\.pdf$", re.IGNORECASE)

# Flat-folder convention: all PDFs directly in course_dir, no week-NN/
# subdirectories. Matches "Lec3.2.pdf", "Lec 3.2.pdf", and "Lecture 3.2.pdf"
# (optional "ture", optional space before the number) -> week 3, lecture 2.
# Real course exports are rarely consistent within a single folder, so this
# is deliberately permissive rather than requiring one exact form. Used
# automatically when no week-NN/ directories are found — see discover_lectures().
_FLAT_LECTURE_RE = re.compile(r"^lec(?:ture)?\s*(\d+)\.(\d+)\.pdf$", re.IGNORECASE)
# "Assignment3.pdf" / "HW3.pdf" / "Homework3.pdf" -> attaches to week 3's
# first lecture. Only matched in flat-folder mode.
_FLAT_ASSIGNMENT_RE = re.compile(r"^(?:assignment|hw|homework)(\d+)\.pdf$", re.IGNORECASE)


class IngestError(RuntimeError):
    pass


async def _require_pool() -> asyncpg.Pool:
    pool = await get_pool()
    if pool is None:
        raise IngestError(
            "DATABASE_URL is not set — the ingestion CLI needs direct Postgres access "
            "(same env var the AI service uses for llm_calls telemetry)."
        )
    return pool


def load_course_yaml(course_dir: Path) -> CourseMeta:
    yaml_path = course_dir / "course.yaml"
    if not yaml_path.is_file():
        raise IngestError(f"{course_dir}: missing course.yaml")
    data = yaml.safe_load(yaml_path.read_text()) or {}
    if "title" not in data:
        raise IngestError(f"{yaml_path}: 'title' is required")
    slug = data.get("slug") or slugify(course_dir.name)
    return CourseMeta(
        slug=slug,
        title=data["title"],
        description=data.get("description"),
        instructor=data.get("instructor"),
        term=data.get("term"),
        institution=data.get("institution"),
        course_code=data.get("course_code"),
        pedagogy_style=data.get("pedagogy_style", "guided"),
    )


def discover_lectures(course_dir: Path) -> list[LectureFile]:
    week_dirs = sorted(
        (d for d in course_dir.iterdir() if d.is_dir() and _WEEK_DIR_RE.match(d.name)),
        key=lambda d: int(_WEEK_DIR_RE.match(d.name).group(1)),  # type: ignore[union-attr]
    )
    if week_dirs:
        return _discover_lectures_week_dirs(week_dirs)
    return _discover_lectures_flat(course_dir)


def _discover_lectures_week_dirs(week_dirs: list[Path]) -> list[LectureFile]:
    """week-NN/lecture-N.pdf convention, one assignment.pdf per week."""
    lectures: list[LectureFile] = []
    for week_dir in week_dirs:
        week_num = int(_WEEK_DIR_RE.match(week_dir.name).group(1))  # type: ignore[union-attr]
        lecture_files = sorted(
            (f for f in week_dir.iterdir() if _LECTURE_FILE_RE.match(f.name)),
            key=lambda f: int(_LECTURE_FILE_RE.match(f.name).group(1)),  # type: ignore[union-attr]
        )
        if not lecture_files:
            log.warning("%s: no lecture-N.pdf files found, skipping week", week_dir)
            continue
        assignment_path = week_dir / "assignment.pdf"
        has_assignment = assignment_path.is_file()
        for i, f in enumerate(lecture_files):
            lecture_num = int(_LECTURE_FILE_RE.match(f.name).group(1))  # type: ignore[union-attr]
            lectures.append(
                LectureFile(
                    week=week_num,
                    lecture_number=lecture_num,
                    pdf_path=f,
                    # Assignment attaches to the first lecture of the week only.
                    assignment_path=assignment_path if i == 0 and has_assignment else None,
                )
            )
    return lectures


def _discover_lectures_flat(course_dir: Path) -> list[LectureFile]:
    """Flat-folder convention: 'Lec3.2.pdf' -> week 3, lecture 2, all files
    directly in course_dir. Optional 'Assignment3.pdf' / 'HW3.pdf' attaches
    to week 3's first lecture."""
    by_week: dict[int, list[tuple[int, Path]]] = {}
    assignments_by_week: dict[int, Path] = {}

    for f in course_dir.iterdir():
        if not f.is_file():
            continue
        if m := _FLAT_LECTURE_RE.match(f.name):
            week, lecture_num = int(m.group(1)), int(m.group(2))
            by_week.setdefault(week, []).append((lecture_num, f))
        elif m := _FLAT_ASSIGNMENT_RE.match(f.name):
            assignments_by_week[int(m.group(1))] = f

    if not by_week:
        raise IngestError(
            f"{course_dir}: no week-NN/ directories and no 'LecN.M.pdf' files found. "
            "Expected either week-01/lecture-1.pdf or a flat 'Lec1.1.pdf' naming."
        )

    lectures: list[LectureFile] = []
    for week in sorted(by_week):
        week_lectures = sorted(by_week[week], key=lambda t: t[0])
        assignment_path = assignments_by_week.get(week)
        for i, (lecture_num, f) in enumerate(week_lectures):
            lectures.append(
                LectureFile(
                    week=week,
                    lecture_number=lecture_num,
                    pdf_path=f,
                    assignment_path=assignment_path if i == 0 and assignment_path else None,
                )
            )
    return lectures


def _extract_lecture(lf: LectureFile) -> ExtractedLecture:
    raw_bytes = lf.pdf_path.read_bytes()
    text = extract_pdf_text(lf.pdf_path)
    return ExtractedLecture(
        text=text,
        token_count=estimate_tokens(text),
        checksum=checksum_bytes(raw_bytes),
    )


async def _existing_template(conn: asyncpg.Connection, slug: str) -> asyncpg.Record | None:
    return await conn.fetchrow(
        """SELECT id, version, status FROM curriculum_templates
           WHERE slug = $1 AND status IN ('draft', 'active')
           ORDER BY version DESC LIMIT 1""",
        slug,
    )


async def _existing_checksums(conn: asyncpg.Connection, template_id: str) -> list[str]:
    rows = await conn.fetch(
        """SELECT cls.checksum
           FROM curated_lecture_sources cls
           JOIN template_nodes tn ON tn.id = cls.template_node_id
           WHERE tn.template_id = $1
           ORDER BY tn.order_hint""",
        template_id,
    )
    return [r["checksum"] for r in rows]


async def _curated_subject_id(conn: asyncpg.Connection) -> str:
    row = await conn.fetchrow("SELECT id FROM subjects WHERE slug = 'curated'")
    if not row:
        raise IngestError(
            "No 'curated' subject row found — run migration 0004_curated_courses.sql first."
        )
    return row["id"]


async def ingest_course(course_dir: Path, *, publish: bool = False) -> IngestReport:
    course = load_course_yaml(course_dir)
    lectures = discover_lectures(course_dir)

    warnings: list[str] = []
    extracted: list[ExtractedLecture] = []
    for lf in lectures:
        try:
            extracted.append(_extract_lecture(lf))
        except ExtractionError as e:
            raise IngestError(str(e)) from e

    pool = await _require_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            subject_id = await _curated_subject_id(conn)
            existing = await _existing_template(conn, course.slug)

            if existing is not None:
                old_checksums = await _existing_checksums(conn, existing["id"])
                new_checksums = [e.checksum for e in extracted]
                if old_checksums == new_checksums:
                    if publish and existing["status"] != "active":
                        await _publish_version(conn, course.slug, existing["id"])
                        return IngestReport(
                            slug=course.slug,
                            version=existing["version"],
                            published=True,
                            lecture_count=len(lectures),
                            unchanged=True,
                        )
                    return IngestReport(
                        slug=course.slug,
                        version=existing["version"],
                        published=existing["status"] == "active",
                        lecture_count=len(lectures),
                        unchanged=True,
                    )
                new_version = existing["version"] + 1
            else:
                new_version = 1

            content_hash = f"curated:{course.slug}:v{new_version}"
            template_id = await conn.fetchval(
                """INSERT INTO curriculum_templates
                     (subject_id, topic, depth, content_hash, version, status,
                      generator_model, source_type, pedagogy_style, course_metadata, slug)
                   VALUES ($1,$2,NULL,$3,$4,'draft','curated:v1','curated',$5,$6,$7)
                   RETURNING id""",
                subject_id,
                course.title,
                content_hash,
                new_version,
                course.pedagogy_style,
                json.dumps(course.metadata_dict()),
                course.slug,
            )

            await _insert_nodes_and_edges(
                conn, template_id=template_id, lectures=lectures, extracted=extracted
            )

            if publish:
                await _publish_version(conn, course.slug, template_id)

            return IngestReport(
                slug=course.slug,
                version=new_version,
                published=publish,
                lecture_count=len(lectures),
                warnings=warnings,
            )


async def _insert_nodes_and_edges(
    conn: asyncpg.Connection,
    *,
    template_id: str,
    lectures: list[LectureFile],
    extracted: list[ExtractedLecture],
) -> None:
    """Inserts one template_node + curated_lecture_source (+ optional
    curated_assignment) per lecture, in order, and chains them with a linear
    template_edges prerequisite (week N -> week N+1) — see design doc §2 on
    why a straight chain is the right default for a fixed course sequence."""
    prev_node_id: str | None = None
    for order_hint, (lf, ex) in enumerate(zip(lectures, extracted, strict=True)):
        if lf.title:
            title, summary = lf.title, lf.summary or ""
        else:
            title, summary = await draft_title_and_summary(
                ex.text, fallback_title=f"Week {lf.week}: Lecture {lf.lecture_number}"
            )

        node_id = await conn.fetchval(
            """INSERT INTO template_nodes
                 (template_id, slug, title, summary, content, order_hint,
                  depth_level, estimated_minutes)
               VALUES ($1,$2,$3,$4,$5,$6,$7,NULL)
               RETURNING id""",
            template_id,
            lf.node_slug,
            title,
            summary,
            json.dumps({"week_number": lf.week, "lecture_number": lf.lecture_number}),
            order_hint,
            0 if prev_node_id is None else 1,
        )

        if prev_node_id is not None:
            await conn.execute(
                """INSERT INTO template_edges (template_id, from_node_id, to_node_id)
                   VALUES ($1,$2,$3)""",
                template_id,
                prev_node_id,
                node_id,
            )

        pdf_key = None
        if lf.pdf_path.is_file():
            pdf_key = upload_pdf(
                local_path=lf.pdf_path,
                key=f"curated/{template_id}/{lf.node_slug}.pdf",
            )
        await conn.execute(
            """INSERT INTO curated_lecture_sources
                 (template_node_id, week_number, lecture_number, original_pdf_path,
                  raw_text, token_count, checksum)
               VALUES ($1,$2,$3,$4,$5,$6,$7)""",
            node_id,
            lf.week,
            lf.lecture_number,
            pdf_key,
            ex.text,
            ex.token_count,
            ex.checksum,
        )

        if lf.assignment_path is not None:
            instructions = extract_pdf_text(lf.assignment_path)
            assignment_pdf_key = upload_pdf(
                local_path=lf.assignment_path,
                key=f"curated/{template_id}/{lf.node_slug}-assignment.pdf",
            )
            await conn.execute(
                """INSERT INTO curated_assignments
                     (template_node_id, title, instructions, original_pdf_path)
                   VALUES ($1,$2,$3,$4)""",
                node_id,
                f"Week {lf.week} assignment",
                instructions,
                assignment_pdf_key,
            )

        prev_node_id = node_id


async def _publish_version(conn: asyncpg.Connection, slug: str, template_id: str) -> None:
    await conn.execute(
        """UPDATE curriculum_templates SET status = 'deprecated'
           WHERE slug = $1 AND id != $2 AND status = 'active'""",
        slug,
        template_id,
    )
    await conn.execute(
        "UPDATE curriculum_templates SET status = 'active' WHERE id = $1", template_id
    )


async def publish_course(slug: str) -> IngestReport:
    pool = await _require_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """SELECT id, version FROM curriculum_templates
                   WHERE slug = $1 AND status = 'draft'
                   ORDER BY version DESC LIMIT 1""",
                slug,
            )
            if not row:
                raise IngestError(f"No draft template found for slug '{slug}'")
            node_count = await conn.fetchval(
                "SELECT count(*) FROM template_nodes WHERE template_id = $1", row["id"]
            )
            await _publish_version(conn, slug, row["id"])
            return IngestReport(
                slug=slug, version=row["version"], published=True, lecture_count=node_count
            )
