"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Eye, FileSpreadsheet, FileText, FolderUp, Loader2, Trash2, Upload, X } from "lucide-react";
import { Lightbox } from "@/components/studio/Lightbox";
import { newPiece, type AffinityPiece } from "@/lib/affinity";
import { fetchSettingCodes } from "@/lib/api";
import { compressImage } from "@/lib/image";
import { matchFiles, roleOf, type MatchReason, type UploadedFile } from "@/lib/pieceMatching";
import {
  readSheetFields,
  styleCodeFromName,
  type DetailGroup,
  type SheetDetails,
  type SheetFields,
} from "@/lib/sheetFields";
import { readSheetFiles, SHEET_FILE_ACCEPT } from "@/lib/sheetFiles";
import { cn } from "@/lib/utils";

/** Fetched once per page load and shared — it is the same 600-row table for everyone. */
let settingCodesRequest: Promise<Record<string, string>> | null = null;
function loadSettingCodes() {
  settingCodesRequest ??= fetchSettingCodes()
    .then((res) => res.codes ?? {})
    .catch(() => ({}));
  return settingCodesRequest;
}

const isWorkbook = (name: string) => /\.(xlsx|xlsm|xls|csv)$/i.test(name);

/**
 * Many pieces at once: a whole folder, or a handful of photos and sheets
 * picked together, paired up by folder and by name (lib/pieceMatching.ts).
 *
 * The list it shows *is* the set of pieces the run will use: each can be
 * removed, its sheets moved, its photo previewed — there is no separate
 * "add" step. Files are read in the background meanwhile, so Build is ready
 * by the time the pairs have been checked.
 */

type Row = {
  photo: UploadedFile;
  sheets: { file: UploadedFile; reason: MatchReason }[];
  /** For a piece with no sheet: the designer's initial, prefixing its code ("R-1"). */
  designerInitial: string;
};

const REASON_LABEL: Record<MatchReason, string> = {
  folder: "same folder",
  name: "same name",
  code: "same code",
  similar: "similar name",
  manual: "added by you",
};

/** What the list currently amounts to, for the page's Build button. */
export type BulkPiecesState = {
  /** Every listed piece, ready to send — empty until every file has been read. */
  pieces: AffinityPiece[];
  /** Photos or sheets still being read. */
  reading: boolean;
  /** More pieces listed than one run holds. */
  overLimit: boolean;
};

/** A file turned into what the request carries — read once, kept for the batch. */
type Converted = { image?: string; sheetImages?: string[]; sheetExcelText?: string[] };

