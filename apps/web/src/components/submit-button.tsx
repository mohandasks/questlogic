"use client";

import { useFormStatus } from "react-dom";

interface Props {
  idleLabel: string;
  pendingLabel: string;
  className?: string;
}

/**
 * Submit button that lights up a spinner + custom label while its parent
 * <form action={serverAction}> is in-flight. Uses React's useFormStatus —
 * must be rendered inside a <form>.
 */
export function SubmitButton({ idleLabel, pendingLabel, className }: Props) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={className ?? "btn btn-primary justify-self-start"}
      aria-busy={pending}
    >
      {pending ? (
        <span className="flex items-center gap-2">
          <Spinner />
          {pendingLabel}
        </span>
      ) : (
        idleLabel
      )}
    </button>
  );
}

function Spinner() {
  return (
    <span
      className="ql-spinner inline-block h-4 w-4 rounded-full"
      aria-hidden="true"
    />
  );
}
