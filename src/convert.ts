/**
 * Format handling for Morph.
 *
 * Two conversions are genuinely real and local:
 *  - raster image -> WebP / PNG (Canvas2D re-encode)
 *  - CSV / TSV / JSON -> JSON (parsed and re-serialised)
 *
 * Everything else produces a valid file that is clearly labelled as a demo
 * artifact: a rendered seal image, a metadata JSON, or a one-page PDF record.
 */

export type FormatId = "webp" | "png" | "json" | "pdf";
export type ConversionKind = "real" | "demo";

export interface FormatMeta {
  label: string;
  extension: string;
  mime: string;
}

export const FORMATS: Record<FormatId, FormatMeta> = {
  webp: { label: "WEBP", extension: "webp", mime: "image/webp" },
  png: { label: "PNG", extension: "png", mime: "image/png" },
  json: { label: "JSON", extension: "json", mime: "application/json" },
  pdf: { label: "PDF", extension: "pdf", mime: "application/pdf" },
};

export interface ConversionResult {
  blob: Blob;
  filename: string;
  kind: ConversionKind;
  note: string;
}

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "avif",
  "bmp",
  "svg",
  "ico",
]);

const REAL_IMAGE_TARGETS = new Set<FormatId>(["webp", "png"]);

export function extensionOf(name: string): string {
  const clean = name.replace(/\\/g, "/").split("/").pop() ?? name;
  const dot = clean.lastIndexOf(".");
  if (dot <= 0 || dot === clean.length - 1) return "";
  return clean.slice(dot + 1).toLowerCase();
}

export function extensionLabel(name: string): string {
  const extension = extensionOf(name);
  return extension ? extension.toUpperCase() : "FILE";
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 ? Math.round(value) : value >= 10 ? value.toFixed(0) : value.toFixed(1);
  return `${rounded} ${units[unit]}`;
}

function baseName(name: string): string {
  const clean = (name.replace(/\\/g, "/").split("/").pop() ?? "file").trim();
  const dot = clean.lastIndexOf(".");
  const base = dot > 0 ? clean.slice(0, dot) : clean;
  const safe = base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").trim();
  return (safe || "untitled").slice(0, 110);
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || IMAGE_EXTENSIONS.has(extensionOf(file.name));
}

function isDelimitedFile(file: File): boolean {
  const extension = extensionOf(file.name);
  return (
    file.type.includes("csv") ||
    file.type.includes("tab-separated-values") ||
    extension === "csv" ||
    extension === "tsv"
  );
}

