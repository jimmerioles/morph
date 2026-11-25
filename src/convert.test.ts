import { afterEach, describe, expect, it, vi } from "vitest";
import {
  convertFile,
  extensionLabel,
  extensionOf,
  formatBytes,
  makeSampleFile,
  type FormatId,
} from "./convert.ts";

// Image encoding and the rendered seal need a real canvas, so those paths stay
// on the manual browser checklist. Everything below runs in Node.
const LAST_MODIFIED = Date.UTC(2026, 0, 2, 3, 4, 5);

function makeFile(name: string, contents: BlobPart, type = ""): File {
  return new File([contents], name, { type, lastModified: LAST_MODIFIED });
}

async function convert(
  name: string,
  contents: BlobPart,
  type: string,
  target: FormatId,
): Promise<{ file: File; result: Awaited<ReturnType<typeof convertFile>>; text: string }> {
  const file = makeFile(name, contents, type);
  const result = await convertFile(file, target);
  return { file, result, text: await result.blob.text() };
}

async function convertTable(
  name: string,
  contents: string,
  type = "text/csv",
): Promise<{
  result: Awaited<ReturnType<typeof convertFile>>;
  rows: Array<Record<string, unknown>>;
}> {
  const { result, text } = await convert(name, contents, type, "json");
  return { result, rows: JSON.parse(text) as Array<Record<string, unknown>> };
}

