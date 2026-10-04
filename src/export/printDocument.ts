import hljs from "highlight.js/lib/common";
import hljsCss from "highlight.js/styles/github.css?raw";
import katex from "katex";
import katexCss from "katex/dist/katex.min.css?raw";
import { Marked } from "marked";

export type PaperSize = "A4" | "Letter" | "A5";

export type ExportImage = {
  id: string;
  mime: string;
  dataBase64: string;
};

const papers: Record<PaperSize, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  Letter: { width: 215.9, height: 279.4 },
  A5: { width: 148, height: 210 },
};

const sideMargin = 16;
const headerHeight = 12;
const footerHeight = 12;

const fontLoaders = import.meta.glob("../../node_modules/katex/dist/fonts/*.woff2", {
  query: "?url",
  import: "default",
});

const marked = new Marked();
marked.use({
  gfm: true,
  renderer: {
    code({ text, lang }) {
      const language = lang?.split(/\s+/)[0] ?? "";
      const highlighted =
        language && hljs.getLanguage(language)
          ? hljs.highlight(text, { language }).value
          : escapeHtml(text);
      const className = language ? `hljs language-${language}` : "hljs";
      return `<pre class="code"><code class="${className}">${highlighted}</code></pre>\n`;
    },
  },
});

let printCss: Promise<string> | null = null;

export async function buildPdfHtml(
  title: string,
  body: string,
  images: ExportImage[],
  paper: PaperSize,
): Promise<string> {
  const source = embedImages(body, images);
  const fragment = renderBody(source);
  const css = await loadPrintCss();
  const blocks = await measureBlocks(fragment, css, paper);
  return documentHtml(displayTitle(title), blocks, css, paper);
}

function displayTitle(title: string) {
  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed : "Untitled";
}

function embedImages(body: string, images: ExportImage[]) {
  let next = body;
  for (const image of images) {
    const url = `data:${image.mime};base64,${image.dataBase64}`;
    next = next.split(`](asset:${image.id})`).join(`](${url})`);
  }
  return next;
}

function renderBody(source: string) {
  const fenced = shield(source, (text) => fenceSlots(text));
  const inlined = shield(fenced.text, (text) => inlineSlots(text));
  const maths = replaceMath(inlined.text);
  const markdown = restore(
    restore(maths.text, "EYJASLOT", inlined.slots),
    "EYJAFENCE",
    fenced.slots,
  );
  const html = marked.parse(markdown, { async: false });
  return restoreMath(String(html), maths.display, maths.inline);
}

function restoreMath(html: string, display: string[], inline: string[]) {
  let next = html;
  display.forEach((math, index) => {
    const token = `EYJAMATHD${index}END`;
    next = next.replace(`<p>${token}</p>`, `<div class="math-display">${math}</div>`);
    next = next.replace(token, `<div class="math-display">${math}</div>`);
  });
  inline.forEach((math, index) => {
    next = next.split(`EYJAMATHI${index}END`).join(math);
  });
  return next;
}

function replaceMath(text: string) {
  const display: string[] = [];
  const inline: string[] = [];
  const withoutDisplay = text.replace(/\$\$([\s\S]+?)\$\$/g, (_match, tex: string) => {
    const html = katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false });
    const token = `EYJAMATHD${display.length}END`;
    display.push(html);
    return `\n\n${token}\n\n`;
  });
  const withInline = withoutDisplay.replace(/\$([^\n$]+?)\$/g, (_match, tex: string) => {
    const html = katex.renderToString(tex.trim(), { displayMode: false, throwOnError: false });
    const token = `EYJAMATHI${inline.length}END`;
    inline.push(html);
    return token;
  });
  return { text: withInline, display, inline };
}

function shield(text: string, split: (text: string) => { text: string; slots: string[] }) {
  return split(text);
}

function fenceSlots(text: string) {
  const lines = splitKeep(text);
  let prose = "";
  let out = "";
  const slots: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const width = openingFence(lines[index] ?? "");
    if (width) {
      out += prose;
      prose = "";
      let block = lines[index] ?? "";
      index += 1;
      while (index < lines.length) {
        block += lines[index] ?? "";
        const closed = closingFence(lines[index] ?? "", width);
        index += 1;
        if (closed) break;
      }
      out += `EYJAFENCE${slots.length}END\n`;
      slots.push(block.endsWith("\n") ? block.slice(0, -1) : block);
      continue;
    }
    prose += lines[index] ?? "";
    index += 1;
  }
  return { text: out + prose, slots };
}

function inlineSlots(text: string) {
  const chars = [...text];
  let index = 0;
  let out = "";
  const slots: string[] = [];
  while (index < chars.length) {
    if (chars[index] === "`") {
      let width = 0;
      while (chars[index + width] === "`") width += 1;
      const end = findClosing(chars, index + width, width);
      if (end !== null) {
        out += `EYJASLOT${slots.length}END`;
        slots.push(chars.slice(index, end).join(""));
        index = end;
        continue;
      }
    }
    out += chars[index];
    index += 1;
  }
  return { text: out, slots };
}

function restore(text: string, prefix: string, slots: string[]) {
  let next = text;
  slots.forEach((slot, index) => {
    next = next.split(`${prefix}${index}END`).join(slot);
  });
  return next;
}

function findClosing(chars: string[], from: number, width: number) {
  let index = from;
  while (index < chars.length) {
    if (chars[index] === "`") {
      let run = 0;
      while (chars[index + run] === "`") run += 1;
      if (run === width) return index + run;
      index += run;
      continue;
    }
    index += 1;
  }
  return null;
}

