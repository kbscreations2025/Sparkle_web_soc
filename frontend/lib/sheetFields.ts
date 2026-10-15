/**
 * The handful of facts a production development sheet contributes to the
 * catalog — read in the browser so the person can see them while pairing
 * sheets to photos, before anything is sent.
 *
 * A preview, not the source of truth: the model still reads the whole sheet
 * when it writes the copy. This only answers "is this the right sheet, and
 * what will it say?".
 *
 * Built for the KBS "Product Development Form" workbook (Front Page + a
 * Masters sheet of codes), but by label rather than by cell address, so a
 * moved column or an extra row doesn't break it. A PDF's text comes out of
 * the renderer in scrambled order, so fields are read from the workbook only.
 */

export type SheetFields = {
  styleNo: string | null;
  category: string | null;
  metal: string | null;
  goldWeight: string | null;
  diamondCount: string | null;
  diamondWeight: string | null;
  /** Decoded where the workbook's own Masters table knows the code, e.g. "Oval Prong Set (MOVPRG)". */
  settings: string[];
  process: string | null;
  /** Everything else the form states — the full sheet, for the detail view. */
  details: SheetDetails;
};

/** One labelled box on the form, under the heading it is shown in. */
export type SheetDetail = { group: DetailGroup; label: string; value: string };
export type DetailGroup = "Product" | "Finishes" | "Team" | "Project & customer";

export type SheetDetails = {
  fields: SheetDetail[];
  /** The metal parts: "A · Fashion Pendant · Y · 0.70 g", plus any finding code. */
  components: { part: string; description: string; metal: string; qty: string; weight: string }[];
  /** One row per stone line on the form. */
  stones: { shape: string; size: string; sieve: string; qty: string; weight: string; setting: string }[];
  minWeight: string | null;
  chargingWeight: string | null;
  /** The customer's free-text brief. */
  remarks: string[];
};

/**
 * The form's labelled boxes, in the order they are shown, and the heading
 * each sits under. `match` is the label as printed (lower-case, letters and
 * digits only), spelling mistakes included — "Finialised by" is on the form.
 */
const DETAIL_FIELDS: { match: string; label: string; group: DetailGroup }[] = [
  { match: "description", label: "Description", group: "Product" },
  { match: "process", label: "Process", group: "Product" },
  { match: "pd type", label: "PD type", group: "Product" },
  { match: "model no", label: "Model No", group: "Product" },
  { match: "ref style no", label: "Ref style No", group: "Product" },
  { match: "ref model no", label: "Ref model No", group: "Product" },
  { match: "ring size", label: "Ring size", group: "Product" },
  { match: "stamp spot", label: "Stamp", group: "Product" },
  { match: "sales ctg", label: "Sales category", group: "Product" },
  { match: "millgrain", label: "Milgrain", group: "Finishes" },
  { match: "2 tone", label: "Two-tone", group: "Finishes" },
  { match: "sat finish", label: "Satin finish", group: "Finishes" },
  { match: "jacket", label: "Jacket", group: "Finishes" },
  { match: "col rhd", label: "Colour rhodium", group: "Finishes" },
  { match: "designed by", label: "Designed by", group: "Team" },
  { match: "finialised by", label: "Finalised by", group: "Team" },
  { match: "sketch by", label: "Sketch by", group: "Team" },
  { match: "cad designer", label: "CAD designer", group: "Team" },
  { match: "model maker", label: "Model maker", group: "Team" },
  { match: "proj coordinator", label: "Coordinator", group: "Team" },
  { match: "project name", label: "Project", group: "Project & customer" },
  { match: "customer", label: "Customer", group: "Project & customer" },
  { match: "sub customer", label: "Sub customer", group: "Project & customer" },
  { match: "design date", label: "Design date", group: "Project & customer" },
];

type Grid = string[][];

/** Used when a workbook has no Masters table of its own. */
const METAL_CODES: Record<string, string> = {
  Y: "Yellow Gold",
  W: "White Gold",
  P: "Rose Gold",
  R: "Rose Gold",
  TT: "Two Tone",
  "3T": "Three Tone",
};

const clean = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const labelOf = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function toGrid(xlsx: typeof import("xlsx"), sheet: import("xlsx").WorkSheet): Grid {
  // `raw: false` — the value as the sheet displays it ("1.25"), not as stored ("1.2466").
  const rows = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: "", raw: false });
  return rows.map((row) => row.map(clean));
}

