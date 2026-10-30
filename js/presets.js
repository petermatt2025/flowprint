// Niche presets modelled on the most-used MindPal workflow types.
export const PRESETS = {
  ebook: {
    name: "Ebook Creator",
    taskDescription:
      "I create PLR ebooks for a specific niche. In one workflow run I want to research the niche, produce a full table of contents, write three chapter drafts, and finish with a short Amazon-style sales description.",
    agentCount: 4,
    agentRoles: ["Niche Researcher", "Outline Architect", "Chapter Writer", "Sales Copywriter"],
    outputTypes: ["ebook"],
    suggestedFields: ["Niche", "Target reader", "Ebook title idea", "Tone"],
    knowledgeSources: ["Brand voice guide", "Sample chapters you like", "Niche research notes"]
  },
  hooks: {
    name: "Viral Social Hooks",
    taskDescription:
      "I make Instagram Reels for my niche. Each run I want 20 viral hooks for a topic, pick the 3 strongest, write a short Reel script for the best one, and write the Reel description with hashtags.",
    agentCount: 4,
    agentRoles: ["Trend Analyst", "Hook Generator", "Script Writer", "Caption Writer"],
    outputTypes: ["social"],
    suggestedFields: ["Niche", "Topic", "Audience", "Call to action"],
    knowledgeSources: ["Top-performing past posts", "Brand voice guide", "Hook swipe file"]
  },
  email: {
    name: "Email Sequence Builder",
    taskDescription:
      "I sell digital products and need a 5-email nurture sequence for each new offer: subject lines, preview text, and email bodies that move a new subscriber from welcome to purchase.",
    agentCount: 3,
    agentRoles: ["Offer Analyst", "Sequence Strategist", "Email Copywriter"],
    outputTypes: ["email"],
    suggestedFields: ["Product name", "Price", "Audience pain point", "Sales page URL"],
    knowledgeSources: ["Offer details / sales page", "Customer testimonials", "Brand voice guide"]
  },
  bonus: {
    name: "Bonus Page Builder",
    taskDescription:
      "I promote apps and digital products as an affiliate. For each product I want 5 custom bonus ideas, the content for each bonus, and a bonus page with headline, bonus descriptions and a call to action.",
    agentCount: 4,
    agentRoles: ["Product Analyst", "Bonus Ideator", "Bonus Content Creator", "Bonus Page Copywriter"],
    outputTypes: ["sales"],
    suggestedFields: ["Product name", "Product sales page URL", "Audience", "Affiliate link"],
    knowledgeSources: ["Product review notes", "Past bonus pages that converted", "Brand voice guide"]
  },
  multi: {
    name: "Multi-Platform Post Generator",
    taskDescription:
      "From one idea or blog post I want native posts for Facebook, LinkedIn, Instagram, X and Threads, each following that platform's best practices, plus 3 image prompt ideas.",
    agentCount: 4,
    agentRoles: ["Core Message Extractor", "Platform Adapter", "Image Prompt Designer", "Quality Editor"],
    outputTypes: ["social"],
    suggestedFields: ["Source idea or text", "Audience", "Goal", "Platforms"],
    knowledgeSources: ["Platform style guides", "Brand voice guide", "Top-performing posts"]
  }
};

export const OUTPUT_TYPES = [
  { key: "ebook", label: "Ebook Content" },
  { key: "social", label: "Social Media Posts" },
  { key: "email", label: "Email Sequence" },
  { key: "sales", label: "Bonus/Sales Page" },
  { key: "course", label: "Course Outline" },
  { key: "checklist", label: "Checklist or Lead Magnet" },
  { key: "other", label: "Other" }
];
