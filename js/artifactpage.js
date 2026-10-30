// Full-screen viewer/editor for agent-made documents, pages, apps, carousels and slide decks.
import { $, esc, md } from "./ui.js";
import { loadSettings } from "./storage.js";
import { getArtifact, saveArtifact, KIND_META, loadSandbox, drawCarouselSlide, downloadCarousel, downloadPptx, downloadDoc, downloadHtml, slideHtml } from "./artifacts.js";

function toast(msg, isErr = false) {
  const t = $("#toast");
  t.textContent = msg; t.classList.toggle("err", isErr); t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2000);
}
const btn = (id, label) => `<button id="${id}" class="btn ghost small">${label}</button>`;

async function main() {
  const settings = await loadSettings();
  document.documentElement.dataset.theme = settings.theme;
  const art = await getArtifact(new URLSearchParams(location.search).get("id"));
  if (!art) { $("#artRoot").innerHTML = `<div class="empty">Not found – it may have been deleted.</div>`; return; }
  const meta = KIND_META[art.kind];
  document.title = art.title;
  $("#artIcon").textContent = meta.icon;
  $("#artTitle").value = art.title;
  $("#artMeta").textContent = `${meta.label}${art.agentName ? ` · made by ${art.agentName}` : ""} · ${new Date(art.createdAt).toLocaleString()}`;
  $("#artTitle").onchange = async () => { art.title = $("#artTitle").value.trim() || art.title; await saveArtifact(art); toast("Saved"); };
  const root = $("#artRoot"), tools = $("#artTools");

  if (art.kind === "document") {
    tools.innerHTML = btn("save", "Save") + btn("dl", "⬇ Word") + btn("dlmd", "⬇ .md") + btn("cp", "Copy");
    root.innerHTML = `<article class="doc-editor" contenteditable="true">${art.html || md(art.markdown || "")}</article>`;
    const ed = root.querySelector(".doc-editor");
    const save = async () => { art.html = ed.innerHTML; art.markdown = ed.innerText; await saveArtifact(art); };
    let t; ed.addEventListener("input", () => { clearTimeout(t); t = setTimeout(save, 600); });
    $("#save").onclick = async () => { await save(); toast("Saved"); };
    $("#dl").onclick = async () => { await save(); downloadDoc(art, "doc"); };
    $("#dlmd").onclick = async () => { await save(); downloadDoc(art, "md"); };
    $("#cp").onclick = async () => { await navigator.clipboard.writeText(ed.innerText); toast("Copied"); };
  }

  if (art.kind === "page" || art.kind === "app") {
    tools.innerHTML = btn("code", "‹/› Code") + btn("dl", "⬇ .html");
    root.innerHTML = `<div class="code-pane hidden"><textarea id="src" class="code">${esc(art.html)}</textarea>
      <div class="row"><button id="run" class="btn primary small">▶ Run</button><button id="savecode" class="btn ghost small">Save</button></div></div>
      <iframe class="art-full" sandbox="allow-scripts allow-forms allow-popups allow-modals" title="${esc(art.title)}"></iframe>`;
    let cur = root.querySelector("iframe");
    loadSandbox(cur, art.html);
    $("#code").onclick = () => root.querySelector(".code-pane").classList.toggle("hidden");
    $("#run").onclick = () => { const f = cur.cloneNode(); cur.replaceWith(f); cur = f; loadSandbox(cur, $("#src").value); };
    $("#savecode").onclick = async () => { art.html = $("#src").value; await saveArtifact(art); toast("Saved"); };
    $("#dl").onclick = () => downloadHtml(art);
  }

  if (art.kind === "carousel") {
    tools.innerHTML = btn("dl", "⬇ All PNGs");
    root.innerHTML = `<p class="muted small">Click a slide to download it.</p><div class="car-grid">${art.slides.map((_, i) => `<canvas data-i="${i}"></canvas>`).join("")}</div>`;
    root.querySelectorAll("canvas").forEach((cv, i) => drawCarouselSlide(cv, art, i));
    root.addEventListener("click", e => {
      const cv = e.target.closest("canvas");
      if (!cv) return;
      const a = Object.assign(document.createElement("a"), { href: cv.toDataURL("image/png"), download: `${art.title}-${+cv.dataset.i + 1}.png` });
      a.click();
    });
    $("#dl").onclick = () => downloadCarousel(art);
  }

  if (art.kind === "slides") {
    tools.innerHTML = btn("dl", "⬇ PowerPoint");
    root.innerHTML = `<div class="deck">${[{ title: art.title, bullets: art.subtitle ? [art.subtitle] : [] }, ...art.slides].map((s, i) => `${slideHtml(s, i + 1)}${s.notes ? `<p class="muted small notes">🗒 ${esc(s.notes)}</p>` : ""}`).join("")}</div>`;
    $("#dl").onclick = () => downloadPptx(art).catch(e => toast(e.message, true));
  }
}
main();