/** The first non-empty cell to the right of a cell whose label matches. */
function valueRightOf(grid: Grid, label: RegExp): string | null {
  for (const row of grid) {
    for (let c = 0; c < row.length; c++) {
      if (label.test(labelOf(row[c]))) {
        const value = row.slice(c + 1).find(Boolean);
        if (value) return value;
      }
    }
  }
  return null;
}

/** "Description:- ENGAGEMENT RING" — a label and its value in one cell. */
function inlineValue(grid: Grid, label: RegExp): string | null {
  for (const row of grid) {
    for (const cell of row) {
      const match = cell.match(label);
      if (match?.[1]?.trim()) return match[1].trim();
    }
  }
  return null;
}

/** A header row containing every one of `headers`, with each one's column. */
function findHeader(grid: Grid, headers: Record<string, RegExp>) {
  for (let r = 0; r < grid.length; r++) {
    const columns: Record<string, number> = {};
    for (const [key, re] of Object.entries(headers)) {
      const c = grid[r].findIndex((cell) => re.test(labelOf(cell)));
      if (c < 0) break;
      columns[key] = c;
    }
    if (Object.keys(columns).length === Object.keys(headers).length) return { row: r, columns };
  }
  return null;
}

/** Code → description tables from the Masters sheet (setting codes, metal colours). */
function mastersLookup(grids: Grid[], code: RegExp, description: RegExp) {
  const map = new Map<string, string>();
  for (const grid of grids) {
    const header = findHeader(grid, { code, description });
    if (!header) continue;
    for (const row of grid.slice(header.row + 1)) {
      const key = row[header.columns.code];
      const value = row[header.columns.description];
      if (key && value && key !== "-") map.set(key.toUpperCase(), value);
    }
  }
  return map;
}

const titleCase = (text: string) => text.toLowerCase().replace(/\b[a-z]/g, (ch) => ch.toUpperCase());

/** "Total :", "Total :-", "Total wt :-" — the row that closes a table. */
const TOTAL_ROW = /^total( gold)?( wt| weight)?\s*:?-?$/i;
const isTotalRow = (row: string[]) => row.some((cell) => TOTAL_ROW.test(cell));

const number = (text: string | undefined) => {
  const value = Number(String(text ?? "").replace(/,/g, ""));
  return Number.isFinite(value) && text !== "" ? value : null;
};

/** "Y" → "Yellow Gold"; "14KY" → "14K Yellow Gold"; a Masters table's own name wins. */
function metalName(code: string, masters: Map<string, string>) {
  const upper = code.toUpperCase().replace(/\s+/g, "");
  const karat = upper.match(/^(\d{1,2})K(T)?/)?.[1];
  const colour = karat ? upper.replace(/^\d{1,2}KT?/, "") : upper;
  let name = masters.get(colour) || METAL_CODES[colour] || null;
  if (name && /^(yellow|white|pink|rose)$/i.test(name)) name = `${titleCase(name)} Gold`;
  if (!name) return code;
  return karat ? `${karat}K ${name}` : name;
}

/**
 * The fields of one parsed workbook. Exported so it can be tested without a browser.
 *
 * `settingCodes` is the catalog's own code table (GET /api/marketing-kit/
 * setting-codes) — the words the deck will use — tried before the
 * workbook's Masters sheet, which not every workbook carries in full.
 */
