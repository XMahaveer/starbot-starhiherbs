const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ALLOWED_ORIGINS = [
  "https://starhiherbs.com",
  "https://www.starhiherbs.com",
  "http://localhost:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];

function getCorsHeaders(requestOrigin) {
  const origin = ALLOWED_ORIGINS.includes(requestOrigin)
    ? requestOrigin
    : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function loadSystemPrompt() {
  // Try to load from file system — works locally and in Vercel with bundled files
  const promptPaths = [
    path.join(process.cwd(), "system_prompt.md"),
    path.join(__dirname, "../system_prompt.md"),
    path.join(__dirname, "../../03_system_prompt/starbot_system_prompt.md"),
  ];
  for (const p of promptPaths) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, "utf-8");
    }
  }
  // Fallback inline prompt if file not found
  return `You are StarBot, the 24/7 AI sales assistant for Star Hi Herbs Pvt Ltd — a leading manufacturer of standardized herbal extracts based in Bangalore, India.

Star Hi Herbs produces 150+ herbal ingredients with 25+ international certifications including ISO 9001:2015, FSSC 22000, USDA Organic, WHO GMP, Halal, and Kosher.

Key contacts:
- Sales: starhi@starhiherbs.com | +91 89 7179 3584
- General: najish.n@starhiherbs.com
- Website: https://starhiherbs.com

Be helpful, professional, and accurate. For product specifications, pricing, samples, or orders, guide users to contact the sales team. If asked about something unrelated to Star Hi Herbs or herbal supplements, politely redirect the conversation.`;
}

module.exports = async function handler(req, res) {
  const corsHeaders = getCorsHeaders(req.headers.origin || "");

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    return res.end();
  }

  // Only allow POST
  if (req.method !== "POST") {
    res.writeHead(405, { ...corsHeaders, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Method not allowed" }));
  }

  try {
    const { message, conversationHistory = [] } = req.body;

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      res.writeHead(400, { ...corsHeaders, "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Message is required" }));
    }

    const systemPrompt = loadSystemPrompt();

    // Build messages array — validate and sanitize history
    const validHistory = Array.isArray(conversationHistory)
      ? conversationHistory
          .filter((m) => m && m.role && m.content && typeof m.content === "string")
          .slice(-20) // keep last 20 messages max
      : [];

    const messages = [
      ...validHistory,
      { role: "user", content: message.trim().slice(0, 2000) },
    ];

    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1000,
      system: systemPrompt,
      messages,
    });

    const reply = response.content[0]?.text || "I'm sorry, I couldn't generate a response. Please try again.";

    const updatedHistory = [
      ...validHistory,
      { role: "user", content: message.trim() },
      { role: "assistant", content: reply },
    ];

    res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
    res.end(JSON.stringify({ reply, conversationHistory: updatedHistory }));
  } catch (error) {
    console.error("Chat API error:", error);

    const isApiError = error?.status || error?.message?.includes("API");
    const userMessage = isApiError
      ? "I'm having trouble connecting right now. Please email starhi@starhiherbs.com directly or call +91 89 7179 3584."
      : "Something went wrong. Please try again or contact starhi@starhiherbs.com.";

    res.writeHead(500, { ...corsHeaders, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: userMessage, reply: userMessage }));
  }
};
