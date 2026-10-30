// Things agents make: documents, HTML pages, apps, carousels and slide decks.
import { local } from "./storage.js";
import { uid, esc, md, downloadFile, slug } from "./ui.js";

const KEY = "artifacts";
const LIMIT = 200;
export const KIND_META = {
  document: { icon: "📄", label: "Document" },
  page: { icon: "🧾", label: "HTML page" },
  app: { icon: "🧱", label: "Web app" },
  carousel: { icon: "🖼", label: "Carousel" },
  slides: { icon: "📽", label: "Slide deck" }
};

export const allArtifacts = async () => (await local.get(KEY)) || [];
export const getArtifact = async id => (await allArtifacts()).find(a => a.id === id) || null;
export async function saveArtifact(a) {
  a.updatedAt = Date.now();
  const list = await allArtifacts();
  const i = list.findIndex(x => x.id === a.id);
  if (i >= 0) list[i] = a; else list.unshift(a);
  await local.set(KEY, list.slice(0, LIMIT));
  return a;
}

export async function createArtifact(kind, args, agent) {
  const a = { id: uid(), kind, title: (args.title || KIND_META[kind].label).slice(0, 120), createdAt: Date.now(), agentId: agent?.id, agentName: agent?.name };
  if (kind === "document") a.markdown = args.content || "";
  if (kind === "page" || kind === "app") { a.html = args.html || ""; a.subkind = args.kind || kind; }
  if (kind === "carousel") Object.assign(a, { slides: args.slides || [], handle: args.handle || "", accent: args.accent || "" });
  if (kind === "slides") Object.assign(a, { subtitle: args.subtitle || "", slides: args.slides || [] });
  return saveArtifact(a);
}

export const artifactUrl = id => (typeof chrome !== "undefined" && chrome.runtime?.getURL ? chrome.runtime.getURL(`artifact.html?id=${id}`) : `artifact.html?id=${id}`);
export function openArtifact(id) {
  if (typeof chrome !== "undefined" && chrome.tabs?.create) chrome.tabs.create({ url: artifactUrl(id) });
  else window.open(artifactUrl(id), "_blank");
}

// ---------- Rendering helpers ----------
const theme = () => {
  const css = getComputedStyle(document.documentElement);
  const v = n => css.getPropertyValue(n).trim();
  return { primary: v("--brand-primary") || "#F97316", bg: "#0B1A33", text: "#F5F7FB", muted: "#9FB0CC" };
};

function wrap(ctx, text, maxW) {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let line = "";
  words.forEach(w => {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  });
  if (line) lines.push(line);
  return lines;
}

// Draw one 1080×1350 carousel slide.
export function drawCarouselSlide(canvas, art, i) {
  const W = 1080, H = 1350, th = theme();
  const accent = /^#[0-9a-f]{3,8}$/i.test(art.accent) ? art.accent : th.primary;
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext("2d");
  const s = art.slides[i] || {};
  const first = i === 0, last = i === art.slides.length - 1;
  c.fillStyle = first ? accent : th.bg; c.fillRect(0, 0, W, H);
  c.fillStyle = first ? th.bg : accent; c.fillRect(0, 0, W, 14);
  const font = "Inter, system-ui, -apple-system, Segoe UI, sans-serif";
  c.textBaseline = "top";
  c.font = `800 ${first ? 96 : 76}px ${font}`;
  c.fillStyle = first ? "#0A0A0A" : th.text;
  const hl = wrap(c, s.heading, W - 160);
  let y = first ? 380 : 200;
  hl.forEach(l => { c.fillText(l, 80, y); y += first ? 110 : 90; });
  if (s.body) {
    y += 40;
    c.font = `500 44px ${font}`;
    c.fillStyle = first ? "#1a1a1a" : th.muted;
    wrap(c, s.body, W - 160).forEach(l => { c.fillText(l, 80, y); y += 62; });
  }
  c.font = `600 34px ${font}`;
  c.fillStyle = first ? "#0A0A0A" : th.muted;
  if (art.handle) c.fillText(art.handle, 80, H - 110);
  c.textAlign = "right";
  c.fillText(last ? "" : `${i + 1}/${art.slides.length}  →`, W - 80, H - 110);
  c.textAlign = "left";
}

export async function downloadCarousel(art) {
  for (let i = 0; i < art.slides.length; i++) {
    const cv = document.createElement("canvas");
    drawCarouselSlide(cv, art, i);
    const a = Object.assign(document.createElement("a"), { href: cv.toDataURL("image/png"), download: `${slug(art.title)}-${i + 1}.png` });
    document.body.appendChild(a); a.click(); a.remove();
    await new Promise(r => setTimeout(r, 250));
  }
}

export function downloadPptx(art) {
  const P = window.PptxGenJS;
  if (!P) throw new Error("Slide library not loaded");
  const th = theme();
  const hex = h => h.replace("#", "").slice(0, 6).toUpperCase();
  const pptx = new P();
  pptx.layout = "LAYOUT_WIDE";
  const cover = pptx.addSlide();
  cover.background = { color: hex(th.bg) };
  cover.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.15, fill: { color: hex(th.primary) } });
  cover.addText(art.title, { x: 0.8, y: 2.4, w: 11.7, h: 1.4, fontSize: 44, bold: true, color: "FFFFFF", fontFace: "Arial" });
  if (art.subtitle) cover.addText(art.subtitle, { x: 0.8, y: 3.9, w: 11.7, h: 0.8, fontSize: 22, color: hex(th.primary), fontFace: "Arial" });
  art.slides.forEach(s => {
    const sl = pptx.addSlide();
    sl.background = { color: "FFFFFF" };
    sl.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: hex(th.primary) } });
    sl.addText(s.title || "", { x: 0.7, y: 0.4, w: 12, h: 1, fontSize: 32, bold: true, color: hex(th.bg), fontFace: "Arial" });
    if (s.bullets?.length) sl.addText(s.bullets.map(b => ({ text: b, options: { bullet: true, breakLine: true } })), { x: 0.9, y: 1.6, w: 11.6, h: 5.2, fontSize: 22, color: "333333", fontFace: "Arial", valign: "top", paraSpaceAfter: 10 });
    if (s.notes) sl.addNotes(s.notes);
  });
  return pptx.writeFile({ fileName: `${slug(art.title)}.pptx` });
}