function isJsonFile(file: File): boolean {
  return file.type.includes("json") || extensionOf(file.name) === "json";
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(1, maxLength - 1))}…`;
}

export async function convertFile(file: File, target: FormatId): Promise<ConversionResult> {
  const targetMeta = FORMATS[target];
  const filename = `${baseName(file.name)}.${targetMeta.extension}`;
  let fallbackNote = "";

  if (REAL_IMAGE_TARGETS.has(target) && isImageFile(file)) {
    try {
      const blob = await rasterizeImage(file, target as "webp" | "png");
      return {
        blob,
        filename,
        kind: "real",
        note: "Real, local conversion — re-encoded in this tab with Canvas2D. Nothing was uploaded.",
      };
    } catch (error) {
      console.warn("Morph: image conversion fell back to a demo artifact.", error);
      fallbackNote = "The source image could not be decoded here, so this is a labelled demo artifact.";
    }
  }

  if (target === "json" && isDelimitedFile(file)) {
    try {
      const text = await file.text();
      const json = delimitedToJson(text);
      return {
        blob: new Blob([json], { type: "application/json" }),
        filename,
        kind: "real",
        note: "Real, local conversion — parsed in this tab and restructured as JSON. Nothing was uploaded.",
      };
    } catch (error) {
      console.warn("Morph: delimiter conversion fell back to a demo artifact.", error);
      fallbackNote = "The table could not be parsed cleanly, so this is a labelled demo artifact.";
    }
  }

  if (target === "json" && isJsonFile(file)) {
    try {
      const text = await file.text();
      const value: unknown = JSON.parse(text);
      return {
        blob: new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
        filename,
        kind: "real",
        note: "Real, local conversion — reindented in this tab. Nothing was uploaded.",
      };
    } catch (error) {
      console.warn("Morph: JSON reformat fell back to a demo artifact.", error);
      fallbackNote = "The JSON could not be parsed, so this is a labelled demo artifact.";
    }
  }

  if (target === "json") {
    return {
      blob: new Blob([makeMetadataJson(file, target)], { type: "application/json" }),
      filename,
      kind: "demo",
      note: fallbackNote || "Demo artifact — a JSON transmutation record, not a true content conversion.",
    };
  }

  if (target === "pdf") {
    return {
      blob: makePdfRecord(file, target),
      filename,
      kind: "demo",
      note: fallbackNote || "Demo artifact — a valid one-page PDF record, not a true conversion of the source.",
    };
  }

  const seal = await makeSealImage(file, target as "webp" | "png");
  return {
    blob: seal,
    filename,
    kind: "demo",
    note: fallbackNote || "Demo artifact — a rendered transmutation record, not a true image conversion.",
  };
}

/* ------------------------------------------------------------------ */
/* Real image conversion                                              */
/* ------------------------------------------------------------------ */

type DecodedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
};

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Morph: image decode failed."));
    image.src = url;
  });
}

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        dispose: () => bitmap.close(),
      };
    } catch {
      // SVG and a few exotic formats do not always decode as an ImageBitmap.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await loadImageElement(url);
    return {
      source: image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      dispose: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error(`Morph: could not encode ${type}.`));
      },
      type,
      quality,
    );
  });
}

async function rasterizeImage(file: File, target: "webp" | "png"): Promise<Blob> {
  const decoded = await decodeImage(file);
  try {
    if (!decoded.width || !decoded.height) {
      throw new Error("Morph: source image has no dimensions.");
    }

    const maxSide = 7000;
    const maxPixels = 45_000_000;
    const scale = Math.min(
      1,
      maxSide / Math.max(decoded.width, decoded.height),
      Math.sqrt(maxPixels / (decoded.width * decoded.height)),
    );

    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Morph: Canvas 2D is unavailable.");

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(decoded.source, 0, 0, width, height);

    const mime = target === "webp" ? "image/webp" : "image/png";
    const blob = await canvasToBlob(canvas, mime, target === "webp" ? 0.9 : undefined);
    if (blob.type !== mime) {
      throw new Error(`Morph: this browser cannot encode ${mime}.`);
    }
    return blob;
  } finally {
    decoded.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* CSV / TSV -> JSON                                                  */
/* ------------------------------------------------------------------ */

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  let best = ",";
  let bestCount = -1;
  for (const candidate of [",", "\t", ";", "|"]) {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function coerceCell(value: string): string | number | boolean {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(trimmed)) {
    const number = Number(trimmed);
    if (Number.isFinite(number)) return number;
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return trimmed;
}

function delimitedToJson(raw: string): string {
  const text = raw.replace(/^\uFEFF/, "");
  if (!text.trim()) throw new Error("Morph: the table is empty.");

  const delimiter = detectDelimiter(text);
  const rows = parseDelimited(text, delimiter).filter((row) =>
    row.some((cell) => cell.trim() !== ""),
  );
  if (rows.length === 0) throw new Error("Morph: the table is empty.");

  const widest = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const headerSource = rows[0].map((cell, index) => cell.trim() || `column_${index + 1}`);
  while (headerSource.length < widest) headerSource.push(`column_${headerSource.length + 1}`);

  const seen = new Map<string, number>();
  const headers = headerSource.map((name, index) => {
    const base = name || `column_${index + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}_${count}`;
  });

  const records = rows.slice(1).map((row) => {
    const record: Record<string, string | number | boolean> = {};
    headers.forEach((header, index) => {
      record[header] = coerceCell(row[index] ?? "");
    });
    return record;
  });

  return JSON.stringify(records, null, 2);
}

/* ------------------------------------------------------------------ */
/* Demo artifacts                                                     */
/* ------------------------------------------------------------------ */

function safeAscii(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, "?");
}

function pdfEscape(value: string): string {
  return safeAscii(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function pdfCircle(cx: number, cy: number, radius: number): string {
  const k = 0.5522847498;
  const r = radius;
  return [
    `${(cx + r).toFixed(2)} ${cy.toFixed(2)} m`,
    `${(cx + r).toFixed(2)} ${(cy + r * k).toFixed(2)} ${(cx + r * k).toFixed(2)} ${(cy + r).toFixed(2)} ${cx.toFixed(2)} ${(cy + r).toFixed(2)} c`,
    `${(cx - r * k).toFixed(2)} ${(cy + r).toFixed(2)} ${(cx - r).toFixed(2)} ${(cy + r * k).toFixed(2)} ${(cx - r).toFixed(2)} ${cy.toFixed(2)} c`,
    `${(cx - r).toFixed(2)} ${(cy - r * k).toFixed(2)} ${(cx - r * k).toFixed(2)} ${(cy - r).toFixed(2)} ${cx.toFixed(2)} ${(cy - r).toFixed(2)} c`,
    `${(cx + r * k).toFixed(2)} ${(cy - r).toFixed(2)} ${(cx + r).toFixed(2)} ${(cy - r * k).toFixed(2)} ${(cx + r).toFixed(2)} ${cy.toFixed(2)} c`,
    "S",
  ].join("\n");
}

function makePdfRecord(file: File, target: FormatId): Blob {
  const sourceExtension = extensionLabel(file.name);
  const targetMeta = FORMATS[target];
  const date = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const displayName = truncate(file.name, 58);
  const size = formatBytes(file.size);

  const content = [
    "0.039 0.027 0.020 rg",
    "0 0 595 842 re f",
    "0.72 0.49 0.30 RG",
    "0.8 w",
    "34 34 527 774 re S",
    "0.34 0.23 0.14 RG",
    "0.4 w",
    "44 44 507 754 re S",
    "0.94 0.89 0.80 rg",
    "BT /F1 44 Tf 62 752 Td (MORPH) Tj ET",
    "0.72 0.52 0.33 rg",
    "BT /F2 8 Tf 62 734 Td (TRANSMUTATION RECORD / PROTOTYPE 01) Tj ET",
    "0.32 0.22 0.13 RG",
    "0.5 w",
    "62 714 m 533 714 l S",
    "BT /F2 8 Tf 0.72 0.52 0.33 rg 62 690 Td (SOURCE \(INGRESS\)) Tj ET",
    "BT /F2 10 Tf 0.9 0.84 0.74 rg 62 674 Td (" + pdfEscape(displayName) + ") Tj ET",
    "BT /F2 8 Tf 0.72 0.52 0.33 rg 62 652 Td (" +
      pdfEscape(`${sourceExtension} / ${size} / ${file.type || "unknown type"}`) +
      ") Tj ET",
    "BT /F2 8 Tf 0.72 0.52 0.33 rg 368 690 Td (TARGET) Tj ET",
    "BT /F2 10 Tf 0.9 0.84 0.74 rg 368 674 Td (" +
      pdfEscape(`${targetMeta.label} / ${targetMeta.extension.toUpperCase()}`) +
      ") Tj ET",
    "BT /F2 8 Tf 0.72 0.52 0.33 rg 368 652 Td (" + pdfEscape(date) + ") Tj ET",
    "0.72 0.49 0.30 RG",
    "0.55 w",
    pdfCircle(297.5, 470, 106),
    pdfCircle(297.5, 470, 82),
    "0.30 0.20 0.12 RG",
    "0.35 w",
    pdfCircle(297.5, 470, 58),
    "0.72 0.53 0.34 RG",
    "0.55 w",
    "297.5 344 m 338 470 l 297.5 596 l 257 470 l S",
    "297.5 388 m 297.5 552 l S",
    "0.90 0.84 0.74 rg",
    "BT /F1 20 Tf 197 608 Td (A SMALL ACT OF CHEMISTRY) Tj ET",
    "BT /F2 8 Tf 0.72 0.53 0.34 rg 224 292 Td (THE CHAMBER REMEMBERS NOTHING) Tj ET",
    "0.32 0.22 0.13 RG",
    "0.5 w",
    "62 254 m 533 254 l S",
    "BT /F1 14 Tf 0.9 0.84 0.74 rg 62 220 Td (Transmutation verified by the Morph chamber.) Tj ET",
    "BT /F2 8 Tf 0.62 0.51 0.38 rg 62 198 Td (This is a demonstration artifact. It is not a true conversion of the source content.) Tj ET",
    "BT /F2 8 Tf 0.62 0.51 0.38 rg 62 184 Td (Generated locally in the browser. No file was uploaded, stored, or transmitted.) Tj ET",
    "0.72 0.49 0.30 RG",
    "0.6 w",
    "62 138 m 206 138 l S",
    "BT /F2 8 Tf 0.72 0.53 0.34 rg 62 118 Td (DEMONSTRATION ARTIFACT) Tj ET",
    "BT /F2 8 Tf 0.5 0.4 0.3 rg 62 78 Td (MORPH / LOCAL TRANSMUTATION / MMXXVI) Tj ET",
  ].join("\n");

  const contentLength = content.length;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${contentLength} >>\nstream\n${content}\nendstream`,
    "<< /Title (Morph transmutation record) /Author (Morph prototype) /Creator (Morph) /Producer (Morph prototype) >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const startXref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((offset) => {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${startXref}\n%%EOF\n`;

  return new Blob([pdf], { type: "application/pdf" });
}

