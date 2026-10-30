// Pure functions: input in, value out. No DOM, no network.
import { PRESETS } from "./presets.js";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompts.js";

const NICHE_KEYWORDS = {
  "pet training": ["pet", "dog", "puppy", "cat"],
  finance: ["finance", "money", "invest", "budget", "crypto"],
  fitness: ["fitness", "workout", "exercise", "gym", "weight loss"],
  health: ["health", "wellness", "nutrition", "diet"],
  "social media": ["instagram", "tiktok", "reel", "facebook", "linkedin", "threads", "social media"],
  "ebook publishing": ["ebook", "kdp", "amazon", "plr"],
  "email marketing": ["email", "newsletter", "sequence"],
  coaching: ["coach", "coaching", "client", "mentorship"],
  "food & recipes": ["recipe", "food", "dessert", "cooking"],
  "make money online": ["affiliate", "make money", "commission", "bonus"]
};

const OUTPUT_KEYWORDS = {
  ebook: ["ebook", "chapter", "book", "table of contents"],
  social: ["hook", "post", "reel", "caption", "social", "thread", "tweet"],
  email: ["email", "newsletter", "subject line"],
  sales: ["bonus", "sales page", "landing page", "sales description"],
  course: ["course", "module", "lesson"],
  checklist: ["checklist", "lead magnet", "cheat sheet", "guide"]
};

export function parseTaskInput(rawText) {
  const text = (rawText || "").replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const firstSentence = (text.match(/^.*?[.!?](\s|$)/) || [text])[0].trim();

  let inferredNiche = "";
  let best = 0;
  for (const [niche, words] of Object.entries(NICHE_KEYWORDS)) {
    const hits = words.filter(w => lower.includes(w)).length;
    if (hits > best) { best = hits; inferredNiche = niche; }
  }
  const inferredOutputTypes = Object.entries(OUTPUT_KEYWORDS)
    .filter(([, words]) => words.some(w => lower.includes(w)))
    .map(([key]) => key);

  return { taskSummary: text, firstSentence, inferredNiche, inferredOutputTypes };
}

export function selectPreset(presetKey) {
  return PRESETS[presetKey] || null;
}

export function buildAgentChainPrompt(taskSummary, niche, outputTypes, tone, presetHint) {
  return {
    system: SYSTEM_PROMPT,
    user: buildUserPrompt({ taskSummary, niche, outputTypes, tone, presetHint })
  };
}

// Extract the first JSON object from a model reply, tolerating ``` fences or stray prose.
export function extractJson(raw) {
  const s = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try { return JSON.parse(s); } catch {}
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(s.slice(start, end + 1));
  throw new Error("No JSON object found");
}

export function parseBlueprint(rawLLMResponse) {
  try {
    const b = extractJson(rawLLMResponse);
    return {
      workflowTitle: b.workflowTitle || "Untitled workflow",
      workflowDescription: b.workflowDescription || "",
      agents: Array.isArray(b.agents) ? b.agents.map((a, i) => ({ ...a, agentNumber: i + 1 })) : [],
      formFields: Array.isArray(b.formFields) ? b.formFields : [],
      knowledgeSources: Array.isArray(b.knowledgeSources) ? b.knowledgeSources : [],
      publishingChecklist: Array.isArray(b.publishingChecklist) ? b.publishingChecklist : [],
      formCopyBlock: b.formCopyBlock || { title: b.workflowTitle || "", description: "", instructions: "" },
      error: false
    };
  } catch {
    return { error: true, raw: String(rawLLMResponse || "") };
  }
}

export function validateBlueprint(bp) {
  const warnings = [];
  const n = bp.agents?.length || 0;
  if (n < 2) warnings.push(`Only ${n} agent(s) – a MindPal workflow usually needs at least 2.`);
  if (n > 8) warnings.push(`${n} agents – consider merging some; more than 8 gets slow and costly.`);
  (bp.agents || []).forEach((a, i) => {
    ["agentName", "role", "systemPrompt"].forEach(k => {
      if (!a[k]) warnings.push(`Agent ${i + 1} is missing "${k}".`);
    });
  });
  if (!bp.formFields?.length) warnings.push("No form fields – the published form needs at least one input.");
  return { valid: warnings.length === 0, warnings };
}

