"""Course ingestion for curated subjects.

Offline/admin tooling, not part of the running FastAPI service — a curator
runs `ingest-course <dir>` against a course directory of PDFs organized by
week, then `publish-course <slug>` once the extracted content has been
reviewed. See QuestLogic_Curated_Subjects_Design.md for the design.
"""
