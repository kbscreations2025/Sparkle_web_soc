"use client";

import type { CSSProperties } from "react";
import { ArrowUpRight, Mail, MessageCircle, Phone } from "lucide-react";
import { contactHref } from "@/lib/lookbook/media";
import type { ContactButton, ContactCard as ContactCardType, ContactKind, LookbookCard } from "@/lib/lookbook/types";
import { cn } from "@/lib/utils";
import { useEditable, useRender } from "../context";
import { Txt } from "../EditableText";
import { Body, CardFrame, Eyebrow, Title, buttonRadius, cardRadius, justifyFor } from "../parts";

const ICONS: Record<ContactKind, typeof Phone> = { whatsapp: MessageCircle, email: Mail, phone: Phone, link: ArrowUpRight };

/** How a client gets in touch: WhatsApp, email, a call or a link, as buttons. */
export function ContactCard({ card }: { card: ContactCardType }) {
  const editable = useEditable();
  const { style } = card;
  const variant = style.variant;
  const buttons = card.buttons.filter((button) => editable || contactHref(button));

  const text = (
    <div className="flex flex-col gap-3" style={{ alignItems: variant === "panel" ? "flex-start" : justifyFor(style.align) }}>
      <Eyebrow value={card.eyebrow} path={["eyebrow"]} />
      <Title value={card.title} path={["title"]} placeholder="Title" />
      <Body value={card.body} path={["body"]} placeholder="A line inviting them to get in touch" style={{ maxWidth: "46ch", color: "var(--lb-m)" }} />
    </div>
  );

  const list = (
    <div
      className={cn(
        "flex gap-3",
        variant === "inline" ? "flex-wrap" : "w-full max-w-[22rem] flex-col",
        variant === "panel" && "@2xl:ml-auto"
      )}
      style={{ justifyContent: variant === "inline" ? justifyFor(style.align) : undefined }}
    >
      {buttons.map((button, index) => (
        <ContactAction key={button.id} card={card} button={button} primary={index === 0} />
      ))}
    </div>
  );

  if (variant === "panel") {
    return (
      <CardFrame card={card}>
        <div className="grid items-center gap-8 @2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" style={{ textAlign: "left" }}>
          {text}
          {list}
        </div>
      </CardFrame>
    );
  }

  return (
    <CardFrame card={card}>
      <div className="flex flex-col gap-7" style={{ alignItems: justifyFor(style.align) }}>
        {text}
        {list}
      </div>
    </CardFrame>
  );
}

function ContactAction({ card, button, primary }: { card: ContactCardType; button: ContactButton; primary: boolean }) {
  const { theme } = useRender();
  const editable = useEditable();
  const href = contactHref(button);
  const Icon = ICONS[button.kind] ?? ArrowUpRight;
  const radius = buttonRadius(cardRadius(card.style, theme));
  const external = button.kind === "whatsapp" || button.kind === "link";
  const look: CSSProperties = primary
    ? { background: "var(--lb-btn-bg)", color: "var(--lb-btn-fg)", borderRadius: radius, border: "1px solid var(--lb-btn-bg)" }
    : { background: "transparent", color: "var(--lb-h)", borderRadius: radius, border: "1px solid var(--lb-line)" };

  return (
    <a
      href={editable ? undefined : href ?? undefined}
      target={!editable && external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      onClick={editable ? (event) => event.preventDefault() : undefined}
      className="lb-button lb-contact relative justify-center"
      style={look}
    >
      <Icon size={16} strokeWidth={1.6} className="shrink-0" />
      <Txt value={button.label} path={["buttons", button.id, "label"]} placeholder="Button" />
      {editable && !href && (
        <span
          className="lb-ui absolute -right-1.5 -top-1.5 h-3 w-3 rounded-full border-2 border-white bg-amber-500"
          title="Add the number or address in the panel on the right"
        />
      )}
    </a>
  );
}

/**
 * The first working button of a contact card marked "floating", kept in reach
 * at the foot of the screen while the client scrolls. On the public page it
 * is fixed to the screen; in the builder it sticks to the preview's bottom.
 */
export function FloatingContact({ cards }: { cards: LookbookCard[] }) {
  const { mode, theme } = useRender();
  if (mode === "thumbnail") return null;
  const contact = cards.find((card): card is ContactCardType => card.type === "contact" && card.floating && !card.hidden);
  const button = contact?.buttons.find((entry) => contactHref(entry));
  if (!contact || !button) return null;
  const href = contactHref(button)!;
  const Icon = ICONS[button.kind] ?? ArrowUpRight;
  const external = button.kind === "whatsapp" || button.kind === "link";
  const whatsapp = button.kind === "whatsapp";

  return (
    <div
      className={cn("lb-ui pointer-events-none z-30 flex justify-end", mode === "public" ? "fixed inset-x-0 bottom-0" : "sticky bottom-0")}
      style={{ padding: "0 max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) 16px" }}
    >
      <a
        href={mode === "edit" ? undefined : href}
        target={external && mode !== "edit" ? "_blank" : undefined}
        rel={external ? "noopener noreferrer" : undefined}
        className="pointer-events-auto flex items-center gap-2 rounded-full px-5 py-3 text-[14px] font-semibold shadow-[0_12px_30px_-8px_rgba(0,0,0,0.45)] transition-transform hover:scale-[1.03]"
        style={{
          background: whatsapp ? "#25D366" : theme.colors.accent,
          color: whatsapp ? "#06230F" : theme.colors.accentText,
          fontFamily: theme.body,
        }}
      >
        <Icon size={18} strokeWidth={1.8} />
        {button.label || "Contact us"}
      </a>
    </div>
  );
}
