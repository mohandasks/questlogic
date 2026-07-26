"use client";

import { useMemo, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import type { SubjectSlug, CurriculumDepth } from "@questlogic/shared";

const POPULAR_TOPICS: Record<SubjectSlug, string[]> = {
  history: [
    "The fall of the Roman Republic",
    "Causes of World War I",
    "The Cold War",
    "The French Revolution",
    "The Silk Road",
    "European colonization of the Americas",
    "The Industrial Revolution",
    "The fall of the Berlin Wall",
  ],
  economics: [
    "Supply and demand",
    "Inflation and monetary policy",
    "Game theory basics",
    "Behavioral economics",
    "International trade and tariffs",
    "Market failures and externalities",
    "The 2008 financial crisis",
    "Cryptocurrency and monetary theory",
  ],
  philosophy: [
    "Plato's Allegory of the Cave",
    "The trolley problem",
    "Existentialism",
    "Free will vs. determinism",
    "Utilitarianism vs. deontology",
    "Philosophy of mind",
    "Stoicism",
    "Nietzsche's Übermensch",
  ],
};

export function NewQuestForm({
  action,
}: {
  action: (formData: FormData) => Promise<never>;
}) {
  const [subject, setSubject] = useState<SubjectSlug>("history");
  const [topic, setTopic] = useState("");

  const examples = useMemo(() => POPULAR_TOPICS[subject], [subject]);

  return (
    <form action={action} className="mt-8 grid gap-5">
      <div>
        <label className="text-sm text-mute">Subject</label>
        <select
          name="subject"
          required
          value={subject}
          onChange={(e) => setSubject(e.target.value as SubjectSlug)}
          className="mt-1 w-full rounded-lg border border-border bg-panel p-3"
        >
          <option value="history">History</option>
          <option value="economics">Economics</option>
          <option value="philosophy">Philosophy</option>
        </select>
      </div>

      <div>
        <label className="text-sm text-mute">Topic</label>
        <input
          name="topic"
          required
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          list="topic-suggestions"
          placeholder={`e.g. ${examples[0]}`}
          className="mt-1 w-full rounded-lg border border-border bg-panel p-3"
        />
        <datalist id="topic-suggestions">
          {examples.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>

        <div className="mt-2 flex flex-wrap gap-2">
          {examples.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTopic(t)}
              className="chip hover:border-accent"
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-sm text-mute">Depth</label>
        <select
          name="depth"
          defaultValue={"intro" satisfies CurriculumDepth}
          className="mt-1 w-full rounded-lg border border-border bg-panel p-3"
        >
          <option value="intro">Intro</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
        </select>
      </div>

      <SubmitButton
        idleLabel="Generate quest"
        pendingLabel="Generating skill tree…"
      />
      <p className="text-xs text-mute ql-pulse">
        First-time generation takes ~10–20 seconds. Repeat topics load
        instantly.
      </p>
    </form>
  );
}