function splitKeep(input: string) {
  const lines: string[] = [];
  let start = 0;
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] === "\n") {
      lines.push(input.slice(start, index + 1));
      start = index + 1;
    }
  }
  if (start < input.length) lines.push(input.slice(start));
  return lines;
}

function openingFence(line: string) {
  const trimmedNl = line.replace(/[\n\r]+$/, "");
  const trimmed = trimmedNl.trimStart();
  const indent = trimmedNl.length - trimmed.length;
  if (indent > 3 || !trimmed.startsWith("```")) return 0;
  let width = 0;
  while (trimmed[width] === "`") width += 1;
  if (width < 3 || trimmed.slice(width).includes("`")) return 0;
  return width;
}

function closingFence(line: string, width: number) {
  const trimmed = line.replace(/[\n\r]+$/, "").trim();
  let ticks = 0;
  while (trimmed[ticks] === "`") ticks += 1;
  return ticks >= width && ticks === trimmed.length;
}

async function loadPrintCss() {
  if (!printCss) {
    printCss = embedFonts(katexCss).then((mathCss) => `${mathCss}\n${hljsCss}\n${pageCss()}`);
  }
  return printCss;
}

async function embedFonts(css: string) {
  let next = css;
  await Promise.all(
    Object.entries(fontLoaders).map(async ([path, load]) => {
      const name = path.split("/").pop();
      if (!name) return;
      const url = await load();
      if (typeof url !== "string") return;
      const response = await fetch(url);
      const base64 = bufferToBase64(await response.arrayBuffer());
      next = next.split(`url(fonts/${name})`).join(`url(data:font/woff2;base64,${base64})`);
    }),
  );
  return next;
}

function bufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const size = 0x8000;
  for (let index = 0; index < bytes.length; index += size) {
    binary += String.fromCharCode(...bytes.subarray(index, index + size));
  }
  return btoa(binary);
}

function pageCss() {
  return `
    html, body { margin: 0; padding: 0; color: #1c1c1c; background: white; }
    .page {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      break-after: page;
      page-break-after: always;
      overflow: hidden;
    }
    header {
      height: ${headerHeight}mm;
      box-sizing: border-box;
      display: flex;
      align-items: flex-end;
      padding-bottom: 2mm;
      border-bottom: 0.2mm solid #d4d4d8;
      font: 10pt "Segoe UI", sans-serif;
      white-space: nowrap;
      overflow: hidden;
    }
    footer {
      height: ${footerHeight}mm;
      display: flex;
      align-items: center;
      justify-content: center;
      font: 10pt "Segoe UI", sans-serif;
    }
    .body { font: 11pt "Segoe UI", sans-serif; line-height: 1.5; }
    .body > * { margin: 0 0 3mm; }
    .body h1 { font-size: 18pt; }
    .body h2 { font-size: 15pt; }
    .body h3 { font-size: 13pt; }
    .body pre, .body code { font-family: Consolas, monospace; font-size: 9.5pt; }
    .body pre { padding: 3mm; background: #f4f4f5; white-space: pre-wrap; }
    .body table { border-collapse: collapse; width: 100%; }
    .body th, .body td { border: 0.2mm solid #d4d4d8; padding: 1mm 2mm; }
    .body img { max-width: 100%; }
    .math-display { margin: 3mm 0; overflow: auto; }
  `;
}

async function measureBlocks(fragment: string, css: string, paper: PaperSize) {
  const size = papers[paper];
  const contentWidth = size.width - sideMargin * 2;
  const contentHeight = size.height - headerHeight - footerHeight;
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "Export measure");
  iframe.style.cssText = "position:fixed;left:-10000px;top:0;width:0;height:0;border:0;";
  const probeHtml = `<!DOCTYPE html><html><head><style>${css}</style></head><body><div class="body" id="measure" style="width:${contentWidth}mm">${fragment}</div><div id="limit" style="height:${contentHeight}mm"></div></body></html>`;
  document.body.appendChild(iframe);
  try {
    await new Promise<void>((resolve) => {
      iframe.onload = () => resolve();
      iframe.srcdoc = probeHtml;
    });
    const probe = iframe.contentDocument;
    if (!probe) return [fragment];
    await probe.fonts.ready;
    const measure = probe.getElementById("measure");
    const limit = probe.getElementById("limit");
    if (!measure || !limit) return [fragment];
    const maxHeight = limit.getBoundingClientRect().height;
    const pages: string[][] = [];
    let page: string[] = [];
    let used = 0;
    for (const child of measure.children) {
      const style = probe.defaultView?.getComputedStyle(child);
      const height =
        child.getBoundingClientRect().height +
        parseFloat(style?.marginTop || "0") +
        parseFloat(style?.marginBottom || "0");
      if (page.length > 0 && used + height > maxHeight) {
        pages.push(page);
        page = [];
        used = 0;
      }
      page.push(child.outerHTML);
      used += height;
    }
    if (page.length > 0) pages.push(page);
    if (pages.length === 0) pages.push([]);
    return pages.map((blocks) => blocks.join(""));
  } finally {
    iframe.remove();
  }
}

function documentHtml(title: string, pages: string[], css: string, paper: PaperSize) {
  const size = papers[paper];
  const pageCssSize = `
    @page { size: ${paper === "Letter" ? "letter" : paper}; margin: 0; }
    .page { width: ${size.width}mm; height: ${size.height}mm; padding: 0 ${sideMargin}mm; }
  `;
  const sections = pages
    .map(
      (body, index) =>
        `<section class="page"><header>${escapeHtml(title)}</header><div class="body">${body}</div><footer>${index + 1}</footer></section>`,
    )
    .join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${css}\n${pageCssSize}</style></head><body>${sections}</body></html>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
