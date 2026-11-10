import "./style.css";
import { AudioEngine } from "./audio.ts";
import { Chamber } from "./chamber.ts";
import {
  FORMATS,
  convertFile,
  extensionLabel,
  formatBytes,
  makeSampleFile,
  type ConversionResult,
  type FormatId,
} from "./convert.ts";

type UiState = "idle" | "working" | "done";

const MAX_FILE_BYTES = 60 * 1024 * 1024;

function mustQuery<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Morph: missing ${selector}`);
  return element;
}

const canvas = mustQuery<HTMLCanvasElement>("#chamber-canvas");
const stage = mustQuery<HTMLElement>("#stage");
const dropCore = mustQuery<HTMLButtonElement>("#drop-core");
const coreTitle = mustQuery<HTMLElement>("#core-title");
const coreTarget = mustQuery<HTMLElement>("#core-target");
const fileInput = mustQuery<HTMLInputElement>("#file-input");
const fileCard = mustQuery<HTMLDivElement>("#file-card");
const fileThumb = mustQuery<HTMLElement>("#file-thumb");
const fileExt = mustQuery<HTMLElement>("#file-ext");
const fileName = mustQuery<HTMLElement>("#file-name");
const fileMeta = mustQuery<HTMLElement>("#file-meta");

const chamberProgress = mustQuery<HTMLElement>("#chamber-progress");
const progressWord = mustQuery<HTMLElement>("#progress-word");
const progressSub = mustQuery<HTMLElement>("#progress-sub");
const progressPct = mustQuery<HTMLElement>("#progress-pct");
const progressFill = mustQuery<HTMLElement>("#progress-fill");

const resultPanel = mustQuery<HTMLElement>("#result-panel");
const resultBadge = mustQuery<HTMLElement>("#result-badge");
const resultThumb = mustQuery<HTMLElement>("#result-thumb");
const resultExt = mustQuery<HTMLElement>("#result-ext");
const resultTitle = mustQuery<HTMLElement>("#result-title");
const resultFrom = mustQuery<HTMLElement>("#result-from");
const resultTo = mustQuery<HTMLElement>("#result-to");
const resultDelta = mustQuery<HTMLElement>("#result-delta");
const resultSize = mustQuery<HTMLElement>("#result-size");
const resultDownload = mustQuery<HTMLAnchorElement>("#result-download");
const downloadLabel = mustQuery<HTMLElement>("#download-label");
const resultNote = mustQuery<HTMLElement>("#result-note");

const formats = mustQuery<HTMLElement>("#formats");
const formatButtons = Array.from(formats.querySelectorAll<HTMLButtonElement>(".format"));
const primaryAction = mustQuery<HTMLButtonElement>("#primary-action");
const primaryLabel = mustQuery<HTMLElement>("#primary-label");
const sampleAction = mustQuery<HTMLButtonElement>("#sample-action");
const prototypeNote = mustQuery<HTMLElement>("#prototype-note");

const soundButton = mustQuery<HTMLButtonElement>("#sound");
const howOpen = mustQuery<HTMLButtonElement>("#how-open");
const howDialog = mustQuery<HTMLDialogElement>("#how-dialog");
const howClose = mustQuery<HTMLButtonElement>("#how-close");
const srStatus = mustQuery<HTMLElement>("#sr-status");
const toast = mustQuery<HTMLElement>("#toast");

const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
let reducedMotion = reducedQuery.matches;

const audio = new AudioEngine();
const chamber = new Chamber(canvas, reducedMotion);

let uiState: UiState = "idle";
let selectedFormat: FormatId = "webp";
let activeRun = 0;
let downloadUrl: string | null = null;
let previewUrl: string | null = null;
let toastTimer = 0;
let dragDepth = 0;

const CAPABILITY_NOTES: Record<FormatId, string> = {
  webp: "Real image conversion to WebP in your browser. Other file types return a labelled demo artifact.",
  png: "Real image conversion to PNG in your browser. Other file types return a labelled demo artifact.",
  json: "CSV, TSV, and JSON convert for real. Other file types return a labelled demo artifact.",
  pdf: "PDF output is a prototype demo artifact — not a true PDF conversion.",
};

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function announce(message: string): void {
  srStatus.textContent = message;
}

function showToast(message: string): void {
  toast.textContent = message;
  toast.hidden = false;

  if (!reducedMotion) {
    toast.animate(
      [
        { opacity: 0, transform: "translate(-50%, 12px)" },
        { opacity: 1, transform: "translate(-50%, 0)" },
      ],
      { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" },
    );
  }

  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 5000);
}

function updateTargetUI(): void {
  const meta = FORMATS[selectedFormat];
  coreTarget.textContent = meta.label;
  dropCore.setAttribute(
    "aria-label",
    `Drop a file or click to browse. Output format ${meta.label}.`,
  );
  for (const button of formatButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.format === selectedFormat));
  }
  prototypeNote.textContent = CAPABILITY_NOTES[selectedFormat];
}

function setUiState(next: UiState): void {
  uiState = next;

  stage.classList.toggle("is-working", next === "working");
  stage.classList.toggle("is-done", next === "done");
  stage.setAttribute("aria-busy", next === "working" ? "true" : "false");

  dropCore.disabled = next !== "idle";
  for (const button of formatButtons) button.disabled = next !== "idle";

  primaryAction.disabled = next === "working";
  primaryAction.classList.toggle("is-ghost", next !== "idle");
  primaryLabel.textContent =
    next === "idle" ? "Drop a file" : next === "working" ? "Transmuting…" : "Convert another";

  sampleAction.disabled = next === "working";
  sampleAction.hidden = next === "done";
}

function clearPreview(): void {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
  fileThumb.style.backgroundImage = "";
  fileThumb.classList.remove("has-image");
}

function clearDownload(): void {
  if (downloadUrl) {
    URL.revokeObjectURL(downloadUrl);
    downloadUrl = null;
  }
  resultThumb.style.backgroundImage = "";
  resultThumb.classList.remove("has-image");
}

function resetChamber(options: { focus?: boolean; announceReset?: boolean } = {}): void {
  const { focus = true, announceReset = true } = options;
  activeRun += 1;

  clearPreview();
  clearDownload();

  fileCard.getAnimations().forEach((animation) => animation.cancel());
  fileCard.hidden = true;
  chamberProgress.hidden = true;
  chamberProgress.classList.remove("is-out");
  resultPanel.hidden = true;

  setUiState("idle");
  chamber.reset();

  if (announceReset) {
    announce("Chamber reset. Choose a format or drop a file.");
  }

  if (focus) primaryAction.focus({ preventScroll: true });
}

function showFileCard(file: File): DOMRect {
  clearPreview();
  fileCard.getAnimations().forEach((animation) => animation.cancel());
  fileCard.hidden = false;

  fileExt.textContent = extensionLabel(file.name);
  fileName.textContent = file.name;
  fileName.title = file.name;
  fileMeta.textContent = `${formatBytes(file.size)} · entering the chamber`;

  if (file.type.startsWith("image/")) {
    previewUrl = URL.createObjectURL(file);
    fileThumb.style.backgroundImage = `url("${previewUrl}")`;
    fileThumb.classList.add("has-image");
  }

  const bounds = fileCard.getBoundingClientRect();

  if (!reducedMotion) {
    fileCard.animate(
      [
        { opacity: 0, transform: "translateY(-38px) scale(.94)", filter: "blur(6px)" },
        { opacity: 1, transform: "translateY(0) scale(1)", filter: "blur(0px)" },
      ],
      { duration: 430, easing: "cubic-bezier(.16,.84,.3,1)" },
    );
  }

  return bounds;
}

function shredFileCard(): void {
  if (fileCard.hidden) return;

  fileCard.animate(
    [
      { opacity: 1, transform: "translateY(0) scale(1)", filter: "blur(0px)" },
      { opacity: 0, transform: "translateY(96px) scale(.62)", filter: "blur(5px)" },
    ],
    { duration: 310, easing: "cubic-bezier(.5,0,.9,.4)", fill: "forwards" },
  );

  window.setTimeout(() => {
    if (uiState === "working") {
      fileCard.hidden = true;
      clearPreview();
    }
  }, 320);
}

function showProgress(percent: number, word: string, sub: string): void {
  chamberProgress.hidden = false;
  chamberProgress.classList.remove("is-out");
  progressWord.textContent = word;
  progressSub.textContent = sub;
  progressPct.textContent = `${Math.round(percent)}%`;
  progressFill.style.width = `${percent}%`;
  chamber.setProgress(percent / 100, reducedMotion);
}

function hideProgressAfter(delay: number): void {
  window.setTimeout(() => {
    if (uiState !== "done") return;
    chamberProgress.classList.add("is-out");
    window.setTimeout(() => {
      if (uiState === "done") chamberProgress.hidden = true;
    }, 220);
  }, delay);
}

function showResult(file: File, target: FormatId, result: ConversionResult): void {
  const targetMeta = FORMATS[target];

  clearDownload();
  downloadUrl = URL.createObjectURL(result.blob);

  resultBadge.textContent = result.kind === "real" ? "REAL" : "DEMO";
  resultBadge.classList.toggle("is-demo", result.kind === "demo");
  resultBadge.title =
    result.kind === "real"
      ? "A real, local conversion"
      : "A generated demo artifact, clearly labelled";

  resultExt.textContent = targetMeta.label;
  resultTitle.textContent = result.filename;
  resultTitle.title = result.filename;
  resultFrom.textContent = extensionLabel(file.name);
  resultTo.textContent = targetMeta.label;
  resultSize.textContent = `${formatBytes(file.size)} → ${formatBytes(result.blob.size)}`;

  const ratio =
    file.size > 0 ? Math.round(((result.blob.size - file.size) / file.size) * 100) : 0;
  resultDelta.textContent =
    ratio === 0 ? "±0%" : `${ratio < 0 ? "−" : "+"}${Math.abs(ratio)}%`;
  resultDelta.classList.toggle("is-larger", ratio > 0);
  resultNote.textContent = result.note;

  resultDownload.href = downloadUrl;
  resultDownload.download = result.filename;
  resultDownload.setAttribute(
    "aria-label",
    `Download ${result.filename}, ${result.kind === "real" ? "real conversion" : "demo artifact"}`,
  );
  downloadLabel.textContent = targetMeta.label;

  if (result.blob.type.startsWith("image/")) {
    resultThumb.style.backgroundImage = `url("${downloadUrl}")`;
    resultThumb.classList.add("has-image");
  }

  resultPanel.hidden = false;

  if (!reducedMotion) {
    resultPanel.animate(
      [
        {
          opacity: 0,
          transform: "translateY(26px) scale(.95)",
          filter: "blur(8px)",
        },
        {
          opacity: 1,
          transform: "translateY(0) scale(1)",
          filter: "blur(0px)",
        },
      ],
      { duration: 620, easing: "cubic-bezier(.16,.9,.28,1.06)" },
    );
  }
}

function focusResultWhenSettled(): void {
  window.setTimeout(
    () => {
      if (uiState !== "done" || howDialog.open) return;
      const active = document.activeElement;
      const focusIsNearStage =
        active === document.body ||
        active === null ||
        active === primaryAction ||
        active === sampleAction ||
        (active instanceof Node && stage.contains(active));
      if (focusIsNearStage) resultPanel.focus({ preventScroll: true });
    },
    reducedMotion ? 30 : 360,
  );
}

function failChamber(message: string): void {
  activeRun += 1;
  audio.error();
  chamber.reset();
  fileCard.hidden = true;
  chamberProgress.hidden = true;
  chamberProgress.classList.remove("is-out");
  clearPreview();
  setUiState("idle");
  showToast(message);
  announce(message);
  primaryAction.focus({ preventScroll: true });
}

async function handleFile(file: File): Promise<void> {
  if (uiState === "working") {
    showToast("The chamber is still working. Give it a moment.");
    return;
  }

  if (file.size === 0) {
    audio.error();
    showToast("That file is empty — there is nothing to transmute.");
    announce("That file is empty. Choose another file.");
    return;
  }

  if (file.size > MAX_FILE_BYTES) {
    audio.error();
    showToast("That file is too heavy for the chamber. Try one under 60 MB.");
    announce("That file is too large. Try a file under 60 megabytes.");
    return;
  }

  if (uiState === "done") {
    resetChamber({ focus: false, announceReset: false });
  }

  const run = (activeRun += 1);
  const target = selectedFormat;
  const targetMeta = FORMATS[target];
  const useReduced = reducedMotion;

  setUiState("working");
  announce(`Transmuting ${file.name} into ${targetMeta.label}.`);
  audio.unlock();

  let conversionError: unknown = null;
  const conversionPromise = convertFile(file, target).catch((error: unknown) => {
    conversionError = error;
    console.error("Morph: conversion failed.", error);
    return null;
  });

  if (!useReduced) {
    const bounds = showFileCard(file);
    await wait(440);
    if (run !== activeRun) return;

    chamber.ingest(bounds);
    audio.shred();
    shredFileCard();
    showProgress(15, "Shredding", "Separating the essence");
  } else {
    audio.shred();
    showProgress(18, "Shredding", "Separating the essence");
  }

  await wait(useReduced ? 210 : 480);
  if (run !== activeRun) return;

  chamber.forge();
  audio.forge();
  showProgress(48, "Recasting", "Holding the new shape");

  await wait(useReduced ? 240 : 640);
  if (run !== activeRun) return;

  showProgress(78, "Annealing", "Cooling the metal");

  await wait(useReduced ? 220 : 520);
  if (run !== activeRun) return;

  fileCard.hidden = true;

  const result = await conversionPromise;
  if (run !== activeRun) return;

  if (!result) {
    console.error("Morph: no result.", conversionError);
    failChamber("That one wouldn't go through the chamber. Try another file.");
    return;
  }

  showProgress(96, "Condensing", "One last turn");
  await wait(useReduced ? 90 : 280);
  if (run !== activeRun) return;

  showProgress(100, "Settling", "A new form, cooling");
  chamber.complete();
  audio.ding();
  hideProgressAfter(useReduced ? 10 : 240);

  showResult(file, target, result);
  setUiState("done");

  const ratio =
    file.size > 0 ? Math.round(((result.blob.size - file.size) / file.size) * 100) : 0;
  const change =
    ratio === 0
      ? "the same size"
      : `${Math.abs(ratio)} percent ${ratio < 0 ? "smaller" : "larger"}`;
  announce(
    `Transmutation complete. ${result.filename}, ${formatBytes(
      result.blob.size,
    )}, ${change}. ${result.kind === "real" ? "Real conversion." : "Demo artifact."} Download is ready.`,
  );

  focusResultWhenSettled();
}

function openHow(): void {
  if (!howDialog.open) howDialog.showModal();
}

function renderSound(): void {
  soundButton.classList.toggle("is-muted", audio.muted);
  soundButton.setAttribute("aria-pressed", String(audio.muted));
  soundButton.setAttribute("aria-label", audio.muted ? "Unmute sound" : "Mute sound");
}

updateTargetUI();
setUiState("idle");
renderSound();

for (const button of formatButtons) {
  button.addEventListener("click", () => {
    if (uiState !== "idle") return;
    const next = button.dataset.format;
    if (!next || !(next in FORMATS)) return;
    selectedFormat = next as FormatId;
    updateTargetUI();
    chamber.accent();
  });
}

dropCore.addEventListener("click", () => {
  if (uiState !== "idle") return;
  audio.unlock();
  fileInput.click();
});

primaryAction.addEventListener("click", () => {
  if (uiState === "working") return;
  if (uiState === "done") {
    resetChamber();
    return;
  }
  audio.unlock();
  fileInput.click();
});

sampleAction.addEventListener("click", () => {
  if (uiState !== "idle") return;
  sampleAction.disabled = true;
  audio.unlock();

  void makeSampleFile(selectedFormat)
    .then((sample) => handleFile(sample.file))
    .catch((error: unknown) => {
      console.error("Morph: could not generate a sample.", error);
      sampleAction.disabled = false;
      showToast("The sample didn't pour. Try again.");
      announce("The sample could not be generated. Try again.");
    });
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (file) void handleFile(file);
});

stage.addEventListener("click", (event) => {
  if (uiState !== "idle") return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest("button, a, input, .result-panel")) return;
  audio.unlock();
  fileInput.click();
});

soundButton.addEventListener("click", () => {
  audio.setMuted(!audio.muted);
  renderSound();
  if (!audio.muted) audio.unlock();
});

howOpen.addEventListener("click", openHow);
howClose.addEventListener("click", () => howDialog.close());
howDialog.addEventListener("click", (event) => {
  if (event.target === howDialog) howDialog.close();
});

window.addEventListener(
  "pointerdown",
  () => {
    audio.unlock();
  },
  { once: true, capture: true },
);
window.addEventListener(
  "keydown",
  () => {
    audio.unlock();
  },
  { once: true, capture: true },
);

function isFileDrag(event: DragEvent): boolean {
  const transfer = event.dataTransfer;
  if (!transfer) return false;
  return Array.from(transfer.types).includes("Files");
}

function clearDragHighlight(): void {
  dragDepth = 0;
  stage.classList.remove("is-dragover");
  coreTitle.textContent = "Drop a file";
}

stage.addEventListener("dragenter", (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  if (uiState === "working") return;

  dragDepth += 1;
  stage.classList.add("is-dragover");
  if (uiState === "idle") coreTitle.textContent = "Release it.";
});

stage.addEventListener("dragover", (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = uiState === "working" ? "none" : "copy";
  }
});

stage.addEventListener("dragleave", (event) => {
  if (!isFileDrag(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) clearDragHighlight();
});

stage.addEventListener("drop", (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  clearDragHighlight();

  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  if (uiState === "working") {
    showToast("The chamber is still working. Give it a moment.");
    return;
  }
  void handleFile(file);
});

window.addEventListener("dragover", (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
});

window.addEventListener("drop", (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  clearDragHighlight();
});

window.addEventListener("dragend", clearDragHighlight);

window.addEventListener("paste", (event) => {
  if (uiState === "working") return;
  const clipboard = event.clipboardData;
  if (!clipboard) return;

  let file: File | undefined = Array.from(clipboard.files)[0];
  if (!file) {
    for (const item of Array.from(clipboard.items)) {
      if (item.kind === "file") {
        file = item.getAsFile() ?? undefined;
        if (file) break;
      }
    }
  }
  if (!file) return;

  event.preventDefault();
  void handleFile(file);
});

let stageInView = true;
const stageObserver = new IntersectionObserver(
  (entries) => {
    const entry = entries[0];
    if (!entry) return;
    stageInView = entry.isIntersecting;
    chamber.setActive(stageInView && !document.hidden);
  },
  { threshold: 0.05 },
);
stageObserver.observe(stage);

function syncChamberVisibility(): void {
  chamber.setActive(stageInView && !document.hidden);
}
document.addEventListener("visibilitychange", syncChamberVisibility);
syncChamberVisibility();

reducedQuery.addEventListener("change", (event) => {
  reducedMotion = event.matches;
  chamber.setReduced(reducedMotion);
});
