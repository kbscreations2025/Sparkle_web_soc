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
