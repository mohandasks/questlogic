// Shared types. Mirrors the v1 schema. Keep aligned with QuestLogic_DB_Schema.md.

export type SubjectSlug = "history" | "economics" | "philosophy";
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