describe("file name and size helpers", () => {
  it.each([
    ["report.CSV", "csv"],
    ["archive.tar.gz", "gz"],
    ["dir/report.png", "png"],
    ["dir\\report.PNG", "png"],
    [".gitignore", ""],
    ["archive.", ""],
    ["no-extension", ""],
    ["", ""],
  ])("extensionOf(%j) is %j", (name, expected) => {
    expect(extensionOf(name)).toBe(expected);
  });

  it.each([
    ["report.csv", "CSV"],
    [".gitignore", "FILE"],
    ["archive.", "FILE"],
    ["", "FILE"],
  ])("extensionLabel(%j) is %j", (name, expected) => {
    expect(extensionLabel(name)).toBe(expected);
  });

  it.each([
    [0, "0 B"],
    [1, "1 B"],
    [1023, "1023 B"],
    [1024, "1.0 KB"],
    [1536, "1.5 KB"],
    [10 * 1024, "10 KB"],
    [100 * 1024, "100 KB"],
    [1.5 * 1024 * 1024, "1.5 MB"],
    [1024 ** 3, "1.0 GB"],
    [-1, "unknown"],
    [Number.NaN, "unknown"],
    [Number.POSITIVE_INFINITY, "unknown"],
  ])("formatBytes(%j) is %j", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe("delimited text to JSON", () => {
  it("converts a simple CSV with typed cells", async () => {
    const { result, rows } = await convertTable(
      "people.csv",
      "name,age,active\nAda,36,true",
    );

    expect(result.filename).toBe("people.json");
    expect(result.kind).toBe("real");
    expect(result.blob.type).toBe("application/json");
    expect(result.note).toContain("Real, local conversion");
    expect(rows).toEqual([{ name: "Ada", age: 36, active: true }]);
  });

  it.each([
    ["comma", "a,b\n1,2"],
    ["semicolon", "a;b\n1;2"],
    ["pipe", "a|b\n1|2"],
    ["tab", "a\tb\n1\t2"],
  ])("detects the %s delimiter", async (_label, source) => {
    const { result, rows } = await convertTable("table.csv", source);

    expect(result.kind).toBe("real");
    expect(rows).toEqual([{ a: 1, b: 2 }]);
  });

  it("ignores delimiters inside quoted headers", async () => {
    const { rows } = await convertTable("quoted-header.csv", '"a,b";c\n1;2');

    expect(rows).toEqual([{ "a,b": 1, c: 2 }]);
  });

  it("still chooses a comma when a quoted header contains one", async () => {
    const { rows } = await convertTable(
      "names.csv",
      '"last, first",age\n"Lovelace, Ada",36',
    );

    expect(rows).toEqual([{ "last, first": "Lovelace, Ada", age: 36 }]);
  });

  it("parses quoted commas, escaped quotes, and embedded newlines", async () => {
    const source = [
      "name,note",
      'Ada,"hello, world"',
      'Bob,"She said ""hi"""',
      'Cy,"line one\nline two"',
    ].join("\n");

    const { rows } = await convertTable("notes.csv", source);

    expect(rows).toEqual([
      { name: "Ada", note: "hello, world" },
      { name: "Bob", note: 'She said "hi"' },
      { name: "Cy", note: "line one\nline two" },
    ]);
  });

  it("strips a BOM and accepts CRLF line endings", async () => {
    const { rows } = await convertTable("bom.csv", "\uFEFFa,b\r\n1,2\r\n");

    expect(rows).toEqual([{ a: 1, b: 2 }]);
  });

  it("keeps duplicate headers unique without dropping data", async () => {
    const { rows } = await convertTable("duplicate.csv", "name,name,name_2\na,b,c");

    expect(rows).toEqual([{ name: "a", name_2: "b", name_2_2: "c" }]);
    expect(Object.keys(rows[0] ?? {})).toHaveLength(3);
  });

  it("names blank headers and pads ragged rows", async () => {
    const { rows } = await convertTable("ragged.csv", ",b\n1,2,3");

    expect(rows).toEqual([{ column_1: 1, b: 2, column_3: 3 }]);
  });

  it("preserves leading zeros and exponents, and coerces numbers and booleans", async () => {
    const { rows } = await convertTable(
      "types.csv",
      "value\n1\n-2.5\ntrue\nfalse\n007\n1e3",
    );

    expect(rows).toEqual([
      { value: 1 },
      { value: -2.5 },
      { value: true },
      { value: false },
      { value: "007" },
      { value: "1e3" },
    ]);
  });

  it("recognises tables by MIME type and by case-insensitive extension", async () => {
    const byMime = await convertTable("table", "a,b\n1,2", "text/csv");
    expect(byMime.result.kind).toBe("real");
    expect(byMime.rows).toEqual([{ a: 1, b: 2 }]);

    const byExtension = await convertTable("REPORT.CSV", "a,b\n1,2", "");
    expect(byExtension.result.kind).toBe("real");
    expect(byExtension.result.filename).toBe("REPORT.json");
  });
});

describe("JSON reformatting", () => {
  it("reindents JSON with two spaces", async () => {
    const { result, text } = await convert(
      "data.json",
      '{"b":1,"a":[true,null,2.5]}',
      "application/json",
      "json",
    );

    expect(result.kind).toBe("real");
    expect(result.filename).toBe("data.json");
    expect(text).toBe(`{
  "b": 1,
  "a": [
    true,
    null,
    2.5
  ]
}`);
  });
});

describe("the real or demo contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["table.csv", "a,b\n1,2", "text/csv", "real"],
    ["table.tsv", "a\tb\n1\t2", "text/tab-separated-values", "real"],
    ["data.json", '{"a":1}', "application/json", "real"],
    ["notes.txt", "hello", "text/plain", "demo"],
    ["archive.bin", "hello", "application/octet-stream", "demo"],
  ] as const)("classifies %s as %s", async (name, source, type, kind) => {
    const { result } = await convert(name, source, type, "json");

    expect(result.kind).toBe(kind);
    if (kind === "real") {
      expect(result.note).toContain("Real, local conversion");
    } else {
      expect(result.note.toLowerCase()).toContain("demo");
    }
  });

  it("labels an unsupported source as a demo metadata record", async () => {
    const { result, text } = await convert("notes.txt", "hello", "text/plain", "json");

    expect(result.kind).toBe("demo");
    expect(result.filename).toBe("notes.json");
    expect(result.note).toContain("Demo artifact");

    const metadata = JSON.parse(text) as Record<string, any>;
    expect(metadata.source).toEqual({
      name: "notes.txt",
      extension: "TXT",
      sizeBytes: 5,
      mimeType: "text/plain",
      lastModified: new Date(LAST_MODIFIED).toISOString(),
    });
    expect(metadata.target).toEqual({
      format: "JSON",
      extension: "json",
      mimeType: "application/json",
    });
    expect(metadata.prototype).toBe("Morph / Prototype 01");
    expect(Date.parse(metadata.generatedAt)).not.toBeNaN();
  });

  it.each([
    ["empty.csv", "", "text/csv"],
    ["blank.csv", " \n \n", "text/csv"],
    ["bad.json", "{nope", "application/json"],
  ])("falls back to a labelled demo when %s cannot be parsed", async (name, source, type) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { result, text } = await convert(name, source, type, "json");

    expect(result.kind).toBe("demo");
    expect(result.note.toLowerCase()).toContain("demo artifact");
    expect(warn).toHaveBeenCalled();

    const metadata = JSON.parse(text) as Record<string, any>;
    expect(metadata.note).toContain("Demo artifact");
  });

  it("always labels PDF output as demo, even for table input", async () => {
    const { result } = await convert("table.csv", "a,b\n1,2", "text/csv", "pdf");

    expect(result.kind).toBe("demo");
    expect(result.filename).toBe("table.pdf");
    expect(result.blob.type).toBe("application/pdf");
    expect(result.note).toContain("Demo artifact");
  });
});

