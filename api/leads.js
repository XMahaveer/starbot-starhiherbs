const fs = require("fs");
const path = require("path");

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
  };
}

async function sendLeadEmail(lead) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.warn("RESEND_API_KEY not set — skipping email notification");
    return;
  }

  const toEmail = process.env.LEADS_EMAIL || "starhi@starhiherbs.com";

  const emailBody = `
New Lead from StarBot — Star Hi Herbs Website

Name: ${lead.name}
Company: ${lead.company}
Country: ${lead.country}
Email: ${lead.email}
Product Interest: ${lead.productInterest || "Not specified"}
Query: ${lead.query || "Not specified"}
Timestamp: ${lead.timestamp}
  `.trim();

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "StarBot <noreply@starhiherbs.com>",
      to: [toEmail],
      subject: `New Lead: ${lead.name} from ${lead.company} (${lead.country})`,
      text: emailBody,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error("Resend email failed:", err);
  }
}

function saveLead(lead) {
  // In Vercel serverless, /tmp is writable
  const leadsPath = process.env.LEADS_LOG_PATH || path.join("/tmp", "leads_log.json");

  let leads = [];
  if (fs.existsSync(leadsPath)) {
    try {
      leads = JSON.parse(fs.readFileSync(leadsPath, "utf-8"));
    } catch {
      leads = [];
    }
  }

  leads.push(lead);
  fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2), "utf-8");
}

module.exports = async function handler(req, res) {
  const corsHeaders = getCorsHeaders(req.headers.origin || "");

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    return res.end();
  }

  if (req.method !== "POST") {
    res.writeHead(405, { ...corsHeaders, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Method not allowed" }));
  }

  try {
    const { name, company, country, email, productInterest, query } = req.body;

    // Validate required fields
    if (!name || !email) {
      res.writeHead(400, { ...corsHeaders, "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Name and email are required" }));
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.writeHead(400, { ...corsHeaders, "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Invalid email address" }));
    }

    const lead = {
      id: `lead_${Date.now()}`,
      name: String(name).slice(0, 100),
      company: String(company || "").slice(0, 100),
      country: String(country || "").slice(0, 50),
      email: String(email).slice(0, 200),
      productInterest: String(productInterest || "").slice(0, 200),
      query: String(query || "").slice(0, 1000),
      timestamp: new Date().toISOString(),
      source: "StarBot Widget",
    };

    // Save to file and send email concurrently
    saveLead(lead);
    await sendLeadEmail(lead);

    res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, message: "Thank you! Our team will contact you shortly." }));
  } catch (error) {
    console.error("Leads API error:", error);
    res.writeHead(500, { ...corsHeaders, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Failed to save lead. Please email starhi@starhiherbs.com directly." }));
  }
};
