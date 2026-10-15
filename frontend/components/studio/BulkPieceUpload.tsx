"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Eye,
  FileSpreadsheet,
  FileText,
  FolderUp,
  Loader2,
  Plus,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Lightbox } from "@/components/studio/Lightbox";
import { newPiece, type AffinityPiece } from "@/lib/affinity";
import { fetchSettingCodes } from "@/lib/api";
import { compressImage } from "@/lib/image";
import {
  matchFiles,
  roleOf,
  type MatchReason,
  type UploadedFile,
} from "@/lib/pieceMatching";
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
  /** For a piece with no sheet: what the person wants it to say — its caption in the deck. */
  note: string;
  /** Which category the piece is in — see `Category`. */
  categoryId: string;
  /** Further categories the same piece also appears in. */
  alsoIn: string[];
};

const inCategory = (row: Row, categoryId: string) =>
  row.categoryId === categoryId || row.alsoIn.includes(categoryId);

/**
 * One group of pieces, which becomes its own chapter of the deck: a cover,
 * then its Existing style and New Ideation slides. `label` is the person's
 * name for the group, passed to the AI as a hint for the name it writes.
 */
type Category = {
  id: string;
  label: string;
  /** The piece whose photo is the cover; null means the first piece in it. */
  coverId: string | null;
};

/** The selection bar's "+ New category" choice. */
const NEW_CATEGORY = "__new__";

/** A colour per category, so a card shows at a glance which box it is in. */
const CATEGORY_COLORS = [
  "#B08D3E",
  "#6F86B8",
  "#A0668F",
  "#4F9A86",
  "#C27A4E",
  "#7E8A4A",
  "#8A6FC0",
  "#B85C5C",
];
const categoryColor = (position: number) =>
  CATEGORY_COLORS[Math.max(0, position) % CATEGORY_COLORS.length];

/** The category's cover: the chosen piece while it is still in it, else its first piece. */
function coverOf(category: Category, members: Row[]) {
  return members.some((row) => row.photo.id === category.coverId)
    ? category.coverId
    : (members[0]?.photo.id ?? null);
}

/** Clicks on a card's own controls shouldn't also select the card or move pieces. */
function isControl(target: EventTarget) {
  return (
    target instanceof Element &&
    Boolean(target.closest("button, input, textarea, select, a"))
  );
}

/** The groups as the request carries them: positions in the piece list sent. */
export type PieceCategory = {
  label: string;
  pieceIndexes: number[];
  coverIndex: number;
};

/**
 * Starting groups for a batch: one per sub-folder the photos sit in (the
 * folder name as its label), with any loose photos in their own group; or a
 * single group when nothing is in a sub-folder.
 */
function categoriesFor(photos: UploadedFile[]) {
  const folderOf = (photo: UploadedFile) => {
    const parts = photo.path.split("/");
    // "Picked/Bridal/ring.jpg" → "Bridal"; the picked folder itself is no grouping.
    return parts.length > 2 ? parts[parts.length - 2] : "";
  };
  const folders = [...new Set(photos.map(folderOf).filter(Boolean))];
  if (folders.length === 0) {
    const only: Category = {
      id: crypto.randomUUID(),
      label: "Category 1",
      coverId: null,
    };
    return { categories: [only], categoryOf: () => only.id };
  }

  const categories: Category[] = folders.map((label) => ({
    id: crypto.randomUUID(),
    label,
    coverId: null,
  }));
  const loose = photos.some((photo) => !folderOf(photo))
    ? { id: crypto.randomUUID(), label: "Other pieces", coverId: null }
    : null;
  if (loose) categories.push(loose);
  const byFolder = new Map(
    folders.map((folder, i) => [folder, categories[i].id]),
  );
  return {
    categories,
    categoryOf: (photo: UploadedFile) =>
      byFolder.get(folderOf(photo)) ?? loose!.id,
  };
}

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
  /** The groups, by position in `pieces` — which is ordered category by category. */
  categories: PieceCategory[];
};

