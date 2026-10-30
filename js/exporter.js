import { buildExportText, buildPublishingSteps, formCopyText } from "./engine.js";

const slug = s => (s || "blueprint").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

export function downloadBlob(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const exportTxt = bp => downloadBlob(buildExportText(bp), `${slug(bp.workflowTitle)}.txt`, "text/plain");
export const exportJson = bp => downloadBlob(JSON.stringify(bp, null, 2), `${slug(bp.workflowTitle)}.json`, "application/json");

function hexToRgb(hex) {
  const h = hex.replace("#", "").trim();
  const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// jsPDF's built-in fonts only cover Latin-1, so map common typographic characters.
const pdfSafe = s => String(s ?? "")
  .replace(/→/g, "->").replace(/[—–]/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
  .replace(/…/g, "...").replace(/•/g, "-").replace(/[^\x00-\xFF]/g, "");

export function exportPdf(bp) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const css = getComputedStyle(document.documentElement);
  const brand = hexToRgb(css.getPropertyValue("--brand-primary") || "#6C3BFF");
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  let y = M;

  const ensure = h => { if (y + h > H - M) { doc.addPage(); y = M; } };
  const text = (str, { size = 10, bold = false, color = [30, 30, 40], indent = 0, font = "helvetica", gap = 4 } = {}) => {
    doc.setFont(font, bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(pdfSafe(str), W - M * 2 - indent);
    const lh = size * 1.35;
    lines.forEach(l => { ensure(lh); doc.text(l, M + indent, y); y += lh; });
    y += gap;
  };
  const heading = str => {
    ensure(40); y += 10;
    doc.setFillColor(...brand); doc.rect(M, y - 12, 4, 16, "F");
    text(str, { size: 14, bold: true, indent: 10, gap: 8 });
  };

  doc.setFillColor(...brand); doc.rect(0, 0, W, 6, "F");
  text("FlowPrint · MindPal workflow blueprint", { size: 9, color: brand, bold: true });
  text(bp.workflowTitle, { size: 20, bold: true, gap: 6 });
  text(bp.workflowDescription, { size: 11, color: [70, 70, 90], gap: 10 });

  heading("Agent chain");
  bp.agents.forEach(a => {
    text(`Agent ${a.agentNumber}: ${a.agentName}`, { size: 12, bold: true, color: brand, gap: 2 });
    text(`Role: ${a.role}`, { gap: 1 });
    text(`Input: ${a.inputSource}`, { gap: 1 });
    text(`Output: ${a.outputDescription}`, { gap: 4 });
    text("System prompt", { size: 9, bold: true, color: [110, 110, 130], gap: 2 });
    text(a.systemPrompt, { size: 9, font: "courier", indent: 8, gap: 12 });
  });

  heading("Input form fields");
  bp.formFields.forEach(f => {
    text(`${f.fieldName}  (${f.fieldType})`, { bold: true, gap: 1 });
    text(`${f.description} — e.g. "${f.exampleValue}"`, { indent: 8, color: [70, 70, 90], gap: 6 });
  });

  heading("Knowledge sources");
  bp.knowledgeSources.forEach(k => {
    text(`[ ] ${k.documentType}`, { bold: true, gap: 1 });
    text(`Contains: ${k.whatItShouldContain}`, { indent: 14, gap: 1 });
    text(`Why: ${k.whyItMatters}`, { indent: 14, color: [70, 70, 90], gap: 6 });
  });

  heading("Publishing checklist");
  buildPublishingSteps(bp).forEach((s, i) => {
    text(`${i + 1}. ${s.text}`, { bold: true, gap: 1 });
    if (s.sub) text(s.sub, { indent: 14, color: [70, 70, 90], gap: 5 });
  });

  heading("Form copy");
  text(formCopyText(bp), { size: 10, gap: 6 });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(150);
    doc.text(`${i} / ${pages}`, W - M, H - 20, { align: "right" });
  }
  doc.save(`${slug(bp.workflowTitle)}.pdf`);
}
