// Shared types. Mirrors the v1 schema. Keep aligned with QuestLogic_DB_Schema.md.

export type SubjectSlug = "history" | "economics" | "philosophy" | "curated";
export type CurriculumDepth = "intro" | "intermediate" | "advanced";
export type NodeStatus =
  | "locked"
  | "available"
  | "in_progress"
  | "mastered"
  | "failed";
export type QuestStatus = "active" | "paused" | "completed" | "abandoned";
export type MessageRole = "user" | "assistant" | "system" | "tool";
export type Pipeline = "tutor" | "curriculum" | "grader" | "summary";

/** Where a curriculum_templates row came from. */
export type SourceType = "generated" | "curated";

/**
 * "socratic": ask-then-discover, the model invents both curriculum and
 * teaching content (default for generated quests).
 * "guided": explain-then-check, grounded in a real lecture transcript
 * (curated courses). See QuestLogic_Curated_Subjects_Design.md §4.
 */
export type PedagogyStyle = "socratic" | "guided";

export interface Subject {
  id: string;
  slug: SubjectSlug;
  name: string;
  description: string | null;
  color_hex: string | null;
  icon_slug: string | null;
}

export interface CurriculumNodeSpec {
  /** Unique within the template. Used as a slug. */
  slug: string;
  title: string;
  /** One- or two-sentence learner-facing summary. */
  summary: string;
  /** Slugs of prerequisite nodes. Empty for entry points. */
  prerequisites: string[];
  /** Free-form subject-specific data (timeline span, schools of thought, etc.). */
  content?: Record<string, unknown>;
  estimated_minutes?: number;
}

export interface CurriculumTemplateSpec {
  topic: string;
  depth: CurriculumDepth;
  /** Ordered roughly entry-to-capstone. */
  nodes: CurriculumNodeSpec[];
}

export interface TemplateNodeRow {
  id: string;
  template_id: string;
  slug: string;
  title: string;
  summary: string;
  content: Record<string, unknown>;
  position_x: number | null;
  position_y: number | null;
  order_hint: number;
  depth_level: number;
  estimated_minutes: number | null;
}

export interface QuestRow {
  id: string;
  user_id: string;
  subject_id: string;
  template_id: string;
  title: string;
  status: QuestStatus;
  started_at: string;
  completed_at: string | null;
  last_active_at: string;
}

export interface NodeProgressRow {
  id: string;
  quest_id: string;
  user_id: string;
  template_node_id: string;
  status: NodeStatus;
  attempts: number;
  last_score: string | null;
  best_score: string | null;
  started_at: string | null;
  mastered_at: string | null;
}

export interface ChatMessage {
  role: MessageRole;
  content: string;
}

export interface ChatStreamRequest {
  user_id: string;
  session_id: string;
  quest_id: string;
  node_id: string;
  node_title: string;
  node_summary: string;
  subject_slug: SubjectSlug;
  history: ChatMessage[];
  new_message: string;
  /**
   * True for the synthetic first turn of a node session, fired automatically
   * when a student opens a node with no prior messages. Tells the tutor to
   * lead with an introduction to the topic instead of waiting on the student.
   * `new_message` is empty/ignored when this is set.
   */
  kickoff?: boolean;
  /**
   * Curated-course fields. The browser never sets these — /api/chat/route.ts
   * resolves them server-side from curriculum_templates/curated_lecture_sources/
   * curated_assignments before calling the AI service, so the AI service stays
   * stateless with respect to course content.
   */
  pedagogy_style?: PedagogyStyle;
  transcript?: string | null;
  assignment_instructions?: string | null;
}

/** Instructor/term/institution metadata for a curated course template.
 * Stored in curriculum_templates.course_metadata (JSONB), not columns. */
export interface CourseMetadata {
  instructor?: string;
  term?: string;
  institution?: string;
  course_code?: string;
}

/** One row of /curated — a published curated course. */
export interface CuratedCourseSummary {
  templateId: string;
  slug: string;
  title: string;
  description: string | null;
  metadata: CourseMetadata;
  lectureCount: number;
}

/** One lecture row within a curated course's week list. */
export interface CuratedLectureSummary {
  nodeId: string;
  slug: string;
  title: string;
  summary: string;
  weekNumber: number;
  lectureNumber: number;
  status: NodeStatus;
  hasAssignment: boolean;
}

export interface CurriculumGenerateRequest {
  user_id: string;
  subject_slug: SubjectSlug;
  topic: string;
  depth: CurriculumDepth;
}

export interface CurriculumGenerateResponse {
  template: CurriculumTemplateSpec;
  model: string;
  tokens_in: number;
  tokens_out: number;
}
