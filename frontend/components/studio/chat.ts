/**
 * One turn in a chat-style edit thread. Not text-only: a turn usually carries
 * the image it attached or produced, which is what `ChatMessages` renders
 * inline as part of the bubble rather than as a separate gallery.
 *
 * Shared type so any tool built as a chat (not just Chat to Edit) renders
 * through the same `ChatMessages`/`ChatInputBar` pair.
 */
export type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** The image this turn attached (user) or produced (assistant). */
  image?: string;
  /**
   * Every image an assistant turn produced, when it made more than one — Text
   * to Image asks for several variations at once. `image` stays the first of
   * them, so a tool that only ever produces one can keep ignoring this.
   */
  images?: string[];
  /** Reference images attached alongside `image`, inspiration only. */
  refImages?: string[];
  /** Present only on a failed assistant turn — what to restore if the user retries. */
  retryInstruction?: string;
  retryImage?: string;
  retryRefImages?: string[];
};

/**
 * The images a recorded turn was given, in a user bubble's shape: what the
 * turn worked on shown large, references small. Used wherever a thread is
 * rebuilt from History, so a reopened chat shows the same inputs a live one did.
 *
 * On a refinement the thing worked on is the "edited" input — whichever
 * result was picked, possibly one of several variations, possibly marked
 * up. It is shown on the turn rather than assumed from the answer above,
 * because with more than one variation the answer above does not say which.
 */
export function turnImages(inputs: { url: string; role: string }[]): Pick<ChatMsg, "image" | "refImages"> {
  const shown = inputs.filter((asset) => asset.url);
  const primary = shown.filter((asset) => asset.role !== "reference").map((asset) => asset.url);
  const references = shown.filter((asset) => asset.role === "reference").map((asset) => asset.url);
  const [image, ...rest] = [...primary, ...references];
  return { image, refImages: rest.length ? rest : undefined };
}