export function docToHtml(art) { return art.html || md(art.markdown || "").replace(/\n/g, "<br>"); }
export function downloadDoc(art, fmt) {
  if (fmt === "md") return downloadFile(art.markdown || "", `${slug(art.title)}.md`, "text/markdown");
  const html = `<html><head><meta charset="utf-8"><title>${esc(art.title)}</title></head><body style="font-family:Calibri,Arial,sans-serif;line-height:1.5"><h1>${esc(art.title)}</h1>${docToHtml(art)}</body></html>`;
  downloadFile(html, `${slug(art.title)}.doc`, "application/msword");
}
export const downloadHtml = art => downloadFile(art.html || "", `${slug(art.title)}.html`, "text/html");

export function slideHtml(s, idx) {
  return `<div class="mini-slide"><div class="ms-n">${idx}</div><b>${esc(s.title || "")}</b><ul>${(s.bullets || []).slice(0, 6).map(b => `<li>${esc(b)}</li>`).join("")}</ul></div>`;
}

// Card shown inside a chat message.
export function artifactCardHtml(att) {
  const m = KIND_META[att.kind] || { icon: "📎", label: "File" };
  const actions = {
    document: `<button data-art-act="doc" data-id="${att.id}">⬇ Word</button><button data-art-act="md" data-id="${att.id}">⬇ .md</button>`,
    page: `<button data-art-act="html" data-id="${att.id}">⬇ .html</button>`,
    app: `<button data-art-act="html" data-id="${att.id}">⬇ .html</button>`,
    carousel: `<button data-art-act="png" data-id="${att.id}">⬇ PNGs</button>`,
    slides: `<button data-art-act="pptx" data-id="${att.id}">⬇ .pptx</button>`
  }[att.kind] || "";
  return `<div class="art-card" data-art-card="${att.id}" data-kind="${att.kind}">
    <div class="art-head"><span class="art-ico">${m.icon}</span><span class="grow"><b>${esc(att.title)}</b><span class="sub">${m.label}</span></span></div>
    <div class="art-body" data-art-body="${att.id}"></div>
    <div class="art-actions"><button data-art-act="open" data-id="${att.id}">${att.kind === "document" ? "✎ Open & edit" : "⤢ Open"}</button>${actions}</div></div>`;
}

const sandboxUrl = () => (typeof chrome !== "undefined" && chrome.runtime?.getURL ? chrome.runtime.getURL("sandbox.html") : "sandbox.html");

// Load an HTML string into a sandboxed iframe (scripts allowed, isolated from the extension).
export function loadSandbox(iframe, html) {
  const send = () => iframe.contentWindow?.postMessage({ html }, "*");
  const onMsg = e => { if (e.source === iframe.contentWindow && e.data?.sandboxReady) { window.removeEventListener("message", onMsg); send(); } };
  window.addEventListener("message", onMsg);
  iframe.src = sandboxUrl();
}

// Fill previews inside a container (after chat render).
export async function hydrateArtifacts(root) {
  const bodies = [...root.querySelectorAll("[data-art-body]:not([data-hydrated])")];
  for (const el of bodies) {
    el.dataset.hydrated = "1";
    const art = await getArtifact(el.dataset.artBody);
    if (!art) { el.innerHTML = `<span class="muted small">This item is no longer stored.</span>`; continue; }
    if (art.kind === "document") el.innerHTML = `<div class="art-doc">${md((art.markdown || "").slice(0, 600))}${(art.markdown || "").length > 600 ? "…" : ""}</div>`;
    if (art.kind === "page" || art.kind === "app") {
      el.innerHTML = `<iframe class="art-frame" sandbox="allow-scripts allow-forms allow-popups allow-modals" title="${esc(art.title)}"></iframe>`;
      loadSandbox(el.querySelector("iframe"), art.html);
    }
    if (art.kind === "carousel") {
      el.innerHTML = `<div class="car-strip">${art.slides.map(() => "<canvas></canvas>").join("")}</div>`;
      el.querySelectorAll("canvas").forEach((cv, i) => drawCarouselSlide(cv, art, i));
    }
    if (art.kind === "slides") el.innerHTML = `<div class="car-strip">${[{ title: art.title, bullets: art.subtitle ? [art.subtitle] : [] }, ...art.slides].map((s, i) => slideHtml(s, i + 1)).join("")}</div>`;
  }
}

export async function artifactAction(btn) {
  const art = await getArtifact(btn.dataset.id);
  if (!art) throw new Error("Item not found");
  const act = btn.dataset.artAct;
  if (act === "open") return openArtifact(art.id);
  if (act === "doc") return downloadDoc(art, "doc");
  if (act === "md") return downloadDoc(art, "md");
  if (act === "html") return downloadHtml(art);
  if (act === "png") return downloadCarousel(art);
  if (act === "pptx") return downloadPptx(art);
}