export function BulkPieceUpload({
  max,
  onChange,
  onError,
}: {
  /** How many pieces a run may hold. */
  max: number;
  /** Called whenever the list or its reading progress changes. */
  onChange: (state: BulkPiecesState) => void;
  onError: (message: string) => void;
}) {
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Map<string, File>>(new Map());
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loose, setLoose] = useState<UploadedFile[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  /** Rows whose full sheet is folded away. Shown by default — it is what the pairing is checked against. */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /** Each file as the request will carry it — photos compressed, PDFs rendered, workbooks flattened. */
  const [converted, setConverted] = useState<Map<string, Converted>>(new Map());

  /*
   * Every file is read as soon as the batch arrives rather than at Build:
   * rendering PDFs is the slow part, and doing it while the person is still
   * checking the pairs means Build can go straight away.
   */
  useEffect(() => {
    let cancelled = false;
    for (const [id, file] of files) {
      const read =
        roleOf(file.name, file.type) === "photo"
          ? compressImage(file).then((image): Converted => ({ image }))
          : readSheetFiles([file]).then((sheet): Converted => ({ sheetImages: sheet.images, sheetExcelText: sheet.excelText }));
      read
        .catch((err): Converted => {
          console.error(`[bulk] could not read ${file.name}:`, err);
          return { sheetImages: [], sheetExcelText: [] };
        })
        .then((result) => {
          if (!cancelled) setConverted((current) => new Map(current).set(id, result));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [files]);

  // The list as pieces, once every file in it has been read.
  useEffect(() => {
    const listed = rows ?? [];
    const ids = listed.flatMap((row) => [row.photo.id, ...row.sheets.map((entry) => entry.file.id)]);
    const reading = ids.some((id) => !converted.has(id));
    const pieces: AffinityPiece[] = reading
      ? []
      : listed
          .filter((row) => converted.get(row.photo.id)?.image)
          .map((row) => {
            const sheets = row.sheets.map((entry) => converted.get(entry.file.id)!);
            return {
              ...newPiece(),
              id: row.photo.id,
              image: converted.get(row.photo.id)!.image!,
              sheetImages: sheets.flatMap((sheet) => sheet.sheetImages ?? []),
              sheetExcelText: sheets.flatMap((sheet) => sheet.sheetExcelText ?? []),
              designerInitial: row.designerInitial,
            };
          });
    onChange({ pieces, reading, overLimit: listed.length > max });
  }, [rows, converted, max, onChange]);
  /** Each workbook's preview fields by file id: undefined while reading, null when nothing was found. */
  const [fields, setFields] = useState<Map<string, SheetFields | null>>(new Map());

  // Workbooks are read for their preview fields as soon as a batch arrives —
  // in the background, so the pairs are on screen before the reading is done.
  useEffect(() => {
    let cancelled = false;
    const workbooks = [...files].filter(([, file]) => isWorkbook(file.name));
    if (workbooks.length === 0) return;

    loadSettingCodes().then((codes) =>
      Promise.all(
        workbooks.map(async ([id, file]) => {
          const read = await readSheetFields(file, codes);
          if (!cancelled) setFields((current) => new Map(current).set(id, read));
        })
      )
    );
    return () => {
      cancelled = true;
    };
  }, [files]);

  // Thumbnails for the review table — one per photo in the batch, made once
  // and released when the batch goes away.
  const previews = useMemo(() => {
    const urls = new Map<string, string>();
    for (const [id, file] of files) {
      if (roleOf(file.name, file.type) === "photo") urls.set(id, URL.createObjectURL(file));
    }
    return urls;
  }, [files]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  function accept(picked: { file: File; path: string }[]) {
    const byId = new Map<string, File>();
    const uploaded: UploadedFile[] = [];
    let unusable = 0;

    for (const { file, path } of picked) {
      const role = roleOf(file.name, file.type);
      // Hidden files a folder upload drags along (".DS_Store", "Thumbs.db").
      if (!role || file.name.startsWith(".")) {
        unusable += 1;
        continue;
      }
      const id = crypto.randomUUID();
      byId.set(id, file);
      uploaded.push({ id, name: file.name, path, role });
    }

    const result = matchFiles(uploaded);
    if (result.pieces.length === 0) {
      onError("No jewellery photos found — a piece needs a photo; sheets on their own can't be matched to anything.");
      return;
    }

    setFiles(byId);
    setFields(new Map());
    setConverted(new Map());
    setSkipped(unusable);
    setLoose(result.unmatchedSheets);
    setRows(result.pieces.map((piece) => ({ ...piece, designerInitial: "" })));
  }

  /** Takes a piece out of the list, and the sheets that came with it. */
  function removeRow(photoId: string) {
    const next = (rows ?? []).filter((row) => row.photo.id !== photoId);
    if (next.length === 0) clear();
    else setRows(next);
  }

  function updateRow(photoId: string, patch: Partial<Row>) {
    setRows((current) => (current ?? []).map((row) => (row.photo.id === photoId ? { ...row, ...patch } : row)));
  }

  /** A sheet opened in its own tab — the browser's own PDF viewer is the best preview there is. */
  function openFile(id: string) {
    const file = files.get(id);
    if (!file) return;
    const url = URL.createObjectURL(file);
    window.open(url, "_blank", "noopener");
    // Long enough for the new tab to load it.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function moveSheet(sheet: UploadedFile, toPhotoId: string | null) {
    setRows((current) =>
      (current ?? []).map((row) => ({
        ...row,
        sheets:
          row.photo.id === toPhotoId
            ? [...row.sheets.filter((entry) => entry.file.id !== sheet.id), { file: sheet, reason: "manual" }]
            : row.sheets.filter((entry) => entry.file.id !== sheet.id),
      }))
    );
    setLoose((current) => {
      const without = current.filter((entry) => entry.id !== sheet.id);
      return toPhotoId ? without : [...without, sheet];
    });
  }

  function clear() {
    setRows(null);
    setLoose([]);
    setFiles(new Map());
    setFields(new Map());
    setConverted(new Map());
    setSkipped(0);
  }

  const withSheets = rows?.filter((row) => row.sheets.length > 0).length ?? 0;
  const stillReading = (rows ?? []).some(
    (row) => !converted.has(row.photo.id) || row.sheets.some((entry) => !converted.has(entry.file.id))
  );

  return (
    <div className="space-y-3">
      <input
        ref={folderInput}
        type="file"
        hidden
        multiple
        // Not in React's input typings, but every current browser honours it.
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        onChange={(event) => {
          accept([...(event.target.files ?? [])].map((file) => ({ file, path: file.webkitRelativePath || "" })));
          event.target.value = "";
        }}
      />
      <input
        ref={filesInput}
        type="file"
        hidden
        multiple
        accept={`image/*,${SHEET_FILE_ACCEPT}`}
        onChange={(event) => {
          accept([...(event.target.files ?? [])].map((file) => ({ file, path: "" })));
          event.target.value = "";
        }}
      />

      {!rows && (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={async (event) => {
            event.preventDefault();
            setDragging(false);
            accept(await droppedFiles(event.dataTransfer));
          }}
          className={cn(
            "flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-colors",
            dragging ? "border-gold/40 bg-gold/[0.05]" : "border-white/[0.10] bg-white/[0.015]"
          )}
        >
          <div>
            <p className="text-sm font-semibold text-cream">Bulk upload</p>
            <p className="mt-0.5 text-[11px] text-faint">
              Drop a folder or many files — photos plus their PDF or Excel sheets. Sheets are matched to photos by
              folder and by name, and you check every pair before anything is added.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => folderInput.current?.click()}
              className="flex min-h-9 items-center gap-1.5 rounded-lg border border-gold/30 bg-gold/10 px-3 text-[11px] font-semibold text-gold transition-colors hover:bg-gold/20"
            >
              <FolderUp size={13} /> Upload a folder
            </button>
            <button
              type="button"
              onClick={() => filesInput.current?.click()}
              className="flex min-h-9 items-center gap-1.5 rounded-lg border border-white/[0.12] px-3 text-[11px] font-medium text-cream transition-colors hover:border-gold/30 hover:text-gold"
            >
              <Upload size={13} /> Select files
            </button>
          </div>
        </div>
      )}

      {rows && (
        <div className="space-y-3 rounded-2xl border border-gold/20 bg-surface-raised/60 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-cream">Your pieces</p>
              <p className="flex items-center gap-1 text-[11px] text-faint">
                {stillReading && <Loader2 size={10} className="animate-spin" />}
                {rows.length} piece{rows.length === 1 ? "" : "s"} · {withSheets} with a sheet
                {loose.length > 0 && ` · ${loose.length} sheet${loose.length === 1 ? "" : "s"} not matched`}
                {skipped > 0 && ` · ${skipped} other file${skipped === 1 ? "" : "s"} skipped`}
                {stillReading && " · reading files…"}
              </p>
              {rows.length > max && (
                <p className="mt-1 text-[11px] text-gold">
                  One run holds up to {max} pieces — remove {rows.length - max} to continue.
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  setCollapsed(collapsed.size > 0 ? new Set() : new Set(rows.map((row) => row.photo.id)))
                }
                className="text-[11px] text-faint transition-colors hover:text-cream"
              >
                {collapsed.size > 0 ? "Show all details" : "Hide all details"}
              </button>
              <button
                type="button"
                onClick={clear}
                className="text-[11px] text-faint transition-colors hover:text-cream"
              >
                Start over
              </button>
            </div>
          </div>

          <ul className="space-y-2">
            {rows.map((row) => {
              return (
                <li
                  key={row.photo.id}
                  className="group flex items-start gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-2"
                >
                  {/* The photo opens full size — the same look a result gets. */}
                  <button
                    type="button"
                    onClick={() => setPreview(previews.get(row.photo.id) ?? null)}
                    title={`Preview ${row.photo.name}`}
                    aria-label={`Preview ${row.photo.name}`}
                    className="group/thumb relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, not something next/image can optimise */}
                    <img src={previews.get(row.photo.id)} alt="" className="h-full w-full object-contain" />
                    <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 transition-opacity group-hover/thumb:opacity-100">
                      <Eye size={14} />
                    </span>
                  </button>

                  {/* Left: the piece, and what its sheet says. */}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="truncate text-[12px] font-medium text-cream" title={row.photo.path || row.photo.name}>
                      {row.photo.name}
                    </p>
                    <SheetPreview
                      row={row}
                      fields={fields}
                      open={!collapsed.has(row.photo.id)}
                      onToggle={() =>
                        setCollapsed((current) => {
                          const next = new Set(current);
                          if (next.has(row.photo.id)) next.delete(row.photo.id);
                          else next.add(row.photo.id);
                          return next;
                        })
                      }
                    />
                    {/* A concept carries a designer's credit instead of a printed code. */}
                    {row.sheets.length === 0 && (
                      <label className="flex items-center gap-2 text-[10px] text-faint">
                        Designer&apos;s starting letter
                        <input
                          value={row.designerInitial}
                          onChange={(event) => updateRow(row.photo.id, { designerInitial: event.target.value.slice(0, 3) })}
                          placeholder="R"
                          maxLength={3}
                          className="h-6 w-10 rounded border border-white/[0.10] bg-surface-raised text-center text-[11px] text-cream placeholder:text-faint focus:border-gold/30 focus:outline-none"
                        />
                      </label>
                    )}
                  </div>

                  {/* Right: the files that piece will be sent with. */}
                  <div className="flex w-56 shrink-0 flex-col items-stretch gap-1 sm:w-64">
                    <div className="flex items-center justify-end gap-1">
                      {row.sheets.length === 0 && (
                        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-faint">
                          No sheet — new ideation
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeRow(row.photo.id)}
                        title={`Remove ${row.photo.name}`}
                        aria-label={`Remove ${row.photo.name}`}
                        className="ml-auto flex h-6 w-6 items-center justify-center rounded-full text-faint transition-colors hover:bg-error/10 hover:text-error"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    {row.sheets.map(({ file, reason }) => (
                      <span
                        key={file.id}
                        className="flex min-w-0 items-center gap-1 rounded-full border border-gold/25 bg-gold/10 py-0.5 pl-2 pr-1 text-[10px] text-gold"
                        title={`${file.path || file.name} — matched by ${REASON_LABEL[reason]}`}
                      >
                        <SheetIcon name={file.name} />
                        {/* A PDF opens in the browser's viewer; a workbook has no preview there, so it doesn't offer one. */}
                        {isWorkbook(file.name) ? (
                          <span className="min-w-0 flex-1 truncate">{file.name}</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openFile(file.id)}
                            title={`Open ${file.name}`}
                            className="min-w-0 flex-1 truncate text-left hover:underline"
                          >
                            {file.name}
                          </button>
                        )}
                        <span className="shrink-0 text-gold/60">· {REASON_LABEL[reason]}</span>
                        <button
                          type="button"
                          onClick={() => moveSheet(file, null)}
                          aria-label={`Unassign ${file.name}`}
                          className="shrink-0 rounded-full p-0.5 hover:bg-gold/20"
                        >
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                    {loose.length > 0 && (
                        <select
                          value=""
                          onChange={(event) => {
                            const sheet = loose.find((entry) => entry.id === event.target.value);
                            if (sheet) moveSheet(sheet, row.photo.id);
                          }}
                          className="h-6 self-end rounded-full border border-white/[0.10] bg-surface-raised px-2 text-[10px] text-muted focus:outline-none"
                          aria-label={`Add a sheet to ${row.photo.name}`}
                        >
                          <option value="">+ Add sheet…</option>
                          {loose.map((sheet) => (
                            <option key={sheet.id} value={sheet.id}>
                              {sheet.name}
                            </option>
                          ))}
                        </select>
                      )}
                  </div>
                </li>
              );
            })}
          </ul>

          {loose.length > 0 && (
            <div className="space-y-1.5 rounded-xl border border-dashed border-white/[0.12] p-3">
              <p className="text-[11px] font-medium text-cream">
                Not matched — pick the piece each belongs to, or leave it out
              </p>
              <ul className="space-y-1">
                {loose.map((sheet) => (
                  <li key={sheet.id} className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
                    <SheetIcon name={sheet.name} />
                    <span className="min-w-0 flex-1 truncate" title={sheet.path || sheet.name}>
                      {sheet.name}
                    </span>
                    <select
                      value=""
                      onChange={(event) => event.target.value && moveSheet(sheet, event.target.value)}
                      className="h-7 rounded-lg border border-white/[0.10] bg-surface-raised px-2 text-[11px] text-cream focus:outline-none"
                      aria-label={`Assign ${sheet.name}`}
                    >
                      <option value="">Assign to…</option>
                      {rows.map((row) => (
                        <option key={row.photo.id} value={row.photo.id}>
                          {row.photo.name}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <Lightbox src={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

/**
 * What the piece's sheet will contribute to the catalog, read from its
 * workbook. A PDF alone can't be read here (its text comes out scrambled), so
 * a PDF-only piece says the model will read it, and shows the style code its
 * file name carries.
 */
function SheetPreview({
  row,
  fields,
  open,
  onToggle,
}: {
  row: Row;
  fields: Map<string, SheetFields | null>;
  /** Whether the full sheet is shown under the headline fields. */
  open: boolean;
  onToggle: () => void;
}) {
  if (row.sheets.length === 0) {
    return (
      <p className="text-[10px] leading-relaxed text-faint">
        No sheet, so its title and caption are left blank for you to write.
        {styleCodeFromName(row.photo.name) && <> Code from the file name: {styleCodeFromName(row.photo.name)}</>}
      </p>
    );
  }

  const workbooks = row.sheets.filter(({ file }) => isWorkbook(file.name));
  const read = workbooks.map(({ file }) => fields.get(file.id));
  if (workbooks.length > 0 && read.some((entry) => entry === undefined)) {
    return (
      <p className="flex items-center gap-1 text-[10px] text-faint">
        <Loader2 size={10} className="animate-spin" /> Reading the sheet…
      </p>
    );
  }

  // Several workbooks: the first non-empty value for each field.
  const merged = read.reduce<SheetFields | null>((acc, entry) => {
    if (!entry) return acc;
    if (!acc) return { ...entry, settings: [...entry.settings] };
    // The headline values fill in from later workbooks; the details stay the first's.
    for (const key of HEADLINE_KEYS) acc[key] ??= entry[key];
    acc.settings = [...new Set([...acc.settings, ...entry.settings])];
    return acc;
  }, null);

  if (!merged) {
    const code = styleCodeFromName(row.sheets[0].file.name) ?? styleCodeFromName(row.photo.name);
    return (
      <p className="text-[10px] leading-relaxed text-faint">
        {workbooks.length ? "Couldn't pick fields out of this workbook" : "PDF sheet"} — the model reads it in full when
        writing the copy.{code && <> Style code from the file name: {code}</>}
      </p>
    );
  }

  const diamonds = [merged.diamondCount && `${merged.diamondCount} stones`, merged.diamondWeight]
    .filter(Boolean)
    .join(" · ");
  const items: [string, string | null][] = [
    ["Style No", merged.styleNo],
    ["Category", merged.category],
    ["Metal", merged.metal],
    ["Gold wt", merged.goldWeight],
    ["Diamonds", diamonds || null],
    ["Process", merged.process],
  ];

  return (
    <div className="space-y-1">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] md:grid-cols-3">
        {items.map(([label, value]) => (
          <div key={label} className="flex min-w-0 gap-1">
            <dt className="shrink-0 text-faint">{label}</dt>
            <dd className={cn("min-w-0 truncate", value ? "text-cream" : "text-faint/60")} title={value ?? undefined}>
              {value ?? "—"}
            </dd>
          </div>
        ))}
      </dl>
      {merged.settings.length > 0 && (
        <p className="text-[10px] leading-snug">
          <span className="text-faint">Setting </span>
          <span className="text-cream">{merged.settings.join(" · ")}</span>
        </p>
      )}

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex items-center gap-0.5 text-[10px] font-medium text-gold/80 transition-colors hover:text-gold"
      >
        <ChevronDown size={11} className={cn("transition-transform", open && "rotate-180")} />
        {open ? "Hide sheet details" : "Show all sheet details"}
      </button>
      {open && <SheetDetailsView details={merged.details} />}
    </div>
  );
}

const GROUP_ORDER: DetailGroup[] = ["Product", "Finishes", "Team", "Project & customer"];

/** The single-value fields a second workbook can fill in where the first left a gap. */
const HEADLINE_KEYS = ["styleNo", "category", "metal", "goldWeight", "diamondCount", "diamondWeight", "process"] as const;

/** The whole front page of the form, as read — boxes by heading, then its two tables. */
function SheetDetailsView({ details }: { details: SheetDetails }) {
  const cell = "px-1.5 py-0.5 text-left align-top";
  const weights = [
    details.minWeight && `Minimum ${details.minWeight} ct`,
    details.chargingWeight && `Charging ${details.chargingWeight} ct`,
  ].filter(Boolean);

  return (
    <div className="space-y-2.5 rounded-lg border border-white/[0.07] bg-white/[0.02] p-2.5 text-[10px]">
      <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
        {GROUP_ORDER.map((group) => {
          const entries = details.fields.filter((field) => field.group === group);
          if (entries.length === 0) return null;
          return (
            <div key={group}>
              <p className="mb-0.5 font-semibold uppercase tracking-wider text-faint">{group}</p>
              <dl className="space-y-0.5">
                {entries.map(({ label, value }) => (
                  <div key={label} className="flex gap-1.5">
                    <dt className="w-24 shrink-0 text-faint">{label}</dt>
                    <dd className="min-w-0 break-words text-cream">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
      </div>

      {details.components.length > 0 && (
        <div>
          <p className="mb-0.5 font-semibold uppercase tracking-wider text-faint">Metal parts</p>
          <table className="w-full border-collapse">
            <thead className="text-faint">
              <tr>
                <th className={cell}>Part</th>
                <th className={cell}>Description</th>
                <th className={cell}>Metal</th>
                <th className={cell}>Qty</th>
                <th className={cell}>Weight</th>
              </tr>
            </thead>
            <tbody className="text-cream">
              {details.components.map((part, index) => (
                <tr key={index} className="border-t border-white/[0.06]">
                  <td className={cell}>{part.part}</td>
                  <td className={cell}>{part.description}</td>
                  <td className={cell}>{part.metal || "—"}</td>
                  <td className={cell}>{part.qty || "—"}</td>
                  <td className={cell}>{part.weight || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {details.stones.length > 0 && (
        <div>
          <p className="mb-0.5 font-semibold uppercase tracking-wider text-faint">Stones</p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="text-faint">
                <tr>
                  <th className={cell}>Shape / location</th>
                  <th className={cell}>Size</th>
                  <th className={cell}>Sieve</th>
                  <th className={cell}>Qty</th>
                  <th className={cell}>Weight</th>
                  <th className={cell}>Setting</th>
                </tr>
              </thead>
              <tbody className="text-cream">
                {details.stones.map((stone, index) => (
                  <tr key={index} className="border-t border-white/[0.06]">
                    <td className={cell}>{stone.shape}</td>
                    <td className={cn(cell, "whitespace-nowrap")}>{stone.size || "—"}</td>
                    <td className={cn(cell, "whitespace-nowrap")}>{stone.sieve || "—"}</td>
                    <td className={cell}>{stone.qty || "—"}</td>
                    <td className={cn(cell, "whitespace-nowrap")}>{stone.weight || "—"}</td>
                    <td className={cell}>{stone.setting || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {weights.length > 0 && <p className="mt-1 text-faint">{weights.join(" · ")}</p>}
        </div>
      )}

      {details.remarks.length > 0 && (
        <div>
          <p className="mb-0.5 font-semibold uppercase tracking-wider text-faint">Customer remark</p>
          {details.remarks.map((remark, index) => (
            <p key={index} className="whitespace-pre-line leading-relaxed text-cream">
              {remark}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function SheetIcon({ name }: { name: string }) {
  return /\.(xlsx|xlsm|xls|csv)$/i.test(name) ? (
    <FileSpreadsheet size={11} className="shrink-0" />
  ) : (
    <FileText size={11} className="shrink-0" />
  );
}

/**
 * Everything dropped, folders walked — a plain `dataTransfer.files` lists a
 * dropped folder as one unreadable entry, so its contents need the entry API.
 */
async function droppedFiles(transfer: DataTransfer): Promise<{ file: File; path: string }[]> {
  const entries = [...transfer.items]
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => Boolean(entry));
  if (entries.length === 0) return [...transfer.files].map((file) => ({ file, path: "" }));

  const out: { file: File; path: string }[] = [];
  const hasFolder = entries.some((entry) => entry.isDirectory);

  async function walk(entry: FileSystemEntry, path: string) {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      // Same shape as a folder picker's `webkitRelativePath`, so matching treats both alike.
      out.push({ file, path: hasFolder ? `${path}${entry.name}` : "" });
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries hands back at most ~100 at a time; keep asking until it's empty.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (batch.length === 0) break;
      for (const child of batch) await walk(child, `${path}${entry.name}/`);
    }
  }

  for (const entry of entries) await walk(entry, hasFolder && entry.isFile ? "Dropped/" : "");
  return out;
}