/** A file turned into what the request carries — read once, kept for the batch. */
type Converted = {
  image?: string;
  sheetImages?: string[];
  sheetExcelText?: string[];
};

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
  const [categories, setCategories] = useState<Category[]>([]);
  const [loose, setLoose] = useState<UploadedFile[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  /** Pieces picked on the grid, waiting for a category to be clicked. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** The piece whose whole sheet is open in the details dialog. */
  const [detailsFor, setDetailsFor] = useState<string | null>(null);
  /** The category open in its pop-up. */
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  /** Which category (or "all") the pop-up is listing pieces to add from; null lists none. */
  /** Starting letter for every piece's code (R-1) unless a piece has its own. */
  const [designerLetter, setDesignerLetter] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  /** Where the selection bar's Move sends the selected pieces. */
  const [moveTargetChoice, setMoveTarget] = useState<string>(NEW_CATEGORY);
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
          : readSheetFiles([file]).then((sheet): Converted => ({
              sheetImages: sheet.images,
              sheetExcelText: sheet.excelText,
            }));
      read
        .catch((err): Converted => {
          console.error(`[bulk] could not read ${file.name}:`, err);
          return { sheetImages: [], sheetExcelText: [] };
        })
        .then((result) => {
          if (!cancelled)
            setConverted((current) => new Map(current).set(id, result));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [files]);

  // The list as pieces, once every file in it has been read — in category
  // order, so each category's pieces sit together and can be named by position.
  useEffect(() => {
    const listed = categories.flatMap((category) =>
      (rows ?? []).filter((row) => row.categoryId === category.id),
    );
    const ids = listed.flatMap((row) => [
      row.photo.id,
      ...row.sheets.map((entry) => entry.file.id),
    ]);
    const reading = ids.some((id) => !converted.has(id));
    const sendable = reading
      ? []
      : listed.filter((row) => converted.get(row.photo.id)?.image);
    const pieces: AffinityPiece[] = sendable.map((row) => {
      const sheets = row.sheets.map((entry) => converted.get(entry.file.id)!);
      return {
        ...newPiece(),
        id: row.photo.id,
        image: converted.get(row.photo.id)!.image!,
        sheetImages: sheets.flatMap((sheet) => sheet.sheetImages ?? []),
        sheetExcelText: sheets.flatMap((sheet) => sheet.sheetExcelText ?? []),
        designerInitial: row.designerInitial || designerLetter.trim(),
        ...(row.sheets.length === 0 && row.note.trim()
          ? { note: row.note.trim() }
          : {}),
      };
    });

    const groups: PieceCategory[] = categories.flatMap((category) => {
      const pieceIndexes = sendable.flatMap((row, index) =>
        inCategory(row, category.id) ? [index] : [],
      );
      if (pieceIndexes.length === 0) return [];
      const cover = sendable.findIndex(
        (row) => row.photo.id === category.coverId,
      );
      return [
        {
          label: category.label.trim(),
          pieceIndexes,
          coverIndex: pieceIndexes.includes(cover) ? cover : pieceIndexes[0],
        },
      ];
    });

    onChange({
      pieces,
      reading,
      overLimit: listed.length > max,
      categories: groups,
    });
  }, [rows, categories, converted, max, designerLetter, onChange]);
  // There is always an empty category waiting at the end: fill it and the next one appears.
  useEffect(() => {
    if (!rows || categories.length === 0) return;
    const last = categories[categories.length - 1];
    if (rows.some((row) => inCategory(row, last.id))) {
      setCategories((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          label: `Category ${current.length + 1}`,
          coverId: null,
        },
      ]);
    }
  }, [rows, categories]);
  /** Each workbook's preview fields by file id: undefined while reading, null when nothing was found. */
  const [fields, setFields] = useState<Map<string, SheetFields | null>>(
    new Map(),
  );

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
          if (!cancelled)
            setFields((current) => new Map(current).set(id, read));
        }),
      ),
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
      if (roleOf(file.name, file.type) === "photo")
        urls.set(id, URL.createObjectURL(file));
    }
    return urls;
  }, [files]);
  useEffect(
    () => () => previews.forEach((url) => URL.revokeObjectURL(url)),
    [previews],
  );

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
      onError(
        "No jewellery photos found — a piece needs a photo; sheets on their own can't be matched to anything.",
      );
      return;
    }

    setFiles(byId);
    setFields(new Map());
    setConverted(new Map());
    setSelected(new Set());
    setDetailsFor(null);
    setSkipped(unusable);
    setLoose(result.unmatchedSheets);
    const grouping = categoriesFor(result.pieces.map((piece) => piece.photo));
    setCategories(grouping.categories);
    setRows(
      result.pieces.map((piece) => ({
        ...piece,
        designerInitial: "",
        note: "",
        categoryId: grouping.categoryOf(piece.photo),
        alsoIn: [],
      })),
    );
  }

  /** Takes a piece out of the list, and the sheets that came with it. */
  function removeRow(photoId: string) {
    const next = (rows ?? []).filter((row) => row.photo.id !== photoId);
    if (next.length === 0) clear();
    else setRows(next);
  }

  /** A new category — holding the selected pieces, if any are selected. */
  function addCategory() {
    const id = crypto.randomUUID();
    setCategories((current) => [
      ...current,
      { id, label: `Category ${current.length + 1}`, coverId: null },
    ]);
    if (selected.size > 0) moveSelectedTo(id);
  }

  function toggleSelected(photoId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  }

  /** Puts every selected piece in a category, then clears the selection. */
  function moveSelectedTo(categoryId: string) {
    if (selected.size === 0) return;
    setCategories((current) =>
      current.map((category) =>
        category.id !== categoryId &&
        category.coverId &&
        selected.has(category.coverId)
          ? { ...category, coverId: null }
          : category,
      ),
    );
    setRows((current) =>
      (current ?? []).map((row) =>
        selected.has(row.photo.id)
          ? {
              ...row,
              categoryId,
              alsoIn: row.alsoIn.filter((id) => id !== categoryId),
            }
          : row,
      ),
    );
    setSelected(new Set());
  }

  function updateCategory(id: string, patch: Partial<Category>) {
    setCategories((current) =>
      current.map((category) =>
        category.id === id ? { ...category, ...patch } : category,
      ),
    );
  }

  /** Removes a category; its pieces move to the first one left. */
  function removeCategory(id: string) {
    const remaining = categories.filter((category) => category.id !== id);
    if (remaining.length === 0) return;
    setCategories(remaining);
    setRows((current) =>
      (current ?? []).map((row) => {
        const alsoIn = row.alsoIn.filter((other) => other !== id);
        if (row.categoryId !== id) return { ...row, alsoIn };
        // Its primary box is gone: another box it was already in takes over, else the first one left.
        const next = alsoIn[0] ?? remaining[0].id;
        return {
          ...row,
          categoryId: next,
          alsoIn: alsoIn.filter((other) => other !== next),
        };
      }),
    );
  }

  function updateRow(photoId: string, patch: Partial<Row>) {
    setRows((current) =>
      (current ?? []).map((row) =>
        row.photo.id === photoId ? { ...row, ...patch } : row,
      ),
    );
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
            ? [
                ...row.sheets.filter((entry) => entry.file.id !== sheet.id),
                { file: sheet, reason: "manual" },
              ]
            : row.sheets.filter((entry) => entry.file.id !== sheet.id),
      })),
    );
    setLoose((current) => {
      const without = current.filter((entry) => entry.id !== sheet.id);
      return toPhotoId ? without : [...without, sheet];
    });
  }

  function clear() {
    setRows(null);
    setCategories([]);
    setLoose([]);
    setFiles(new Map());
    setFields(new Map());
    setConverted(new Map());
    setSelected(new Set());
    setDetailsFor(null);
    setSkipped(0);
  }

  const withSheets = rows?.filter((row) => row.sheets.length > 0).length ?? 0;
  // The grid shows pieces category by category, in the strip's order.
  const orderedRows = [
    ...categories.flatMap((category) =>
      (rows ?? []).filter((row) => row.categoryId === category.id),
    ),
    // Pieces taken out of every category sit at the end, and are left out of the run.
    ...(rows ?? []).filter(
      (row) => !categories.some((category) => category.id === row.categoryId),
    ),
  ];
  const detailsRow =
    (rows ?? []).find((row) => row.photo.id === detailsFor) ?? null;
  // A removed category can't stay the target; fall back to "new".
  const moveTarget = categories.some(
    (category) => category.id === moveTargetChoice,
  )
    ? moveTargetChoice
    : NEW_CATEGORY;
  const stillReading = (rows ?? []).some(
    (row) =>
      !converted.has(row.photo.id) ||
      row.sheets.some((entry) => !converted.has(entry.file.id)),
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
          accept(
            [...(event.target.files ?? [])].map((file) => ({
              file,
              path: file.webkitRelativePath || "",
            })),
          );
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
          accept(
            [...(event.target.files ?? [])].map((file) => ({ file, path: "" })),
          );
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
            dragging
              ? "border-gold/40 bg-gold/[0.05]"
              : "border-white/[0.10] bg-white/[0.015]",
          )}
        >
          <div>
            <p className="text-sm font-semibold text-cream">Bulk upload</p>
            <p className="mt-0.5 text-[11px] text-faint">
              Drop a folder or many files — photos plus their PDF or Excel
              sheets. Sheets are matched to photos by folder and by name, and
              you check every pair before anything is added.
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
        <>
          {/* Compact sub-header: the title and categories stay put while the pieces scroll beneath. */}
          <div className="sticky -top-6 z-10 -mx-4 -mt-6! space-y-2 border-b border-gold/15 bg-surface px-4 pb-2 pt-3 md:-top-7 md:-mx-8 md:-mt-7! md:px-8">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <p className="text-sm font-semibold text-cream">Your pieces</p>
              <p className="flex items-center gap-1 text-[11px] text-faint">
                {stillReading && <Loader2 size={10} className="animate-spin" />}
                {rows.length} piece{rows.length === 1 ? "" : "s"} · {withSheets}{" "}
                with a sheet
                {loose.length > 0 &&
                  ` · ${loose.length} sheet${loose.length === 1 ? "" : "s"} not matched`}
                {skipped > 0 &&
                  ` · ${skipped} other file${skipped === 1 ? "" : "s"} skipped`}
                {stillReading && " · reading files…"}
              </p>
              {rows.length > max && (
                <p className="text-[11px] text-gold">
                  One run holds up to {max} pieces — remove {rows.length - max}{" "}
                  to continue.
                </p>
              )}
              <label className="ml-auto flex items-center gap-1.5 text-[11px] text-faint">
                Designer letter
                <input
                  value={designerLetter}
                  onChange={(event) => setDesignerLetter(event.target.value.slice(0, 3))}
                  placeholder="R"
                  maxLength={3}
                  title="Starting letter for the codes of pieces without a sheet (R-1) — each piece can override it"
                  aria-label="Designer's starting letter for all pieces"
                  className="h-6 w-9 rounded-md border border-white/[0.10] bg-surface-raised text-center text-[11px] text-cream placeholder:text-faint focus:border-gold/30 focus:outline-none"
                />
              </label>
            </div>

            {/* Categories, side by side. With pieces selected below, clicking one puts them in it. */}
            <div className="space-y-1.5">
              {selected.size > 0 ? (
                // An explicit action for the selection — clicking a box works too, but this says so.
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gold/40 bg-gold/10 px-3 py-2 text-[11px]">
                  <span className="font-semibold text-gold">
                    {selected.size} piece{selected.size === 1 ? "" : "s"}{" "}
                    selected
                  </span>
                  <span className="text-faint">Move to</span>
                  <select
                    value={moveTarget}
                    onChange={(event) => setMoveTarget(event.target.value)}
                    aria-label="Category to move the selected pieces to"
                    className="h-7 rounded-lg border border-white/[0.12] bg-surface-raised px-2 text-[11px] text-cream focus:outline-none"
                  >
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.label || "Untitled category"}
                      </option>
                    ))}
                    <option value={NEW_CATEGORY}>+ New category</option>
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      moveTarget === NEW_CATEGORY
                        ? addCategory()
                        : moveSelectedTo(moveTarget)
                    }
                    className="flex h-7 items-center gap-1 rounded-lg bg-gold px-3 text-[11px] font-semibold text-white transition-opacity hover:opacity-90"
                  >
                    <Check size={12} /> Move
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    className="h-7 rounded-lg px-2 text-[11px] text-faint transition-colors hover:text-cream"
                  >
                    Cancel
                  </button>
                </div>
              ) : null}
              <div className="thin-scrollbar flex gap-2 overflow-x-auto pb-2">
                {categories.map((category, position) => {
                  const members = orderedRows.filter((row) =>
                    inCategory(row, category.id),
                  );
                  const coverId = coverOf(category, members);
                  return (
                    <div
                      key={category.id}
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        if (isControl(event.target)) return;
                        if (selected.size > 0) moveSelectedTo(category.id);
                        else {
                          setSourceFilter(null);
                          setOpenCategory(category.id);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (
                          (event.key === "Enter" || event.key === " ") &&
                          !isControl(event.target)
                        ) {
                          event.preventDefault();
                          if (selected.size > 0) moveSelectedTo(category.id);
                          else setOpenCategory(category.id);
                        }
                      }}
                      title={
                        selected.size > 0
                          ? `Put the selected pieces in ${category.label || "this category"}`
                          : "Open this category"
                      }
                      className={cn(
                        "group/cat flex w-52 shrink-0 items-center gap-2.5 rounded-xl border bg-white/[0.03] p-2 text-left transition-colors",
                        selected.size > 0
                          ? "cursor-pointer border-gold/40 hover:bg-gold/10"
                          : "border-white/[0.10]",
                      )}
                    >
                      <span
                        className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border-2 bg-white"
                        style={{ borderColor: categoryColor(position) }}
                      >
                        {coverId && (
                          /* eslint-disable-next-line @next/next/no-img-element -- a local object URL */
                          <img
                            src={previews.get(coverId)}
                            alt=""
                            className="h-full w-full object-contain"
                          />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <input
                          value={category.label}
                          onChange={(event) =>
                            updateCategory(category.id, {
                              label: event.target.value.slice(0, 100),
                            })
                          }
                          aria-label="Category name"
                          placeholder="Category name"
                          className="w-full truncate bg-transparent text-[11px] font-semibold uppercase tracking-wider text-gold placeholder:text-faint focus:outline-none"
                        />
                        <span className="block text-[10px] text-faint">
                          {members.length} piece
                          {members.length === 1 ? "" : "s"}
                          {selected.size > 0 && (
                            <span className="text-gold">
                              {" "}
                              · + {selected.size} here
                            </span>
                          )}
                        </span>
                      </span>
                      {categories.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeCategory(category.id)}
                          title="Remove the category — its pieces move to the first one"
                          aria-label={`Remove category ${category.label}`}
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-faint opacity-0 transition hover:bg-error/10 hover:text-error group-hover/cat:opacity-100"
                        >
                          <X size={11} />
                        </button>
                      )}
                    </div>
                  );
                })}
                <button
                  type="button"
                  onClick={addCategory}
                  title={
                    selected.size > 0
                      ? "New category, with the selected pieces in it"
                      : "New category"
                  }
                  className="flex w-36 shrink-0 items-center justify-center gap-1 rounded-xl border border-dashed border-white/[0.14] text-[11px] font-medium text-gold/80 transition-colors hover:border-gold/40 hover:text-gold"
                >
                  <Plus size={12} />{" "}
                  {selected.size > 0 ? "New with selected" : "New category"}
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-4 rounded-2xl border border-gold/20 bg-surface-raised/60 p-4">
            {/* The pieces: compact cards, filling the width. Click a card to select it. */}
            <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {orderedRows.map((row) => {
                const position = categories.findIndex(
                  (category) => category.id === row.categoryId,
                );
                const category = categories[position];
                const isCover =
                  Boolean(category) &&
                  coverOf(
                    category,
                    orderedRows.filter((entry) =>
                      inCategory(entry, category.id),
                    ),
                  ) === row.photo.id;
                const isSelected = selected.has(row.photo.id);
                return (
                  <li
                    key={row.photo.id}
                    onClick={(event) => {
                      if (!isControl(event.target))
                        toggleSelected(row.photo.id);
                    }}
                    className={cn(
                      "relative flex cursor-pointer flex-col gap-2 rounded-xl border bg-white/[0.02] p-2.5 transition-colors",
                      isSelected
                        ? "bg-gold/[0.07] ring-1 ring-gold/30"
                        : "hover:brightness-95",
                    )}
                    // The category's colour on the border, so groups read at a glance.
                    style={{
                      borderColor:
                        position >= 0 ? categoryColor(position) : "#B5A89A",
                      borderWidth: 1.5,
                    }}
                  >
                    <div className="flex items-start gap-2.5">
                      {/* The photo opens full size — the same look a result gets. */}
                      <button
                        type="button"
                        onClick={() =>
                          setPreview(previews.get(row.photo.id) ?? null)
                        }
                        title={`Preview ${row.photo.name}`}
                        aria-label={`Preview ${row.photo.name}`}
                        className="group/thumb relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, not something next/image can optimise */}
                        <img
                          src={previews.get(row.photo.id)}
                          alt=""
                          className="h-full w-full object-contain"
                        />
                        <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 transition-opacity group-hover/thumb:opacity-100">
                          <Eye size={13} />
                        </span>
                      </button>

                      <div className="min-w-0 flex-1 space-y-1 pr-12">
                        <p
                          className="truncate text-[11px] font-medium text-cream"
                          title={row.photo.path || row.photo.name}
                        >
                          {row.photo.name}
                        </p>
                        {category && (
                          <span className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-faint">
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ background: categoryColor(position) }}
                            />
                            <span className="truncate">
                              {category.label || "Untitled category"}
                            </span>
                            {/* Also in: one dot per further category. */}
                            {row.alsoIn.map((id) => (
                              <span
                                key={id}
                                title={`Also in ${categories.find((entry) => entry.id === id)?.label || "another category"}`}
                                className="h-1.5 w-1.5 shrink-0 rounded-full"
                                style={{
                                  background: categoryColor(
                                    categories.findIndex(
                                      (entry) => entry.id === id,
                                    ),
                                  ),
                                }}
                              />
                            ))}
                          </span>
                        )}
                        <CompactFields row={row} fields={fields} />
                      </div>
                    </div>

                    {/* Top-right: select, cover, remove. */}
                    <div className="absolute right-2 top-2 flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() =>
                          category &&
                          updateCategory(category.id, { coverId: row.photo.id })
                        }
                        aria-pressed={isCover}
                        title={
                          isCover
                            ? "This piece is its category's cover"
                            : "Use as its category's cover"
                        }
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded-full transition-colors",
                          isCover ? "text-gold" : "text-faint hover:text-gold",
                        )}
                      >
                        <Star
                          size={12}
                          className={isCover ? "fill-current" : undefined}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeRow(row.photo.id)}
                        title={`Remove ${row.photo.name}`}
                        aria-label={`Remove ${row.photo.name}`}
                        className="flex h-6 w-6 items-center justify-center rounded-full text-faint transition-colors hover:bg-error/10 hover:text-error"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelected(row.photo.id)}
                      aria-label={`Select ${row.photo.name}`}
                      className="absolute left-1.5 top-1.5 accent-gold"
                    />

                    {/* A concept carries a designer's credit and the person's own words — there is no sheet to say it. */}
                    {row.sheets.length === 0 && (
                      <div className="flex items-start gap-2">
                        <input
                          value={row.designerInitial}
                          onChange={(event) =>
                            updateRow(row.photo.id, {
                              designerInitial: event.target.value.slice(0, 3),
                            })
                          }
                          placeholder={designerLetter.trim() || "R"}
                          maxLength={3}
                          title="Designer's starting letter — prefixes its code (R-1)"
                          aria-label={`Designer's starting letter for ${row.photo.name}`}
                          className="h-7 w-9 shrink-0 rounded-md border border-white/[0.10] bg-surface-raised text-center text-[11px] text-cream placeholder:text-faint focus:border-gold/30 focus:outline-none"
                        />
                        <textarea
                          value={row.note}
                          onChange={(event) =>
                            updateRow(row.photo.id, {
                              note: event.target.value.slice(0, 1000),
                            })
                          }
                          rows={1}
                          placeholder="Notes for this idea — becomes its caption"
                          aria-label={`Notes for ${row.photo.name}`}
                          className="min-h-7 w-full resize-y rounded-md border border-white/[0.10] bg-surface-raised px-2 py-1 text-[10px] text-cream placeholder:text-faint focus:border-gold/30 focus:outline-none"
                        />
                      </div>
                    )}

                    {/* Bottom: the files this piece travels with, and its full sheet. */}
                    <div className="mt-auto flex flex-wrap items-center gap-1">
                      {row.sheets.length === 0 && (
                        <span className="rounded-full bg-white/[0.06] px-1.5 py-px text-[9px] leading-4 text-faint">
                          No sheet — new ideation
                        </span>
                      )}
                      {row.sheets.map(({ file, reason }) => (
                        <span
                          key={file.id}
                          className="flex min-w-0 max-w-full items-center gap-1 rounded-full border border-gold/25 bg-gold/10 py-px pl-1.5 pr-0.5 text-[9px] leading-4 text-gold"
                          // How it was paired stays a hover detail rather than a label on every chip.
                          title={`${file.path || file.name} — matched by ${REASON_LABEL[reason]}`}
                        >
                          <SheetIcon name={file.name} size={10} />
                          {/* A PDF opens in the browser's viewer; a workbook has no preview there, so it doesn't offer one. */}
                          {isWorkbook(file.name) ? (
                            <span className="min-w-0 truncate">
                              {file.name}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openFile(file.id)}
                              title={`Open ${file.name}`}
                              className="min-w-0 truncate text-left hover:underline"
                            >
                              {file.name}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => moveSheet(file, null)}
                            aria-label={`Unassign ${file.name}`}
                            className="shrink-0 rounded-full p-0.5 hover:bg-gold/20"
                          >
                            <X size={9} />
                          </button>
                        </span>
                      ))}
                      {loose.length > 0 && (
                        <select
                          value=""
                          onChange={(event) => {
                            const sheet = loose.find(
                              (entry) => entry.id === event.target.value,
                            );
                            if (sheet) moveSheet(sheet, row.photo.id);
                          }}
                          className="h-5 rounded-full border border-white/[0.10] bg-surface-raised px-1.5 text-[9px] text-muted focus:outline-none"
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
                      {row.sheets.some(({ file }) => isWorkbook(file.name)) && (
                        <button
                          type="button"
                          onClick={() => setDetailsFor(row.photo.id)}
                          className="ml-auto text-[10px] font-medium text-gold/80 transition-colors hover:text-gold"
                        >
                          Sheet details →
                        </button>
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
                    <li
                      key={sheet.id}
                      className="flex flex-wrap items-center gap-2 text-[11px] text-muted"
                    >
                      <SheetIcon name={sheet.name} />
                      <span
                        className="min-w-0 flex-1 truncate"
                        title={sheet.path || sheet.name}
                      >
                        {sheet.name}
                      </span>
                      <select
                        value=""
                        onChange={(event) =>
                          event.target.value &&
                          moveSheet(sheet, event.target.value)
                        }
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
        </>
      )}

      {/* One category: its name, and other categories' pieces to add. */}
      {(() => {
        const position = categories.findIndex(
          (entry) => entry.id === openCategory,
        );
        const category = categories[position];
        if (!category || !rows) return null;
        const color = categoryColor(position);
        const members = orderedRows.filter((row) =>
          inCategory(row, category.id),
        );
        const others = orderedRows.filter(
          (row) => !inCategory(row, category.id),
        );
        const coverId = coverOf(category, members);
        /** Takes a piece out of this category; if it was the piece's main one, another of its boxes (if any) becomes it; with none left it belongs to no category. */
        const takeOut = (row: Row) => {
          if (row.categoryId !== category.id) {
            updateRow(row.photo.id, {
              alsoIn: row.alsoIn.filter((id) => id !== category.id),
            });
            return;
          }
          const next = row.alsoIn[0] ?? "";
          if (next)
            updateRow(row.photo.id, {
              categoryId: next,
              alsoIn: row.alsoIn.filter((id) => id !== next),
            });
        };
        const thumb = (row: Row, border: string) => (
          // eslint-disable-next-line @next/next/no-img-element -- a local object URL
          <img
            src={previews.get(row.photo.id)}
            alt={row.photo.name}
            className="h-full w-full rounded-lg border-2 bg-white object-contain"
            style={{ borderColor: border }}
          />
        );
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => setOpenCategory(null)}
          >
            <div
              role="dialog"
              aria-label={category.label || "Category"}
              onClick={(event) => event.stopPropagation()}
              className="flex max-h-[85vh] w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-2xl border border-white/10 bg-surface-raised p-5"
            >
              <div className="flex items-center gap-2">
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ background: color }}
                />
                <input
                  value={category.label}
                  onChange={(event) =>
                    updateCategory(category.id, {
                      label: event.target.value.slice(0, 100),
                    })
                  }
                  aria-label="Category name"
                  placeholder="Category name"
                  className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-cream placeholder:text-faint focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setOpenCategory(null)}
                  aria-label="Close"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-faint hover:text-cream"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="space-y-1.5">
                <p className="text-[11px] text-faint">
                  In this category · {members.length} — tap the star to set the
                  cover
                </p>
                <ul className="grid grid-cols-5 gap-1.5 sm:grid-cols-7">
                  {members.map((row) => (
                    <li
                      key={row.photo.id}
                      className="relative aspect-square"
                      title={row.photo.name}
                    >
                      {thumb(row, color)}
                      <button
                        type="button"
                        onClick={() =>
                          updateCategory(category.id, { coverId: row.photo.id })
                        }
                        aria-pressed={coverId === row.photo.id}
                        aria-label={`Use ${row.photo.name} as the cover`}
                        className={cn(
                          "absolute left-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 shadow",
                          coverId === row.photo.id
                            ? "text-gold"
                            : "text-faint hover:text-gold",
                        )}
                      >
                        <Star
                          size={12}
                          className={
                            coverId === row.photo.id
                              ? "fill-current"
                              : undefined
                          }
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => takeOut(row)}
                        title="Remove from this category"
                        aria-label={`Remove ${row.photo.name} from this category`}
                        className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-faint shadow hover:text-error"
                      >
                        <X size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              {others.length > 0 && (
                <div className="space-y-2">
                  {/* Where to pick from: everything not in this category, or one other category. */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-faint">Add from</span>
                    {[
                      {
                        id: "none",
                        label: "Not in any category",
                        color: null as string | null,
                        count: others.filter((row) => !row.categoryId).length,
                      },
                      ...categories
                        .filter((entry) => entry.id !== category.id)
                        .map((entry) => ({
                          id: entry.id,
                          label: entry.label || "Untitled category",
                          color: categoryColor(categories.indexOf(entry)),
                          count: others.filter((row) =>
                            inCategory(row, entry.id),
                          ).length,
                        })),
                    ]
                      .filter((chip) => chip.id === "none" || chip.count > 0)
                      .map((chip) => (
                        <button
                          key={chip.id}
                          type="button"
                          onClick={() =>
                            setSourceFilter((current) =>
                              current === chip.id ? null : chip.id,
                            )
                          }
                          aria-pressed={sourceFilter === chip.id}
                          className={cn(
                            "flex max-w-[11rem] items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                            sourceFilter === chip.id
                              ? "border-gold bg-gold/15 text-gold"
                              : "border-white/[0.14] text-faint hover:border-gold/40 hover:text-gold",
                          )}
                        >
                          {chip.color && (
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ background: chip.color }}
                            />
                          )}
                          <span className="truncate">{chip.label}</span>
                          <span className="shrink-0 opacity-70">
                            {chip.count}
                          </span>
                        </button>
                      ))}
                  </div>

                  {sourceFilter === "none" && !others.some((row) => !row.categoryId) && (
                    <p className="text-[11px] text-faint">
                      Every piece is in a category. A piece you remove from its last category shows up here.
                    </p>
                  )}

                  {sourceFilter && (
                    <ul className="grid grid-cols-5 gap-1.5 sm:grid-cols-7">
                      {others
                        .filter((row) =>
                          sourceFilter === "none"
                            ? !row.categoryId
                            : inCategory(row, sourceFilter),
                        )
                        .map((row) => {
                          const from = categories.findIndex(
                            (entry) => entry.id === row.categoryId,
                          );
                          return (
                            <li
                              key={row.photo.id}
                              className="relative aspect-square"
                              title={row.photo.name}
                            >
                              {thumb(
                                row,
                                from >= 0 ? categoryColor(from) : "#B5A89A",
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  updateRow(
                                    row.photo.id,
                                    row.categoryId
                                      ? { alsoIn: [...row.alsoIn, category.id] }
                                      : { categoryId: category.id },
                                  )
                                }
                                aria-label={`Add ${row.photo.name} to this category`}
                                className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-gold text-white shadow hover:opacity-90"
                              >
                                <Plus size={11} />
                              </button>
                            </li>
                          );
                        })}
                    </ul>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={() => setOpenCategory(null)}
                className="self-end rounded-lg bg-gold px-4 py-1.5 text-[11px] font-semibold text-white hover:opacity-90"
              >
                Done
              </button>
            </div>
          </div>
        );
      })()}

      {/* A piece's whole sheet, on request — too much for a card. */}
      {detailsRow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setDetailsFor(null)}
        >
          <div
            role="dialog"
            aria-label={`Sheet details for ${detailsRow.photo.name}`}
            onClick={(event) => event.stopPropagation()}
            className="max-h-[85vh] w-full max-w-3xl space-y-3 overflow-y-auto rounded-2xl border border-white/10 bg-surface-raised p-4 shadow-2xl"
          >
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL */}
              <img
                src={previews.get(detailsRow.photo.id)}
                alt=""
                className="h-12 w-12 rounded-lg border border-white/10 bg-white object-contain"
              />
              <p className="min-w-0 flex-1 truncate text-sm font-semibold text-cream">
                {detailsRow.photo.name}
              </p>
              <button
                type="button"
                onClick={() => setDetailsFor(null)}
                aria-label="Close"
                className="flex h-7 w-7 items-center justify-center rounded-full text-faint transition-colors hover:text-cream"
              >
                <X size={14} />
              </button>
            </div>
            <SheetPreview
              row={detailsRow}
              fields={fields}
              open
              onToggle={() => setDetailsFor(null)}
            />
          </div>
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
        {styleCodeFromName(row.photo.name) && (
          <> Code from the file name: {styleCodeFromName(row.photo.name)}</>
        )}
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
    const code =
      styleCodeFromName(row.sheets[0].file.name) ??
      styleCodeFromName(row.photo.name);
    return (
      <p className="text-[10px] leading-relaxed text-faint">
        {workbooks.length
          ? "Couldn't pick fields out of this workbook"
          : "PDF sheet"}{" "}
        — the model reads it in full when writing the copy.
        {code && <> Style code from the file name: {code}</>}
      </p>
    );
  }

  const diamonds = [
    merged.diamondCount && `${merged.diamondCount} stones`,
    merged.diamondWeight,
  ]
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
            <dd
              className={cn(
                "min-w-0 truncate",
                value ? "text-cream" : "text-faint/60",
              )}
              title={value ?? undefined}
            >
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
        <ChevronDown
          size={11}
          className={cn("transition-transform", open && "rotate-180")}
        />
        {open ? "Hide sheet details" : "Show all sheet details"}
      </button>
      {open && <SheetDetailsView details={merged.details} />}
    </div>
  );
}

