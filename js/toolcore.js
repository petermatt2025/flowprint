// Low-level helpers shared by built-in tools and connections.
export const RESULT_LIMIT = 8000;
export const toolName = s => String(s || "tool").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64) || "tool";
export const clip = s => (s.length > RESULT_LIMIT ? `${s.slice(0, RESULT_LIMIT)}\n…(truncated)` : s);

export async function fetchT(url, opts = {}, signal, timeout = 30000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  signal?.addEventListener("abort", () => ctl.abort(), { once: true });
  try { return await fetch(url, { ...opts, signal: ctl.signal }); }
  catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(e.name === "AbortError" ? `Timed out after ${timeout / 1000}s` : `Network error: ${e.message}`);
  } finally { clearTimeout(t); }
}

export function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,noscript,svg,iframe").forEach(n => n.remove());
  return (doc.body?.innerText || doc.body?.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}
