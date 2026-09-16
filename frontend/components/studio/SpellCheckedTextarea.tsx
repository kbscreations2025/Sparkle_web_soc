"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { addLexiconTerm, checkSpelling, type SpellIssue } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * A textarea that checks its own spelling.
 *
 * Misspellings get a red wavy underline, and the corrections for whichever one
 * the caret is sitting in appear as you type — navigable with ↑/↓, accepted
 * with Tab, dismissed with Esc, so a correction never requires reaching for the
 * mouse. Clicking an underlined word opens the same list.
 *
 * Covers ordinary English as well as jewellery vocabulary — the dictionaries
 * are Hunspell's, so "recieve" and "seperate" are caught exactly as they would
 * be anywhere else.
 *
 * The underlines are drawn by a mirror of the text sitting *behind* a
 * transparent textarea, not by an editor library. The mirror renders the same
 * string with the same typography and its text fully transparent, so all that
 * shows through is the underline decoration on the flagged ranges, while the
 * textarea on top stays an ordinary textarea — native caret, native undo,
 * native selection. Both layers must keep identical font, padding and width or
 * the two copies drift apart, which is why the shared classes below are one
 * constant rather than two lists.
 */

/** Idle time after the last keystroke before the text is checked. */
const CHECK_DEBOUNCE_MS = 500;

/**
 * Typography and box metrics both layers must agree on exactly. Anything that
 * affects where a character lands belongs here, not on one layer alone — which
 * is also why a caller overrides this for *both* layers through `textClassName`
 * rather than styling the textarea alone.
 */
const SHARED_TEXT_CLASSES = "w-full p-2 pb-1 text-[13px] leading-relaxed whitespace-pre-wrap break-words";

/** Space the suggestion list needs below a word before it gives up and opens above it. */
const LIST_CLEARANCE = 180;

/** Identifies one flagged word, so dismissing it survives the offsets shifting. */
const issueKey = (issue: SpellIssue) => `${issue.from}:${issue.word}`;