function makeMetadataJson(file: File, target: FormatId): string {
  const targetMeta = FORMATS[target];
  return JSON.stringify(
    {
      note: "Demo artifact generated by Morph. This is a transmutation record, not a true content conversion.",
      source: {
        name: file.name,
        extension: extensionLabel(file.name),
        sizeBytes: file.size,
        mimeType: file.type || "application/octet-stream",
        lastModified: file.lastModified ? new Date(file.lastModified).toISOString() : null,
      },
      target: {
        format: targetMeta.label,
        extension: targetMeta.extension,
        mimeType: targetMeta.mime,
      },
      generatedAt: new Date().toISOString(),
      prototype: "Morph / Prototype 01",
    },
    null,
    2,
  );
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function trackedWidth(
  context: CanvasRenderingContext2D,
  text: string,
  tracking: number,
): number {
  let width = 0;
  for (const character of text) width += context.measureText(character).width + tracking;
  return Math.max(0, width - tracking);
}

function drawTracked(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
  align: "left" | "center" | "right" = "left",
): void {
  const width = trackedWidth(context, text, tracking);
  let cursor = align === "center" ? x - width / 2 : align === "right" ? x - width : x;
  for (const character of text) {
    context.fillText(character, cursor, y);
    cursor += context.measureText(character).width + tracking;
  }
}

async function makeSealImage(file: File, target: "webp" | "png"): Promise<Blob> {
  const width = 1400;
  const height = 900;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Morph: Canvas 2D is unavailable.");

  const random = seededRandom(hashString(file.name + file.size));

  const background = context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#0b0704");
  background.addColorStop(0.55, "#160d07");
  background.addColorStop(1, "#281207");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  const glow = context.createRadialGradient(930, 390, 20, 930, 390, 560);
  glow.addColorStop(0, "rgba(231, 160, 93, 0.32)");
  glow.addColorStop(0.48, "rgba(166, 85, 41, 0.14)");
  glow.addColorStop(1, "rgba(20, 10, 5, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);

  context.strokeStyle = "rgba(226, 177, 116, 0.32)";
  context.lineWidth = 1;
  context.strokeRect(46.5, 46.5, width - 93, height - 93);
  context.strokeStyle = "rgba(226, 177, 116, 0.12)";
  context.strokeRect(62.5, 62.5, width - 125, height - 125);

  // Stars, seeded so the seal is reproducible.
  for (let index = 0; index < 90; index += 1) {
    const x = random() * width;
    const y = random() * height;
    const alpha = 0.05 + random() * 0.24;
    const size = 0.4 + random() * 1.4;
    context.fillStyle = `rgba(244, 224, 194, ${alpha})`;
    context.beginPath();
    context.arc(x, y, size, 0, Math.PI * 2);
    context.fill();
  }

  // Instrument rings.
  context.save();
  context.translate(930, 390);
  for (const [radius, alpha, lineWidth] of [
    [270, 0.24, 1],
    [222, 0.15, 0.8],
    [158, 0.22, 0.8],
    [92, 0.12, 0.6],
  ]) {
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.strokeStyle = `rgba(235, 183, 120, ${alpha})`;
    context.lineWidth = lineWidth;
    context.stroke();
  }

  for (let index = 0; index < 72; index += 1) {
    const angle = (index / 72) * Math.PI * 2;
    const long = index % 9 === 0;
    context.beginPath();
    context.strokeStyle = `rgba(236, 190, 133, ${long ? 0.34 : 0.12})`;
    context.lineWidth = long ? 1.2 : 0.6;
    context.moveTo(Math.cos(angle) * 286, Math.sin(angle) * 286);
    context.lineTo(Math.cos(angle) * (286 + (long ? 18 : 7)), Math.sin(angle) * (286 + (long ? 18 : 7)));
    context.stroke();
  }

  context.rotate(Math.PI / 4);
  context.strokeStyle = "rgba(242, 201, 146, 0.55)";
  context.lineWidth = 1.1;
  context.strokeRect(-42, -42, 84, 84);
  context.strokeStyle = "rgba(242, 201, 146, 0.22)";
  context.strokeRect(-66, -66, 132, 132);
  context.restore();

  context.fillStyle = "rgba(250, 226, 190, 0.9)";
  context.beginPath();
  context.arc(930, 390, 3.4, 0, Math.PI * 2);
  context.fill();

  for (let index = 0; index < 3; index += 1) {
    const angle = (index / 3) * Math.PI * 2 + 0.55;
    const x = 930 + Math.cos(angle) * 222;
    const y = 390 + Math.sin(angle) * 222;
    context.fillStyle = "rgba(240, 189, 124, 0.85)";
    context.beginPath();
    context.arc(x, y, 3.2, 0, Math.PI * 2);
    context.fill();
  }

  context.fillStyle = "rgba(243, 230, 208, 0.92)";
  context.font = '400 28px "Instrument Serif", Georgia, serif';
  context.fillText("Morph", 92, 132);
  context.fillStyle = "rgba(200, 167, 122, 0.62)";
  context.font = '10px "Inter", -apple-system, sans-serif';
  drawTracked(context, "TRANSMUTATION RECORD / PROTOTYPE 01", 92, 158, 3.2);
  context.fillStyle = "rgba(200, 167, 122, 0.62)";
  context.font = '10px "Inter", -apple-system, sans-serif';
  drawTracked(context, new Date().toISOString().slice(0, 10), 1308, 158, 3.2, "right");

  context.fillStyle = "rgba(241, 230, 210, 0.92)";
  context.font = '400 40px "Instrument Serif", Georgia, serif';
  context.fillText(truncate(file.name, 46), 92, 726);

  context.fillStyle = "rgba(226, 177, 116, 0.7)";
  context.font = '11px "Inter", -apple-system, sans-serif';
  drawTracked(
    context,
    `${extensionLabel(file.name)}  /  ${formatBytes(file.size)}  →  ${FORMATS[target].label}`,
    92,
    758,
    2.6,
  );

  context.strokeStyle = "rgba(226, 177, 116, 0.2)";
  context.beginPath();
  context.moveTo(92, 792);
  context.lineTo(1308, 792);
  context.stroke();

  context.fillStyle = "rgba(198, 165, 122, 0.5)";
  context.font = '9px "Inter", -apple-system, sans-serif';
  drawTracked(context, "A RENDERED RECORD, NOT A TRUE IMAGE CONVERSION", 92, 826, 2.4);
  context.fillStyle = "rgba(224, 168, 105, 0.62)";
  context.font = '9px "Inter", -apple-system, sans-serif';
  drawTracked(context, "DEMO ARTIFACT", 1308, 826, 2.8, "right");

  return canvasToBlob(canvas, FORMATS[target].mime, 0.92);
}

/* ------------------------------------------------------------------ */
/* Sample files                                                       */
/* ------------------------------------------------------------------ */

const SAMPLE_CSV = `id,object,ra_deg,dec_deg,magnitude,night,note
1,Mercury,47.12,19.44,-0.4,01,"Low in the west, quick and bright."
2,Venus,182.65,-23.11,-4.2,01,"A steady lamp above the trees."
3,Mars,310.4,12.8,0.9,02,"Rust-colored, unusually still."
4,Jupiter,88.33,21.7,-2.1,02,"Four small moons strung like beads."
5,Saturn,146.2,-14.6,0.7,03,"The ring tipped open, just barely."
6,Uranus,42.8,15.9,5.8,03,"A pale pinprick in the finder."
7,Neptune,354.1,-6.2,7.9,04,"Almost imaginary at this aperture."
8,Pluto,268.7,-22.5,14.2,04,"A rumor at the edge of the frame."`;

const SAMPLE_NOTES = `MORPH / SAMPLE FIELD NOTES
----------------------------

The chamber is a small machine for changing your mind about a file.
It takes a shape, breaks it into glyphs, and asks the pieces to agree
on a new one.

Observations, in no particular order:

  - A copper ring makes anything feel deliberate.
  - All conversions happen locally.
  - The output is never quite the thing that went in.
  - "Any format" is a promise the real world has not agreed to yet.

This is a demonstration artifact, not a true PDF conversion.
`;

export interface SampleFile {
  file: File;
  description: string;
}

async function makeSampleImage(): Promise<Blob> {
  const width = 1440;
  const height = 960;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Morph: Canvas 2D is unavailable.");

  const random = seededRandom(0x0a1bed);

  const background = context.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, "#0c0704");
  background.addColorStop(0.58, "#190d07");
  background.addColorStop(1, "#2d1408");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  const aura = context.createRadialGradient(920, 400, 20, 920, 400, 620);
  aura.addColorStop(0, "rgba(255, 205, 143, 0.55)");
  aura.addColorStop(0.24, "rgba(223, 143, 76, 0.3)");
  aura.addColorStop(0.6, "rgba(126, 60, 27, 0.12)");
  aura.addColorStop(1, "rgba(12, 7, 4, 0)");
  context.fillStyle = aura;
  context.fillRect(0, 0, width, height);

  for (let index = 0; index < 180; index += 1) {
    const x = random() * width;
    const y = random() * height * 0.72;
    context.fillStyle = `rgba(245, 222, 190, ${0.05 + random() * 0.4})`;
    context.beginPath();
    context.arc(x, y, 0.4 + random() * 1.2, 0, Math.PI * 2);
    context.fill();
  }

  // Sun.
  const sun = context.createRadialGradient(930, 390, 24, 930, 390, 158);
  sun.addColorStop(0, "#ffe6b4");
  sun.addColorStop(0.45, "#f3b872");
  sun.addColorStop(0.78, "#c97439");
  sun.addColorStop(1, "rgba(150, 71, 31, 0)");
  context.fillStyle = sun;
  context.beginPath();
  context.arc(930, 390, 160, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#f9d9a0";
  context.beginPath();
  context.arc(930, 390, 86, 0, Math.PI * 2);
  context.fill();

  // Orbits.
  context.save();
  context.translate(930, 390);
  const orbits: Array<[number, number, number, number]> = [
    [250, 0.24, -0.12, 0.5],
    [330, 0.18, 0.18, 0.36],
    [420, 0.12, -0.24, 0.25],
  ];
  for (const [radius, alpha, rotation, squash] of orbits) {
    context.beginPath();
    context.save();
    context.rotate(rotation);
    context.scale(1, squash);
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.strokeStyle = `rgba(245, 218, 178, ${alpha})`;
    context.lineWidth = 1;
    context.stroke();
    context.restore();
  }

  for (const [x, y, radius, color] of [
    [142, -186, 10, "#e9b172"],
    [-295, 50, 16, "#e2a163"],
    [245, 172, 7, "#f5d4a0"],
    [-92, -338, 5, "#d9955c"],
  ] as Array<[number, number, number, string]>) {
    context.fillStyle = color;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();

  // Horizon.
  const horizon = context.createLinearGradient(0, 610, 0, height);
  horizon.addColorStop(0, "rgba(12, 7, 4, 0)");
  horizon.addColorStop(1, "rgba(9, 5, 3, 0.94)");
  context.fillStyle = horizon;
  context.fillRect(0, 570, width, height - 570);

  context.strokeStyle = "rgba(239, 194, 133, 0.18)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(96, 806);
  context.lineTo(1344, 806);
  context.stroke();

  context.fillStyle = "rgba(247, 231, 205, 0.96)";
  context.font = '400 66px "Instrument Serif", Georgia, serif';
  context.fillText("Orrery No. 7", 96, 758);

  context.fillStyle = "rgba(224, 172, 109, 0.7)";
  context.font = '11px "Inter", -apple-system, sans-serif';
  drawTracked(context, "A STUDY IN COPPER & LIGHT / MORPH SAMPLE", 96, 838, 3);

  context.fillStyle = "rgba(220, 187, 143, 0.44)";
  context.font = '10px "Inter", -apple-system, sans-serif';
  drawTracked(context, "1440 × 960", 1344, 838, 2.2, "right");

  return canvasToBlob(canvas, "image/png");
}

export async function makeSampleFile(target: FormatId): Promise<SampleFile> {
  if (target === "json") {
    return {
      file: new File([SAMPLE_CSV], "observations.csv", {
        type: "text/csv",
        lastModified: Date.now(),
      }),
      description: "A small CSV of night-sky observations.",
    };
  }

  if (target === "pdf") {
    return {
      file: new File([SAMPLE_NOTES], "field-notes.txt", {
        type: "text/plain",
        lastModified: Date.now(),
      }),
      description: "A page of field notes, destined for the PDF demo.",
    };
  }

  const blob = await makeSampleImage();
  return {
    file: new File([blob], "orrery-no-7.png", {
      type: "image/png",
      lastModified: Date.now(),
    }),
    description: "A small painting of an orrery.",
  };
}
