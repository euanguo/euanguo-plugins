/**
 * The one question this sidebar asks outside its own dialogs.
 *
 * Un-settling takes bb's archive off a thread, and it runs on the thread's host.
 * A host that is offline refuses, and the failure is the worst kind: bb keeps
 * the thread archived, the thread leaves the sidebar, and nothing on screen says
 * why. The README has had a paragraph about it since the feature landed —
 * "un-settling did not bring the thread back" — because there was no better
 * answer than telling the user to go and unarchive it in bb by hand.
 *
 * Now the backend asks. `bb.ui.requestInput` blocks until the app answers, and
 * the `pendingInteraction` slot renders the question, so the retry is a button
 * rather than a paragraph of instructions.
 *
 * The payload is deliberately tiny and the codec is here, pure and tested, for
 * the usual reason: what crosses the wire is parsed rather than trusted, and a
 * payload this build cannot read is dismissed instead of rendered as blanks.
 */

/** The renderer id the backend raises and the slot registers under. */
export const UNARCHIVE_RETRY_RENDERER_ID = "unarchive-retry";

/**
 * How long the question waits for an answer.
 *
 * Shorter than the host's own one-hour cap: a prompt about a thread the user has
 * since moved on from is worse than no prompt, and the failure is recoverable
 * from bb's archived view whenever they get to it.
 */
export const UNARCHIVE_RETRY_TIMEOUT_MS = 10 * 60 * 1_000;

export interface UnarchiveRetryPayload {
  readonly threadId: string;
  /** What bb said when it refused, shown to the user rather than paraphrased. */
  readonly message: string;
}

/** The longest message worth carrying to a prompt, and the id's own bound. */
const MAX_MESSAGE_LENGTH = 400;
const MAX_ID_LENGTH = 200;

export function unarchiveRetryPayload(
  input: UnarchiveRetryPayload,
): UnarchiveRetryPayload {
  return {
    threadId: input.threadId,
    message: input.message.slice(0, MAX_MESSAGE_LENGTH),
  };
}

export function parseUnarchiveRetryPayload(
  value: unknown,
): UnarchiveRetryPayload | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("threadId" in value) || typeof value.threadId !== "string") return null;
  if (value.threadId.length === 0 || value.threadId.length > MAX_ID_LENGTH) {
    return null;
  }
  const message =
    "message" in value && typeof value.message === "string"
      ? value.message.slice(0, MAX_MESSAGE_LENGTH)
      : "";
  return { threadId: value.threadId, message };
}

/** The value a submission carries to mean "try again". */
export const UNARCHIVE_RETRY_APPROVAL = "retry";

/**
 * Whether an answer means "try again".
 *
 * One function rather than a decision plus an approval, because the two
 * questions are the same question: a prompt that timed out, a user who closed
 * it, and a submission carrying something else all mean the same thing to the
 * caller — do not touch bb's archive again on the strength of it.
 */
export function unarchiveRetryApproved(
  result: { readonly outcome?: unknown; readonly value?: unknown } | null | undefined,
): boolean {
  return (
    result?.outcome === "submitted" && result.value === UNARCHIVE_RETRY_APPROVAL
  );
}