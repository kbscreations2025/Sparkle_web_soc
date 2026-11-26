"use client";

import { useLayoutEffect, useRef, type CSSProperties, type ElementType, type KeyboardEvent } from "react";
import { setIn, type Path } from "@/lib/lookbook/edit";
import { cn } from "@/lib/utils";
import { useCard, useEditable, useRender } from "./context";

type TxtProps = {
  value: string;
  /** Where in the card this text lives, e.g. ["title"] or ["rows", rowId, "price"]. */
  path: Path;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  /** Lets Enter start a new line. Single-line fields end editing on Enter instead. */
  multiline?: boolean;
  /** Shown, faintly, while an editable field is empty. */
  placeholder?: string;
  /** Render even when empty outside the editor (a table cell keeps its place). */
  keepEmpty?: boolean;
  maxLength?: number;
};

/**
 * A piece of a card's text. On the public page it is plain text. In the
 * builder it is typed into where it stands, with the page's own fonts and
 * colours, so what is being written is exactly what will be seen.
 */
export function Txt({ value, path, as: Tag = "span", className, style, multiline, placeholder, keepEmpty, maxLength = 3000 }: TxtProps) {
  const editable = useEditable();
  if (!editable) {
    if (!value && !keepEmpty) return null;
    return (
      <Tag className={cn(multiline && "whitespace-pre-line", className)} style={style}>
        {value}
      </Tag>
    );
  }
  return (
    <EditableText
      value={value}
      path={path}
      as={Tag}
      className={className}
      style={style}
      multiline={multiline}
      placeholder={placeholder}
      maxLength={maxLength}
    />
  );
}

function EditableText({ value, path, as: Tag = "span", className, style, multiline, placeholder, maxLength }: TxtProps) {
  const { editor } = useRender();
  const card = useCard();
  const ref = useRef<HTMLElement>(null);
  /** What this field last reported, so an echo of its own edit doesn't rewrite it under the caret. */
  const reported = useRef<string | null>(null);

  // The DOM is the source of truth while typing. It is rewritten from the
  // document only when the value changed from elsewhere (undo, the inspector,
  // a template), never in response to this field's own keystrokes, which
  // would throw the caret back to the start.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || value === reported.current) return;
    // Plain text, newlines kept as they are: the field is `pre-wrap`, so they show as breaks.
    if (readText(element) !== value) element.textContent = value;
    reported.current = value;
  }, [value]);

  const key = `${card.id}:${path.join(".")}`;

  function report() {
    const element = ref.current;
    if (!element || !editor) return;
    let text = readText(element);
    if (maxLength && text.length > maxLength) {
      text = text.slice(0, maxLength);
      element.textContent = text;
    }
    reported.current = text;
    editor.updateCard(card.id, (current) => setIn(current, path, text), `text:${key}`);
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" || (event.key === "Enter" && !multiline)) {
      event.preventDefault();
      ref.current?.blur();
    }
  }

  return (
    <Tag
      ref={ref}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck
      role="textbox"
      aria-multiline={multiline || undefined}
      aria-label={placeholder}
      data-placeholder={placeholder}
      onInput={report}
      onKeyDown={onKeyDown}
      onPaste={(event: React.ClipboardEvent<HTMLElement>) => {
        // `plaintext-only` already pastes plain text; this covers a browser without it.
        event.preventDefault();
        const text = event.clipboardData.getData("text/plain");
        document.execCommand("insertText", false, multiline ? text : text.replace(/\s*\n\s*/g, " "));
      }}
      onDrop={(event: React.DragEvent) => event.preventDefault()}
      className={cn("lb-editable cursor-text whitespace-pre-wrap outline-none", className)}
      style={style}
    />
  );
}

/**
 * The words as typed. Not `innerText`, which returns them as styled: a title
 * set in capitals by the theme would be saved in capitals, and stay that way
 * after the theme changed. Line breaks are read from whatever the browser
 * made of Enter (a newline, a <br> or a new block), and the stray one a
 * browser leaves at the end is dropped.
 */
function readText(element: HTMLElement) {
  let text = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.nodeValue ?? "";
      return;
    }
    if (node.nodeName === "BR") {
      text += "\n";
      return;
    }
    const block = node !== element && (node.nodeName === "DIV" || node.nodeName === "P");
    if (block && text && !text.endsWith("\n")) text += "\n";
    node.childNodes.forEach(walk);
  };
  walk(element);
  return text.replace(/\n$/, "");
}