export function fieldsFromWorkbook(
  xlsx: typeof import("xlsx"),
  workbook: import("xlsx").WorkBook,
  settingCodes: Record<string, string> = {}
): SheetFields | null {
  const grids = workbook.SheetNames.map((name) => toGrid(xlsx, workbook.Sheets[name]));
  // The form's own page — the sheet that carries a style number.
  const front = grids.find((grid) => valueRightOf(grid, /^style (no|number)$/)) ?? grids[0];
  if (!front) return null;

  const settingNames = mastersLookup(grids, /^se+t+ing code$/, /^se+t+ing code description$/);
  const metalNames = mastersLookup(grids, /^metal colou?r code$/, /^metal colou?r description$/);

  // Metal and gold weight: the component table under "Metal Color" (or just
  // "Color") and "Technical Gold WT", falling back to its CAD weight; a
  // "Total Gold Wt" line, where the form has one, is the figure to show.
  let metal: string | null = null;
  let goldWeight: string | null = valueRightOf(front, /^total gold wt$/);
  const parts = findHeader(front, { metal: /^(metal )?colou?r$/, description: /^description$/ });
  if (parts) {
    const header = front[parts.row];
    const technical = header.findIndex((cell) => /^technical gold wt$/.test(labelOf(cell)));
    const cad = header.findIndex((cell) => /^cad wt$/.test(labelOf(cell)));
    for (const row of front.slice(parts.row + 1)) {
      if (isTotalRow(row) || /^com code$/i.test(labelOf(row[0] ?? ""))) break;
      const code = row[parts.columns.metal];
      if (code && !metal) metal = metalName(code, metalNames);
      if (!goldWeight) goldWeight = (technical >= 0 && row[technical]) || (cad >= 0 && row[cad]) || null;
    }
  }

  // Diamonds: the stone table, its setting codes, and its totals row — or,
  // where the totals row leaves a figure blank, the sum of the rows above it.
  let diamondCount: string | null = null;
  let diamondWeight: string | null = null;
  const settings: string[] = [];
  const stones = findHeader(front, { qty: /^dia qty$/, weight: /^total wt$/, setting: /^setting code$/ });
  if (stones) {
    let qtySum = 0;
    let weightSum = 0;
    for (const row of front.slice(stones.row + 1)) {
      if (isTotalRow(row)) {
        diamondCount = row[stones.columns.qty] || null;
        diamondWeight = row[stones.columns.weight] || null;
        break;
      }
      qtySum += number(row[stones.columns.qty]) ?? 0;
      weightSum += number(row[stones.columns.weight]) ?? 0;
      const code = row[stones.columns.setting]?.toUpperCase();
      if (code && /^[A-Z]{4,8}$/.test(code)) {
        const name = settingCodes[code] || settingNames.get(code);
        const label = name ? `${name} (${code})` : code;
        if (!settings.includes(label)) settings.push(label);
      }
    }
    diamondCount ||= qtySum ? String(qtySum) : null;
    diamondWeight ||= weightSum ? weightSum.toFixed(3).replace(/0+$/, "").replace(/\.$/, "") : null;
  }

  const description = inlineValue(front, /description\s*:-?\s*(.+)$/i);

  const details = readDetails(front, { settingCodes, settingNames, metalNames, description });
  // The parts table and the stone table are the detail view's own sections;
  // weights the form prints beside the stone totals are kept with them.
  if (stones) {
    const totals = front.slice(stones.row + 1).find(isTotalRow);
    const header = front[stones.row];
    const col = (re: RegExp) => header.findIndex((cell) => re.test(labelOf(cell)));
    const [min, charging] = [col(/^min wt$/), col(/^charging wt$/)];
    details.minWeight = (totals && min >= 0 && totals[min]) || null;
    details.chargingWeight = (totals && charging >= 0 && totals[charging]) || null;
  }

  const fields: SheetFields = {
    styleNo: valueRightOf(front, /^style (no|number)$/),
    category: description ? titleCase(description) : null,
    metal,
    goldWeight: goldWeight ? `${goldWeight} g` : null,
    diamondCount,
    diamondWeight: diamondWeight ? `${diamondWeight} ct` : null,
    settings,
    process: valueRightOf(front, /^process$/),
    details,
  };

  const found = Object.entries(fields).some(([key, value]) =>
    key === "details" ? false : Array.isArray(value) ? value.length > 0 : Boolean(value)
  );
  return found ? fields : null;
}

/** Labels on the form, so a label's "value" is never the next label along ("Millgrain:,No,2-Tone,No"). */
const KNOWN_LABELS = new Set([...DETAIL_FIELDS.map((field) => field.match), "style no", "reference image", "cad wt"]);