export function SpellCheckedTextarea({
  value,
  onChange,
  placeholder,
  maxLength,
  rows = 4,
  disabled,
  className,
  textClassName = SHARED_TEXT_CLASSES,
  autoGrowMaxHeight,
  onKeyDown,
  onPaste,
  onIssueCount,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  rows?: number;
  disabled?: boolean;
  className?: string;
  /** Metrics applied to the textarea *and* its underline mirror. Override both or neither. */
  textClassName?: string;
  /** Grows with its content up to this many pixels, then scrolls. Omit for a fixed height. */
  autoGrowMaxHeight?: number;
  /** Runs only for keys the suggestion list didn't claim, so Enter-to-send still works. */
  onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste?: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  /** How many misspellings are currently showing — for a count beside the label. */
  onIssueCount?: (count: number) => void;
}) {
  const [rawIssues, setRawIssues] = useState<SpellIssue[]>([]);
  /** Words added or ignored this session — never underlined again. */
  const [suppressed, setSuppressed] = useState<Set<string>>(new Set());
  /** Where the caret is, which decides whose corrections are showing. */
  const [caret, setCaret] = useState<number | null>(null);
  /** The one flagged word Esc closed — reopens once the caret leaves and returns. */
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  /** Which word `activeIndex` belongs to, so it resets when the list changes. */
  const [highlightedFor, setHighlightedFor] = useState<string | null>(null);
  // `top` places the list under the word, `bottom` above it — see the flip below.
  const [anchor, setAnchor] = useState<{ left: number; top?: number; bottom?: number } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  /** Guards against an earlier check's response landing after a later one. */
  const checkSeq = useRef(0);

  // Debounced check. Runs on a typing pause: the dictionaries are server-side,
  // so this is a request, not local work.
  useEffect(() => {
    const seq = ++checkSeq.current;
    const timer = setTimeout(async () => {
      if (!value.trim()) {
        setRawIssues([]);
        return;
      }
      const result = await checkSpelling(value);
      // A stale response would paint underlines at offsets the text no longer has.
      if (seq !== checkSeq.current) return;
      if (result.status === "success" && result.issues) setRawIssues(result.issues);
    }, CHECK_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [value]);

  const issues = useMemo(
    () => rawIssues.filter((issue) => !suppressed.has(issue.word.toLowerCase())),
    [rawIssues, suppressed]
  );

  // Offsets describe the text as it was when checked, so an issue whose word is
  // no longer where it was said to be is dropped rather than drawn in the wrong
  // place — which is what keeps the underlines honest while the text is edited.
  const visibleIssues = useMemo(
    () => issues.filter((issue) => issue.to <= value.length && value.slice(issue.from, issue.to) === issue.word),
    [issues, value]
  );

  useEffect(() => {
    onIssueCount?.(visibleIssues.length);
  }, [visibleIssues.length, onIssueCount]);

  /** The flagged word the caret is in — derived, so it follows the text as it changes. */
  const activeIssue = useMemo(() => {
    if (caret == null) return null;
    const hit = visibleIssues.find((issue) => caret >= issue.from && caret <= issue.to);
    if (!hit || hit.suggestions.length === 0) return null;
    return issueKey(hit) === dismissed ? null : hit;
  }, [caret, visibleIssues, dismissed]);

  // A different word means a different list, so the highlight starts at the top.
  // Adjusted during render rather than in an effect: React re-runs this pass
  // before painting, so the highlight is never briefly on the wrong row.
  const activeKey = activeIssue ? issueKey(activeIssue) : null;
  if (activeKey !== highlightedFor) {
    setHighlightedFor(activeKey);
    setActiveIndex(0);
  }

  // Positioned from the mirror's own <mark>, which is already laid out exactly
  // where the word appears. Measuring the DOM and storing the result is what a
  // layout effect is for, so the setState here is deliberate.
  useLayoutEffect(() => {
    const mark = activeIssue
      ? mirrorRef.current?.querySelector<HTMLElement>(`[data-issue="${activeIssue.from}"]`)
      : null;
    const container = containerRef.current;

    let next: { left: number; top?: number; bottom?: number } | null = null;
    if (mark && container) {
      const markBox = mark.getBoundingClientRect();
      const box = container.getBoundingClientRect();
      const left = Math.min(Math.max(0, markBox.left - box.left), Math.max(0, box.width - 232));

      // A composer pinned to the bottom of the screen has no room beneath it,
      // so the list would open off-screen. Anchoring by `bottom` in that case
      // flips it above the word without having to measure its own height.
      const roomBelow = window.innerHeight - markBox.bottom;
      next =
        roomBelow < LIST_CLEARANCE
          ? { left, bottom: box.height - (markBox.top - box.top) + 6 }
          : { left, top: markBox.bottom - box.top + 6 };
    }

    setAnchor(next);
  }, [activeIssue, value]);

  // Grows with the content, then scrolls. The mirror is pinned to the
  // textarea's box, so it follows without measuring anything itself.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !autoGrowMaxHeight) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, autoGrowMaxHeight)}px`;
  }, [value, autoGrowMaxHeight]);

  const suppress = useCallback((word: string) => {
    setSuppressed((current) => new Set(current).add(word.toLowerCase()));
  }, []);

  /** Reads the caret back out of the textarea after any event that can move it. */
  function syncCaret() {
    setCaret(textareaRef.current?.selectionStart ?? null);
  }

  function applyCorrection(issue: SpellIssue, replacement: string) {
    onChange(value.slice(0, issue.from) + replacement + value.slice(issue.to));
    setDismissed(null);

    // Put the caret after what was just inserted, so typing continues where the
    // user left off rather than jumping to wherever the old offset now points.
    const position = issue.from + replacement.length;
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(position, position);
      setCaret(position);
    });
  }

  async function addToDictionary(word: string) {
    // Suppressed immediately; the request only decides whether it also persists
    // for the rest of the organisation.
    suppress(word);
    await addLexiconTerm(word);
  }

  /**
   * The keys that drive the list. Every branch is guarded on a list actually
   * being open, so with nothing showing Tab still moves focus, ↑/↓ still move
   * the caret and Esc still does whatever it did before.
   */
  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    const count = activeIssue?.suggestions.length ?? 0;

    if (activeIssue && count > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        return setActiveIndex((index) => (index + 1) % count);
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        return setActiveIndex((index) => (index - 1 + count) % count);
      }
      if (event.key === "Tab") {
        event.preventDefault();
        return applyCorrection(activeIssue, activeIssue.suggestions[activeIndex]);
      }
      if (event.key === "Escape") {
        event.preventDefault();
        return setDismissed(issueKey(activeIssue));
      }
    }

    // Anything the list didn't claim belongs to the host — Enter-to-send, say.
    onKeyDown?.(event);
  }

  // An outside click closes the list, the same as Esc.
  useEffect(() => {
    if (!activeIssue) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-spell-popover]") || target === textareaRef.current) return;
      setDismissed(issueKey(activeIssue));
    };
    const handle = requestAnimationFrame(() => document.addEventListener("mousedown", onDown));
    return () => {
      cancelAnimationFrame(handle);
      document.removeEventListener("mousedown", onDown);
    };
  }, [activeIssue]);

  /** The text split into plain runs and underlined ones, in document order. */
  const segments = useMemo(() => {
    const parts: { text: string; issue: SpellIssue | null }[] = [];
    let cursor = 0;
    for (const issue of visibleIssues) {
      if (issue.from > cursor) parts.push({ text: value.slice(cursor, issue.from), issue: null });
      parts.push({ text: value.slice(issue.from, issue.to), issue });
      cursor = issue.to;
    }
    parts.push({ text: value.slice(cursor), issue: null });
    return parts;
  }, [value, visibleIssues]);

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {/* Underlines only — the text itself is transparent, since the textarea
          above draws the visible copy. */}
      <div
        ref={mirrorRef}
        aria-hidden
        className={cn(textClassName, "pointer-events-none absolute inset-0 overflow-hidden text-transparent")}
      >
        {segments.map((segment, index) =>
          segment.issue ? (
            <mark
              key={index}
              data-issue={segment.issue.from}
              className="bg-transparent text-transparent decoration-red-400 decoration-wavy underline underline-offset-[3px] [text-decoration-skip-ink:none]"
            >
              {segment.text}
            </mark>
          ) : (
            <span key={index}>{segment.text}</span>
          )
        )}
        {/* A trailing newline is not laid out without something after it, which
            would shift every underline on the last line. */}
        {"​"}
      </div>

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          // Read from the event rather than after render: this is the caret the
          // edit produced, and the list should follow it immediately.
          setCaret(event.target.selectionStart);
          setDismissed(null);
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={syncCaret}
        onClick={syncCaret}
        onPaste={onPaste}
        onBlur={() => setCaret(null)}
        onScroll={(event) => {
          if (mirrorRef.current) mirrorRef.current.scrollTop = event.currentTarget.scrollTop;
        }}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        // Our own underlines replace the browser's, which cannot be taught
        // jewellery terms and would sit under the same words twice.
        spellCheck={false}
        className={cn(
          textClassName,
          "relative resize-none bg-transparent text-cream placeholder:text-faint outline-none disabled:opacity-50"
        )}
      />

      {activeIssue && anchor && (
        <div
          data-spell-popover
          style={{ left: anchor.left, top: anchor.top, bottom: anchor.bottom }}
          // Keeps focus in the textarea, so clicking a correction doesn't blur
          // it and lose the caret this list is anchored to.
          onMouseDown={(event) => event.preventDefault()}
          className="absolute z-40 w-56 rounded-sm border border-white/[0.10] bg-surface-float/70 py-1 shadow-lg shadow-black/25 backdrop-blur-sm"
        >
          <div className="flex items-center justify-between gap-2 px-2.5 py-1">
            <p className="text-[9px] uppercase tracking-widest text-faint">Did you mean</p>

            {/* The only action left on the card. Its label lives in a tooltip so
                the list stays a list of corrections and nothing else. */}
            <span className="group relative flex items-center">
              <span className="pointer-events-none absolute right-full mr-1.5 whitespace-nowrap rounded-sm border border-white/[0.10] bg-surface-raised px-1.5 py-0.5 text-[9px] text-muted opacity-0 transition-opacity group-hover:opacity-100">
                Add to dictionary
              </span>
              <button
                type="button"
                onClick={() => addToDictionary(activeIssue.word)}
                aria-label="Add to dictionary"
                className="flex h-5 w-5 items-center justify-center rounded-md text-faint transition-colors hover:bg-white/[0.06] hover:text-cream"
              >
                <Plus size={11} />
              </button>
            </span>
          </div>

          {activeIssue.suggestions.map((candidate, index) => (
            <button
              key={candidate}
              type="button"
              onClick={() => applyCorrection(activeIssue, candidate)}
              onMouseEnter={() => setActiveIndex(index)}
              className={cn(
                "w-full truncate px-2.5 py-1.5 text-left text-[11px] transition-colors",
                index === activeIndex ? "bg-gold/[0.10] text-gold" : "text-cream hover:text-gold"
              )}
            >
              {candidate}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