/**
 * The few facts a card has room for — style, metal, gold weight and diamonds
 * — read from the piece's workbook. The rest is one click away in its details.
 */
function CompactFields({
  row,
  fields,
}: {
  row: Row;
  fields: Map<string, SheetFields | null>;
}) {
  if (row.sheets.length === 0) {
    const code = styleCodeFromName(row.photo.name);
    return (
      <p className="text-[10px] text-faint">
        {code ? `Code ${code} · ` : ""}title and caption left for you
      </p>
    );
  }

  const read = row.sheets
    .filter(({ file }) => isWorkbook(file.name))
    .map(({ file }) => fields.get(file.id));
  if (read.some((entry) => entry === undefined)) {
    return (
      <p className="flex items-center gap-1 text-[10px] text-faint">
        <Loader2 size={9} className="animate-spin" /> Reading the sheet…
      </p>
    );
  }
  const sheet = read.find(Boolean);
  if (!sheet) {
    const code =
      styleCodeFromName(row.sheets[0].file.name) ??
      styleCodeFromName(row.photo.name);
    return (
      <p className="text-[10px] text-faint">
        {code ? `${code} · ` : ""}PDF sheet — read in full by the AI
      </p>
    );
  }

  const diamonds = [
    sheet.diamondCount && `${sheet.diamondCount} dia`,
    sheet.diamondWeight,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="space-y-0.5 text-[10px] leading-snug">
      <p
        className="truncate text-cream"
        title={[sheet.styleNo, sheet.category].filter(Boolean).join(" · ")}
      >
        <span className="font-medium">{sheet.styleNo ?? "—"}</span>
        {sheet.category && (
          <span className="text-faint"> · {sheet.category}</span>
        )}
      </p>
      <p
        className="truncate text-faint"
        title={[sheet.metal, sheet.goldWeight, diamonds]
          .filter(Boolean)
          .join(" · ")}
      >
        {[sheet.metal, sheet.goldWeight, diamonds]
          .filter(Boolean)
          .join(" · ") || "—"}
      </p>
    </div>
  );
}