describe("output filenames", () => {
  it("strips paths and characters that browsers or filesystems dislike", async () => {
    const relative = await convert("../evil?.csv", "a,b\n1,2", "text/csv", "json");
    expect(relative.result.filename).toBe("evil-.json");

    const windows = await convert("C:\\reports\\Q1.CSV", "a,b\n1,2", "text/csv", "json");
    expect(windows.result.filename).toBe("Q1.json");
  });

  it("caps a very long base name", async () => {
    const { result } = await convert(
      `${"a".repeat(150)}.csv`,
      "a,b\n1,2",
      "text/csv",
      "json",
    );

    expect(result.filename).toBe(`${"a".repeat(110)}.json`);
  });
});

describe("the PDF record", () => {
  it("writes a structurally valid PDF with a correct xref table", async () => {
    const { text } = await convert("table.csv", "a,b\n1,2", "text/csv", "pdf");

    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text.endsWith("%%EOF\n")).toBe(true);

    const startxref = Number(text.match(/startxref\n(\d+)\n%%EOF\n$/)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");

    const xref = text.match(/xref\n0 (\d+)\n([\s\S]*?)\ntrailer/)!;
    const size = Number(xref[1]);
    const entries = xref[2]!.split("\n");
    expect(entries).toHaveLength(size);
    expect(entries[0]).toBe("0000000000 65535 f ");

    for (let object = 1; object < size; object += 1) {
      const entry = entries[object]!;
      const offset = Number(entry.slice(0, 10));
      expect(entry.slice(10)).toBe(" 00000 n ");
      expect(text.slice(offset, offset + `${object} 0 obj`.length)).toBe(`${object} 0 obj`);
    }

    expect(text).toContain(`/Size ${size}`);
    expect(text).toContain("/Root 1 0 R");
    expect(text).toContain(`/Info ${size - 1} 0 R`);
  });

  it("declares the exact stream length and keeps the stream ASCII", async () => {
    const { text } = await convert("notes.txt", "hello", "text/plain", "pdf");

    const stream = text.match(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/)!;
    const declared = Number(stream[1]);
    const content = stream[2]!;

    expect(content).toHaveLength(declared);
    expect(/^[\x20-\x7e\n]*$/.test(content)).toBe(true);
  });

  it("escapes parentheses and transliterates non-ASCII source names", async () => {
    const { result, text } = await convert(
      "résumé (final).txt",
      "hello",
      "text/plain",
      "pdf",
    );

    expect(result.filename).toBe("résumé (final).pdf");
    expect(text).toContain("r?sum? \\(final\\).txt");
    expect(text).not.toContain("résumé");
  });
});

describe("generated samples", () => {
  it("ships a CSV sample that converts to real JSON", async () => {
    const sample = await makeSampleFile("json");
    expect(sample.file.name).toBe("observations.csv");

    const result = await convertFile(sample.file, "json");
    expect(result.kind).toBe("real");

    const rows = JSON.parse(await result.blob.text()) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(8);
    expect(rows[0]).toMatchObject({
      object: "Mercury",
      ra_deg: 47.12,
      magnitude: -0.4,
    });
  });

  it("ships a text sample that exercises the PDF demo", async () => {
    const sample = await makeSampleFile("pdf");
    expect(sample.file.name).toBe("field-notes.txt");
    expect(sample.file.type).toBe("text/plain");

    const result = await convertFile(sample.file, "pdf");
    expect(result.kind).toBe("demo");
  });
});
