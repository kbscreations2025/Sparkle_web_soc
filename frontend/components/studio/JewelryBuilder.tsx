"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Flame, X } from "lucide-react";
import {
  buildJewelryConfigurator,
  buildJewelryPrompt,
  buildTrendCues,
  FACET_NAMES,
  joinMulti,
  pruneJewelrySelections,
  SELECTION_KEYS,
  splitMulti,
  trendingOptionsFor,
  trendQueryFor,
  TRENDING,
  type ConfiguratorGroup,
} from "@/lib/jewelryConfigurator";
import { fetchTrends, type JewelryTrend, type TrendCue } from "@/lib/api";
import { Chip } from "./OptionChips";
import { cn } from "@/lib/utils";

/**
 * The structured half of a brief: pick who it's for, a type, a metal, a stone,
 * and the words are written for you.
 *
 * Text to Image and Text to Sketch had a copy of this each — the same panel,
 * the same state, the same prompt assembly, differing only in a line of
 * subtitle. They had already drifted apart in their group padding by the time
 * this was extracted.
 *
 * Trends run through the rows. This month's trends for the chosen audience
 * and type (searched on the live web once a month, a curated list until then)
 * put a flame on the options in fashion now, and every row that can follow
 * them offers "Trending" first — left there, each image gets one of that
 * row's in-fashion options. "Trending" as the design style sends each image
 * after a whole current design direction.
 */

type TrendList = {
  trends: JewelryTrend[];
  /** What is in fashion row by row — the flames. */
  trending: Record<string, string[]>;
  /** The server is still searching; asked once more a little later. */
  refreshing: boolean;
};

const NO_TRENDS: JewelryTrend[] = [];
const NO_TRENDING: Record<string, string[]> = {};
/** How long before asking again for a list the server was still searching for. */
const REFRESH_RETRY_MS = 20_000;

/** The builder's state and what a page actually consumes. */
export function useJewelryBuilder() {
  // Starts empty: nothing is chosen for the user. With no type picked the
  // rows fall back to the ring options (see buildJewelryConfigurator), and
  // nothing is written into the brief until something is selected.
  const [selections, setSelections] = useState<Record<string, string>>({});
  const { audience, jewelryType, centerStoneType } = selections;

  const groups = useMemo(() => buildJewelryConfigurator({ audience, jewelryType, centerStoneType }), [audience, jewelryType, centerStoneType]);

  const toggle = useCallback((key: string, value: string) => {
    setSelections((current) => {
      const max = buildJewelryConfigurator(current).find((group) => group.key === key)?.multi ?? 1;
      const values = splitMulti(current[key]);
      // Picking the active option again clears it, so a row can be emptied
      // without a separate control. Past the limit, the oldest pick gives way.
      const nextValue = values.includes(value) ? joinMulti(values.filter((entry) => entry !== value)) : joinMulti([...values, value].slice(-max));
      // A different audience or type changes the rows below — drop what they no longer offer.
      return pruneJewelrySelections({ ...current, [key]: nextValue });
    });
  }, []);

  const clear = useCallback(() => setSelections({}), []);

  // ── this month's trends for the chosen audience and type ──
  const query = useMemo(() => trendQueryFor({ audience, jewelryType }), [audience, jewelryType]);
  const listKey = `${query.audience}|${query.type}`;
  const [lists, setLists] = useState<Record<string, TrendList>>({});
  const list = lists[listKey];
  const loaded = Boolean(list);
  const refreshing = list?.refreshing ?? false;
  /** Requests already sent, by list — so "Women" picked while the same list loads doesn't ask twice. */
  const requested = useRef(new Set<string>());

  useEffect(() => {
    if (loaded && !refreshing) return;
    const attempt = refreshing ? `${listKey}#again` : listKey;
    if (requested.current.has(attempt)) return;

    const timer = setTimeout(
      () => {
        requested.current.add(attempt);
        // Never discarded: the answer is filed under its own list, so it
        // is there when the user comes back to that audience and type.
        void fetchTrends(query).then((res) =>
          setLists((current) => ({
            ...current,
            [listKey]: {
              trends: res.status === "success" ? (res.trends ?? []) : (current[listKey]?.trends ?? []),
              trending: res.status === "success" ? (res.trending ?? {}) : (current[listKey]?.trending ?? {}),
              // Asked again once at most — after that the next visit has it.
              refreshing: attempt === listKey && Boolean(res.refreshing),
            },
          }))
        );
      },
      refreshing ? REFRESH_RETRY_MS : 0
    );
    return () => clearTimeout(timer);
  }, [listKey, loaded, refreshing, query]);

  const trends = list?.trends ?? NO_TRENDS;
  const trending = list?.trending ?? NO_TRENDING;

  /**
   * What each image of a run of `count` is told about the trends — see
   * `buildTrendCues`. Shuffled per run, so generating again explores other
   * trends. Empty when no row is on "Trending".
   */
  const trendCuesFor = useCallback(
    (count: number): TrendCue[] => buildTrendCues({ sel: selections, trends, trending, count }),
    [selections, trends, trending]
  );

  return {
    selections,
    groups,
    toggle,
    clear,
    /** What is in fashion row by row — the flames. */
    trending,
    trendCuesFor,
    /** The brief these selections spell out, ready to join with free text. */
    text: buildJewelryPrompt(selections),
    selectedCount: SELECTION_KEYS.reduce((total, key) => total + splitMulti(selections[key]).length, 0),
  };
}

export type JewelryBuilderController = ReturnType<typeof useJewelryBuilder>;