// The 7 fixed publishing steps; the first four are annotated with blueprint specifics.
export function buildPublishingSteps(bp) {
  const agentNames = bp.agents.map(a => a.agentName).join(" → ");
  const fieldNames = bp.formFields.map(f => f.fieldName).join(", ");
  const docs = bp.knowledgeSources.map(k => k.documentType).join(", ");
  const steps = [
    { text: `Create the workflow in MindPal`, sub: `Workflows → New workflow → name it "${bp.workflowTitle}".` },
    { text: `Add each agent in order`, sub: agentNames },
    { text: `Paste each system prompt`, sub: `Use the Copy Prompt buttons on step 3 for: ${agentNames}.` },
    { text: `Add the knowledge sources`, sub: docs || "Upload any reference docs and attach them to the agents." },
    { text: `Set up the input form fields`, sub: fieldNames },
    { text: `Run a test with sample inputs`, sub: "Use the example values from step 4, review every agent's output, tweak prompts." },
    { text: `Publish and copy the shareable link`, sub: "Publish → Form → paste the form copy below → copy the link." }
  ];
  const extra = (bp.publishingChecklist || [])
    .filter(s => typeof s === "string" && s.trim())
    .map(s => ({ text: s, sub: "Suggested by the AI for this workflow" }));
  return steps.concat(extra);
}

export function formCopyText(bp) {
  const f = bp.formCopyBlock || {};
  return `TITLE\n${f.title || bp.workflowTitle}\n\nDESCRIPTION\n${f.description || ""}\n\nINSTRUCTIONS\n${f.instructions || ""}`;
}

export function fieldsText(bp) {
  return bp.formFields
    .map(f => `• ${f.fieldName} (${f.fieldType}) – ${f.description}  e.g. "${f.exampleValue}"`)
    .join("\n");
}

export function buildExportText(bp) {
  const line = "=".repeat(60);
  const out = [];
  out.push(line, bp.workflowTitle.toUpperCase(), line, "", bp.workflowDescription, "");
  if (bp.meta) out.push(`Niche: ${bp.meta.niche || "-"} | Outputs: ${(bp.meta.outputTypes || []).join(", ") || "-"} | Model: ${bp.meta.model || "-"}`, "");
  out.push(line, "AGENT CHAIN", line);
  bp.agents.forEach(a => {
    out.push("", `AGENT ${a.agentNumber}: ${a.agentName}`, `Role: ${a.role}`, `Input: ${a.inputSource}`, `Output: ${a.outputDescription}`, "", "System prompt:", a.systemPrompt, "-".repeat(40));
  });
  out.push("", line, "INPUT FORM FIELDS", line, fieldsText(bp));
  out.push("", line, "KNOWLEDGE SOURCES", line);
  bp.knowledgeSources.forEach(k => out.push(`[ ] ${k.documentType}`, `    Contains: ${k.whatItShouldContain}`, `    Why: ${k.whyItMatters}`));
  out.push("", line, "PUBLISHING CHECKLIST", line);
  buildPublishingSteps(bp).forEach((s, i) => out.push(`${i + 1}. ${s.text}${s.sub ? ` — ${s.sub}` : ""}`));
  out.push("", line, "FORM COPY", line, formCopyText(bp), "");
  return out.join("\n");
}

// ---------- Running a workflow locally ----------
const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Replace {{Field Name}} with the user's value (case/spacing-insensitive). Unknown placeholders are left as-is.
export function fillTemplate(text, values) {
  const map = Object.fromEntries(Object.entries(values || {}).map(([k, v]) => [norm(k), v]));
  return String(text || "").replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, name) => {
    const v = map[norm(name)];
    return v !== undefined && v !== "" ? v : m;
  });
}

export function buildAgentRunMessages(bp, i, values, outputs, reference) {
  const agent = bp.agents[i];
  const system = `${fillTemplate(agent.systemPrompt, values)}

Return only the finished deliverable for your step, formatted in clean Markdown. Do not ask the user questions; make sensible assumptions and keep going.`;
  const parts = [];
  parts.push("## Workflow inputs\n" + bp.formFields.map(f => `- ${f.fieldName}: ${values[f.fieldName] || "(not provided)"}`).join("\n"));
  if (reference && reference.trim()) parts.push(`## Reference material\n${reference.trim()}`);
  outputs.slice(0, i).forEach((o, j) => {
    if (o?.text) parts.push(`## Output of Agent ${j + 1} – ${bp.agents[j].agentName}\n${o.text}`);
  });
  parts.push(`## Your task\nYou are Agent ${i + 1} of ${bp.agents.length}: ${agent.agentName}. ${agent.role}\nProduce: ${agent.outputDescription}`);
  return { system, user: parts.join("\n\n") };
}

export function buildRunMarkdown(bp, run) {
  const out = [`# ${bp.workflowTitle}`, "", `_Run: ${new Date(run.startedAt).toLocaleString()} · Model: ${run.model}_`, "", "## Inputs"];
  Object.entries(run.inputs || {}).forEach(([k, v]) => out.push(`- **${k}:** ${v}`));
  run.outputs.forEach((o, i) => {
    out.push("", "---", "", `## ${i + 1}. ${bp.agents[i]?.agentName || o.agentName}`, "", o.text || (o.error ? `_Error: ${o.error}_` : "_Not run_"));
  });
  return out.join("\n");
}
