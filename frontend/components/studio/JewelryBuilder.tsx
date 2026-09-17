"use client";

import { useCallback, useMemo, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import {
  DEFAULT_JEWELRY_TYPE,
  buildJewelryConfigurator,
  buildJewelryPrompt,
  clearJewelryTypeDependentSelections,
} from "@/lib/jewelryConfigurator";
import { Chip } from "./OptionChips";
import { cn } from "@/lib/utils";

/**
 * The structured half of a brief: pick a type, a metal, a stone, and the words
 * are written for you.
 *
 * Text to Image and Text to Sketch had a copy of this each — the same panel,
 * the same state, the same prompt assembly, differing only in a line of
 * subtitle. They had already drifted apart in their group padding by the time
 * this was extracted.
 */

/** The builder's state and the two derived values a page actually consumes. */
export function useJewelryBuilder() {
  const [selections, setSelections] = useState<Record<string, string>>({ jewelryType: DEFAULT_JEWELRY_TYPE });

  const groups = useMemo(() => buildJewelryConfigurator(selections.jewelryType), [selections.jewelryType]);

  const toggle = useCallback((key: string, value: string) => {
    setSelections((current) => {
      // Picking the active option again clears it, so a group can be emptied
      // without a separate control.
      const next = { ...current, [key]: current[key] === value ? "" : value };
      // Changing the type invalidates everything that hangs off it — a ring's
      // setting styles mean nothing once it is a bangle.
      return key === "jewelryType" ? clearJewelryTypeDependentSelections(next) : next;
    });
  }, []);

  const clear = useCallback(() => setSelections({}), []);

  return {
    selections,
    groups,
    toggle,
    clear,
    /** The brief these selections spell out, ready to join with free text. */
    text: buildJewelryPrompt(selections),
    selectedCount: Object.values(selections).filter(Boolean).length,
  };
}

export type JewelryBuilderController = ReturnType<typeof useJewelryBuilder>;

/** The panel itself: a collapsible group per facet of the design. */
export function JewelryBuilder({
  builder,
  subtitle,
  onClear,
}: {
  builder: JewelryBuilderController;
  subtitle: string;
  /** Runs alongside clearing the selections — a page also clears its own free text. */
  onClear?: () => void;
}) {
  const { selections, groups, toggle, clear, selectedCount } = builder;

  // Only the first few open, so the panel starts readable rather than as one
  // long wall of chips. Keyed by group, so reopening survives a type change.
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(groups.slice(0, 3).map((group) => [group.key, true]))
  );

  return (
    <div className="flex w-full shrink-0 flex-col border-b border-white/[0.05] md:h-full md:w-3/5 md:overflow-hidden md:border-b-0 md:border-r">
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.05] px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-cream">Jewelry Builder</p>
          <p className="mt-0.5 truncate text-[10px] text-faint">{subtitle}</p>
        </div>

        {selectedCount > 0 && (
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="rounded-full border border-gold/20 bg-gold/10 px-1.5 py-0.5 text-[9px] font-semibold text-gold/80">
              {selectedCount}
            </span>
            <button
              type="button"
              onClick={() => {
                clear();
                onClear?.();
              }}
              aria-label="Clear all selections"
              className="flex h-8 w-8 items-center justify-center text-faint transition-colors hover:text-muted"
            >
              <X size={12} />
            </button>
          </div>
        )}
      </div>

      <div className="md:flex-1 md:overflow-y-auto">
        {groups.map((group) => {
          const active = selections[group.key];
          const open = expanded[group.key];

          return (
            <div key={group.key} className="border-b border-white/[0.04]">
              <button
                type="button"
                onClick={() => setExpanded((current) => ({ ...current, [group.key]: !current[group.key] }))}
                aria-expanded={Boolean(open)}
                className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors hover:bg-white/[0.02]"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="text-[11px] font-medium text-cream">{group.label}</span>
                  {active && (
                    <span className="max-w-[100px] truncate rounded-full border border-gold/20 bg-gold/10 px-1.5 py-0.5 text-[9px] text-gold/80">
                      {active}
                    </span>
                  )}
                </span>
                <ChevronRight size={11} className={cn("shrink-0 text-faint transition-transform", open && "rotate-90")} />
              </button>

              {open && (
                <div className="flex flex-wrap gap-1.5 px-3 pb-3">
                  {group.options.map((option) => (
                    <Chip
                      key={option}
                      label={option}
                      size="sm"
                      active={selections[group.key] === option}
                      onClick={() => toggle(group.key, option)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * What the builder currently spells out, as removable chips.
 *
 * Shown beside the description rather than in the panel: the panel is where
 * choices are made, this is where the resulting brief is checked at a glance.
 */
export function JewelrySelectionChips({ builder }: { builder: JewelryBuilderController }) {
  const { selections, groups, toggle, selectedCount } = builder;
  if (selectedCount === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wider text-cream">Selected</p>
      <div className="flex flex-wrap gap-1.5">
        {groups.map((group) =>
          selections[group.key] ? (
            <span
              key={group.key}
              className="flex items-center gap-1 rounded-full border border-gold/20 bg-gold/[0.07] px-2 py-1 text-[10px] text-gold/80"
            >
              <span className="text-faint">{group.label}:</span> {selections[group.key]}
              <button
                type="button"
                onClick={() => toggle(group.key, selections[group.key])}
                aria-label={`Remove ${group.label}`}
                className="ml-0.5 transition-colors hover:text-gold"
              >
                <X size={9} />
              </button>
            </span>
          ) : null
        )}
      </div>
    </div>
  );
}