const GROUP_ORDER: DetailGroup[] = [
  "Product",
  "Finishes",
  "Team",
  "Project & customer",
];

/** The single-value fields a second workbook can fill in where the first left a gap. */
const HEADLINE_KEYS = [
  "styleNo",
  "category",
  "metal",
  "goldWeight",
  "diamondCount",
  "diamondWeight",
  "process",
] as const;

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
          const entries = details.fields.filter(
            (field) => field.group === group,
          );
          if (entries.length === 0) return null;
          return (
            <div key={group}>
              <p className="mb-0.5 font-semibold uppercase tracking-wider text-faint">
                {group}
              </p>
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
          <p className="mb-0.5 font-semibold uppercase tracking-wider text-faint">
            Metal parts
          </p>
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
          <p className="mb-0.5 font-semibold uppercase tracking-wider text-faint">
            Stones
          </p>
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
                    <td className={cn(cell, "whitespace-nowrap")}>
                      {stone.size || "—"}
                    </td>
                    <td className={cn(cell, "whitespace-nowrap")}>
                      {stone.sieve || "—"}
                    </td>
                    <td className={cell}>{stone.qty || "—"}</td>
                    <td className={cn(cell, "whitespace-nowrap")}>
                      {stone.weight || "—"}
                    </td>
                    <td className={cell}>{stone.setting || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {weights.length > 0 && (
            <p className="mt-1 text-faint">{weights.join(" · ")}</p>
          )}
        </div>
      )}

      {details.remarks.length > 0 && (
        <div>
          <p className="mb-0.5 font-semibold uppercase tracking-wider text-faint">
            Customer remark
          </p>
          {details.remarks.map((remark, index) => (
            <p
              key={index}
              className="whitespace-pre-line leading-relaxed text-cream"
            >
              {remark}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function SheetIcon({ name, size = 11 }: { name: string; size?: number }) {
  return /\.(xlsx|xlsm|xls|csv)$/i.test(name) ? (
    <FileSpreadsheet size={size} className="shrink-0" />
  ) : (
    <FileText size={size} className="shrink-0" />
  );
}

/**
 * Everything dropped, folders walked — a plain `dataTransfer.files` lists a
 * dropped folder as one unreadable entry, so its contents need the entry API.
 */
async function droppedFiles(
  transfer: DataTransfer,
): Promise<{ file: File; path: string }[]> {
  const entries = [...transfer.items]
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => Boolean(entry));
  if (entries.length === 0)
    return [...transfer.files].map((file) => ({ file, path: "" }));

  const out: { file: File; path: string }[] = [];
  const hasFolder = entries.some((entry) => entry.isDirectory);

  async function walk(entry: FileSystemEntry, path: string) {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      // Same shape as a folder picker's `webkitRelativePath`, so matching treats both alike.
      out.push({ file, path: hasFolder ? `${path}${entry.name}` : "" });
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries hands back at most ~100 at a time; keep asking until it's empty.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      if (batch.length === 0) break;
      for (const child of batch) await walk(child, `${path}${entry.name}/`);
    }
  }

  for (const entry of entries)
    await walk(entry, hasFolder && entry.isFile ? "Dropped/" : "");
  return out;
}