/** What a row's header shows as picked — with a follow-up pick beside its parent ("Elongated: Kite"). */
function summaryOf(group: ConfiguratorGroup, selections: Record<string, string>) {
  return splitMulti(selections[group.key])
    .map((value) => {
      const row = group.subRows?.find((entry) => entry.when === value);
      return row && selections[row.key] ? `${value}: ${selections[row.key]}` : value;
    })
    .join(" + ");
}

/** What a row's "Trending" choice will do, on hover. */
function trendingHint(group: ConfiguratorGroup, trending: Record<string, string[]>) {
  if (group.key === "designStyle") return "Each image follows a different current design trend";
  const inFashion = trending[group.key] ?? [];
  return inFashion.length
    ? `In fashion now: ${inFashion.join(", ")} — each image uses one`
    : `Each image gets whichever ${FACET_NAMES[group.key]} is in fashion now`;
}

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
  const { selections, groups, toggle, clear, selectedCount, trending } = builder;

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

      <div className="slim-scrollbar md:flex-1 md:overflow-y-auto">
        {groups.map((group) => {
          const values = splitMulti(selections[group.key]);
          const summary = summaryOf(group, selections);
          const open = expanded[group.key];
          const flagged = group.trendable ? trendingOptionsFor(group, trending) : null;

          return (
            <div key={group.key} className="border-b border-white/[0.04]">
              <button
                type="button"
                onClick={() => setExpanded((current) => ({ ...current, [group.key]: !current[group.key] }))}
                aria-expanded={Boolean(open)}
                className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors hover:bg-white/[0.02]"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-[11px] font-medium text-cream">{group.label}</span>
                  {group.multi && !summary && <span className="shrink-0 text-[9px] text-faint">up to {group.multi}</span>}
                  {summary && (
                    <span className="min-w-0 max-w-[180px] truncate rounded-full border border-gold/20 bg-gold/10 px-1.5 py-0.5 text-[9px] text-gold/80">
                      {summary}
                    </span>
                  )}
                </span>
                <ChevronRight size={11} className={cn("shrink-0 text-faint transition-transform", open && "rotate-90")} />
              </button>

              {open && (
                <div className="space-y-2.5 px-3 pb-3">
                  <div className="flex flex-wrap gap-1.5">
                    {group.options.map((option) => {
                      const active = values.includes(option);
                      if (option === TRENDING) {
                        return (
                          <Chip
                            key={option}
                            label="Trending"
                            size="sm"
                            active={active}
                            onClick={() => toggle(group.key, option)}
                            leading={<Flame size={10} className="shrink-0" />}
                            title={trendingHint(group, trending)}
                            className={active ? undefined : "border-gold/25 text-gold/80 hover:border-gold/40 hover:text-gold"}
                          />
                        );
                      }
                      const hot = flagged?.has(option);
                      return (
                        <Chip
                          key={option}
                          label={option}
                          size="sm"
                          active={active}
                          onClick={() => toggle(group.key, option)}
                          trailing={hot ? <Flame size={9} className="shrink-0 text-gold" /> : undefined}
                          title={hot ? "Trending now" : undefined}
                          ariaLabel={hot ? `${option}, trending now` : undefined}
                        />
                      );
                    })}
                  </div>

                  {/* A follow-up for the option just picked — which elongated cut, which colour, how many rows. */}
                  {group.subRows
                    ?.filter((row) => values.includes(row.when))
                    .map((row) => {
                      const hotInRow = new Set(trending[row.key] ?? []);
                      return (
                        <div key={row.key} className="ml-1 space-y-1.5 border-l border-gold/25 pl-2.5">
                          <p className="text-[9px] font-medium uppercase tracking-wide text-faint">{row.label}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {row.options.map((option) => (
                              <Chip
                                key={option}
                                label={option}
                                size="sm"
                                active={selections[row.key] === option}
                                onClick={() => toggle(row.key, option)}
                                trailing={hotInRow.has(option) ? <Flame size={9} className="shrink-0 text-gold" /> : undefined}
                                title={hotInRow.has(option) ? "Trending now" : undefined}
                                ariaLabel={hotInRow.has(option) ? `${option}, trending now` : undefined}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })}
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
 * Lives inside the description box (as `PromptCard`'s `topSlot`) rather than
 * its own section elsewhere on the page: this is a preview of what the
 * builder is about to join into that text, not a separate decision, so it
 * sits with the box whose content it explains.
 */
export function JewelrySelectionChips({ builder }: { builder: JewelryBuilderController }) {
  const { selections, groups, toggle, selectedCount } = builder;
  if (selectedCount === 0) return null;

  const chips = groups.flatMap((group) => [
    ...splitMulti(selections[group.key]).map((value) => ({
      key: group.key,
      value,
      label: group.label,
      text: value === TRENDING ? `Trending ${FACET_NAMES[group.key] ?? ""}`.trim() : value,
    })),
    ...(group.subRows ?? [])
      .filter((row) => selections[row.key])
      .map((row) => ({ key: row.key, value: selections[row.key], label: row.label, text: selections[row.key] })),
  ]);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[9px] font-medium uppercase tracking-wide text-faint">Selected</span>
      {chips.map((chip) => (
        <span
          key={`${chip.key}:${chip.value}`}
          title={chip.label}
          className="flex items-center gap-1 rounded-full border border-gold/20 bg-gold/[0.07] px-2 py-1 text-[10px] text-gold/80"
        >
          {chip.value === TRENDING && <Flame size={9} className="shrink-0" />}
          {chip.text}
          <button
            type="button"
            onClick={() => toggle(chip.key, chip.value)}
            aria-label={`Remove ${chip.label}: ${chip.text}`}
            className="ml-0.5 transition-colors hover:text-gold"
          >
            <X size={9} />
          </button>
        </span>
      ))}
    </div>
  );
}