/** Everything on the front page beyond the headline fields — the detail view. */
function readDetails(
  front: Grid,
  {
    settingCodes,
    settingNames,
    metalNames,
    description,
  }: { settingCodes: Record<string, string>; settingNames: Map<string, string>; metalNames: Map<string, string>; description: string | null }
): SheetDetails {
  const values = new Map<string, string>();
  const remarks: string[] = [];

  for (const row of front) {
    row.forEach((cell, c) => {
      const label = labelOf(cell);
      // "Project Name :- Sherwood Selection" and "Customer Remark :- …" carry their value in the same cell.
      const inline = cell.match(/^(project name|customer remark)\s*:-?\s*(.*)$/i);
      if (inline) {
        if (/remark/i.test(inline[1])) {
          if (inline[2].trim()) remarks.push(inline[2].trim());
        } else if (inline[2].trim()) values.set("project name", inline[2].trim());
        return;
      }
      if (!KNOWN_LABELS.has(label) || values.has(label)) return;
      const value = row.slice(c + 1).find(Boolean);
      if (value && !KNOWN_LABELS.has(labelOf(value))) values.set(label, value);
    });
  }
  if (description) values.set("description", description);

  const fields = DETAIL_FIELDS.flatMap(({ match, label, group }) => {
    const value = values.get(match);
    return value ? [{ group, label, value }] : [];
  });

  // The parts table: everything between its header and its totals.
  const components: SheetDetails["components"] = [];
  const parts = findHeader(front, { part: /^comp$/, description: /^description$/ });
  if (parts) {
    const header = front[parts.row];
    const col = (re: RegExp) => header.findIndex((cell) => re.test(labelOf(cell)));
    const [metal, qty, technical, cad] = [col(/^(metal )?colou?r$/), col(/^qty$/), col(/^technical gold wt$/), col(/^cad wt$/)];
    for (const row of front.slice(parts.row + 1)) {
      if (isTotalRow(row) || /^com code$/.test(labelOf(row[0] ?? ""))) break;
      if (!row[0] || !row[parts.columns.description]) continue;
      const weight = (technical >= 0 && row[technical]) || (cad >= 0 && row[cad]) || "";
      components.push({
        part: row[0],
        description: row[parts.columns.description],
        metal: metal >= 0 && row[metal] ? metalName(row[metal], metalNames) : "",
        qty: qty >= 0 ? row[qty] : "",
        weight: weight ? `${weight} g` : "",
      });
    }
  }

  // The stone table, one line per row, settings decoded.
  const stones: SheetDetails["stones"] = [];
  const stoneHeader = findHeader(front, { code: /^com code$/, shape: /^dia shape location$/ });
  if (stoneHeader) {
    const header = front[stoneHeader.row];
    const col = (re: RegExp) => header.findIndex((cell) => re.test(labelOf(cell)));
    const [size, sieve, qty, weight, setting] = [col(/^size mm$/), col(/^sieve size$/), col(/^dia qty$/), col(/^total wt$/), col(/^setting code$/)];
    for (const row of front.slice(stoneHeader.row + 1)) {
      if (isTotalRow(row)) break;
      const shape = row[stoneHeader.columns.shape];
      if (!shape) continue;
      const code = setting >= 0 ? row[setting]?.toUpperCase() : "";
      const name = code ? settingCodes[code] || settingNames.get(code) : null;
      stones.push({
        shape,
        size: size >= 0 && row[size] ? `${row[size]} mm` : "",
        // The sieve range spans two cells — from, then to.
        sieve: sieve >= 0 ? [row[sieve], row[sieve + 1]].filter(Boolean).join("–") : "",
        qty: qty >= 0 ? row[qty] : "",
        weight: weight >= 0 && row[weight] ? `${row[weight]} ct` : "",
        setting: code ? (name ? `${name} (${code})` : code) : "",
      });
    }
  }

  return { fields, components, stones, minWeight: null, chargingWeight: null, remarks };
}

/** Reads one workbook's fields; null for anything that isn't one or can't be read. */
export async function readSheetFields(file: File, settingCodes?: Record<string, string>): Promise<SheetFields | null> {
  if (!/\.(xlsx|xlsm|xls|csv)$/i.test(file.name)) return null;
  try {
    const xlsx = await import("xlsx");
    return fieldsFromWorkbook(xlsx, xlsx.read(await file.arrayBuffer(), { type: "array" }), settingCodes);
  } catch (err) {
    console.error(`[sheets] could not read fields from ${file.name}:`, err);
    return null;
  }
}

/** A style code in a file name — "DM 3D RE-26693.jpg" → "RE-26693" — for a piece with no workbook. */
export function styleCodeFromName(name: string): string | null {
  return name.match(/\b[A-Z]{1,4}-\d{3,}(?:-[A-Z]{1,3})?\b/)?.[0] ?? null;
}
