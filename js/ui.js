// Small shared helpers for the Agents and Chatbots builders.
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function debounce(fn, ms = 400) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// Light Markdown: code blocks, headings, bold, italics, bullet lists, links. Input is escaped first.
export function md(src) {
  const blocks = [];
  let s = esc(src).replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, code) => { blocks.push(code); return `\u0000${blocks.length - 1}\u0000`; });
  s = s
    .replace(/^#{1,6}\s+(.*)$/gm, '<span class="h">$1</span>')
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*])\*(?!\s)([^*\n]+?)\*/g, "$1<i>$2</i>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/^\s*[-*•]\s+(.*)$/gm, "• $1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<pre class="code">${blocks[i]}</pre>`);
}

// Read/write nested properties: get(obj, "output.format")
export const getPath = (o, p) => p.split(".").reduce((a, k) => a?.[k], o);
export function setPath(o, p, v) {
  const ks = p.split(".");
  let a = o;
  ks.slice(0, -1).forEach(k => { a = a[k] ??= {}; });
  a[ks[ks.length - 1]] = v;
}

// Value of a [data-bind] control, honouring data-kind (csv | lines | number).
export function readBound(el) {
  const kind = el.dataset.kind;
  if (el.type === "checkbox") return el.checked;
  if (kind === "number" || el.type === "number" || el.type === "range") return el.value === "" ? null : Number(el.value);
  if (kind === "csv") return el.value.split(",").map(x => x.trim()).filter(Boolean);
  if (kind === "lines") return el.value.split("\n").map(x => x.trim()).filter(Boolean);
  return el.value;
}

const tipIcon = tip => (tip ? ` <i class="tip" data-tip="${esc(tip)}">?</i>` : "");

// Form control bound to obj[path]. opts: { type, tip, placeholder, rows, options, kind, help, min, max, step }
export function field(obj, label, path, opts = {}) {
  const { type = "text", tip, placeholder = "", rows = 4, options, kind, help, min, max, step } = opts;
  let v = getPath(obj, path);
  const id = `f-${path.replace(/\W/g, "-")}`;
  const k = kind ? ` data-kind="${kind}"` : "";
  if (kind === "csv" && Array.isArray(v)) v = v.join(", ");
  if (kind === "lines" && Array.isArray(v)) v = v.join("\n");
  let control;
  if (type === "checkbox") {
    return `<label class="check"><input type="checkbox" id="${id}" data-bind="${path}" ${v ? "checked" : ""}/> ${esc(label)}${tipIcon(tip)}</label>${help ? `<div class="field-help">${esc(help)}</div>` : ""}`;
  } else if (type === "textarea") {
    control = `<textarea id="${id}" data-bind="${path}"${k} rows="${rows}" placeholder="${esc(placeholder)}">${esc(v ?? "")}</textarea>`;
  } else if (type === "select") {
    control = `<select id="${id}" data-bind="${path}"${k}>${options.map(o => {
      const [val, lab] = Array.isArray(o) ? o : [o, o];
      return `<option value="${esc(val)}" ${String(val) === String(v ?? "") ? "selected" : ""}>${esc(lab)}</option>`;
    }).join("")}</select>`;
  } else {
    const extra = [min != null && `min="${min}"`, max != null && `max="${max}"`, step != null && `step="${step}"`].filter(Boolean).join(" ");
    control = `<input id="${id}" type="${type}" data-bind="${path}"${k} value="${esc(v ?? "")}" placeholder="${esc(placeholder)}" ${extra}/>`;
  }
  return `<label for="${id}">${esc(label)}${tipIcon(tip)}</label>${control}${help ? `<div class="field-help">${esc(help)}</div>` : ""}`;
}

// Horizontal tab bar (wizard style), reusing the main step-tab look.
export function tabBar(tabs, active, action = "") {
  return `<nav class="steps sub">${tabs.map(([key, label, tip]) =>
    `<button ${action} data-tab="${key}" class="${key === active ? "active" : ""}" ${tip ? `data-tip="${esc(tip)}"` : ""}>${label}</button>`).join("")}</nav>`;
}

export function downloadFile(content, filename, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const slug = s => (s || "item").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

export function pickFiles(accept, multiple = true) {
  return new Promise(resolve => {
    const inp = Object.assign(document.createElement("input"), { type: "file", accept, multiple });
    inp.onchange = () => resolve([...inp.files]);
    inp.click();
  });
}
