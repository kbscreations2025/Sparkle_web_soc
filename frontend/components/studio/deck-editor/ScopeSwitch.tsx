"use client";

import { chapterName, chapterPages, type PageScope } from "@/lib/deckDesign";
import { cn } from "@/lib/utils";
import type { EditorApi } from "./DeckEditor";

/**
 * "This page · Category · All pages" — which pages a panel's changes reach.
 * Category is the open page's chapter: its cover and the product pages after
 * it. A deck with only one category offers All pages instead.
 */
export function useScope(api: EditorApi, scope: PageScope) {
  const slides = api.design.slides;
  const categoryPages = chapterPages(slides, api.active);
  const hasCategories = categoryPages.length < slides.length;
  const effective: PageScope = scope === "chapter" && !hasCategories ? "all" : scope;
  const reach = effective === "all" ? slides.length : effective === "chapter" ? categoryPages.length : 1;
  const name = chapterName(slides, api.active);
  const description =
    effective === "page" ? `Page ${api.active + 1} only` : effective === "chapter" ? `${reach} pages of “${name}”` : `All ${reach} pages`;
  return { effective, reach, hasCategories, name, description };
}

export function ScopeSwitch({ api, scope, onScope }: { api: EditorApi; scope: PageScope; onScope: (scope: PageScope) => void }) {
  const { hasCategories, name, description } = useScope(api, scope);
  return (
    <div>
      <div className="grid grid-cols-3 gap-0.5 rounded-md bg-black/5 p-0.5 text-[10px]">
        {(
          [
            ["page", "This page"],
            ["chapter", "Category"],
            ["all", "All pages"],
          ] as [PageScope, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => onScope(value)}
            disabled={value === "chapter" && !hasCategories}
            title={value === "chapter" ? (hasCategories ? `Every page of “${name}”` : "This deck has one category — use All pages") : undefined}
            className={cn(
              "rounded py-0.5 transition-colors disabled:opacity-35",
              scope === value ? "bg-white font-medium text-[#5B3FB0] shadow-sm" : "text-black/60 hover:text-black"
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-0.5 truncate text-[9px] text-black/45">{description}</p>
    </div>
  );
}
