// ═══════════════════════════════════════════════════════════════════
//  Render Telegram Bridge  v2.0
//  Supports TWO separate bots:
//    1. Admin Bot  (TELEGRAM_BOT_TOKEN)  → /telegram-webhook on HF
//    2. Student Bot (STUDENT_BOT_TOKEN)  → /student-webhook on HF
//
//  How it works:
//    Telegram sends updates to Render (this bridge).
//    Bridge forwards to correct HF Space endpoint based on which
//    bot received the update.
//    HF Space processes and sends reply back via /tg-send or /student-tg-send.
// ═══════════════════════════════════════════════════════════════════

const express = require("express");
const https   = require("https");

const app = express();
app.use(express.json());

// ── ENV VARS ──────────────────────────────────────────────────────────────────
const ADMIN_TG_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const STUDENT_TG_TOKEN = process.env.STUDENT_BOT_TOKEN;
const HF_URL           = process.env.HF_SPACE_URL;          // e.g. https://namanx02-epoch-system-7860.hf.space
const PORT             = process.env.PORT || 3000;
const SECRET           = process.env.TG_WEBHOOK_SECRET || "epoch_secret_2026";

// ── HELPER: forward JSON body to a URL ───────────────────────────────────────
function forwardToHF(path, body, label) {
  if (!HF_URL) {
    console.error(`[${label}] HF_SPACE_URL not set — cannot forward`);
    return;
  }
  const bodyStr  = JSON.stringify(body);
  const hfTarget = new URL(`${HF_URL}${path}`);
  const options  = {
    hostname: hfTarget.hostname,
    path:     hfTarget.pathname,
    method:   "POST",
    headers:  {
      "Content-Type":   "application/json",
      "Content-Length": Buffer.byteLength(bodyStr),
    },
  };
  const req = https.request(options, (res) => {
    console.log(`[${label}] Forwarded to HF → status ${res.statusCode}`);
  });
  req.on("error", (e) => console.error(`[${label}] Forward error:`, e.message));
  req.write(bodyStr);
  req.end();
}

// ── HELPER: call Telegram API ─────────────────────────────────────────────────
function callTelegramAPI(token, method, payload, res) {
  const bodyStr = JSON.stringify(payload);
  const options = {
    hostname: "api.telegram.org",
    path:     `/bot${token}/${method}`,
    method:   "POST",
    headers:  {
      "Content-Type":   "application/json",
      "Content-Length": Buffer.byteLength(bodyStr),
    },
  };
  const apiReq = https.request(options, (apiRes) => {
    let data = "";
    apiRes.on("data", (chunk) => data += chunk);
    apiRes.on("end", () => {
      try {
        const parsed = JSON.parse(data);
        if (res) res.status(apiRes.statusCode).json(parsed);
        else     console.log(`[TG API] ${method} →`, parsed.ok ? "✅" : "❌", data.slice(0,100));
      } catch(e) {
        if (res) res.status(500).json({ error: "Parse error" });
      }
    });
  });
  apiReq.on("error", (e) => {
    if (res) res.status(500).json({ error: e.message });
    else     console.error(`[TG API] Error:`, e.message);
  });
  apiReq.write(bodyStr);
  apiReq.end();
}

// ══════════════════════════════════════════════════════════════════════════════
//  1. RECEIVE: Admin Bot updates (Telegram → Render → HF /telegram-webhook)
// ══════════════════════════════════════════════════════════════════════════════
app.post(`/tg-webhook/${SECRET}`, (req, res) => {
  res.sendStatus(200);
  const update = req.body;
  if (!update) return;
  console.log(`[AdminBot] update_id=${update.update_id}`);
  forwardToHF("/telegram-webhook", update, "AdminBot");
});

// ══════════════════════════════════════════════════════════════════════════════
//  2. RECEIVE: Student Bot updates (Telegram → Render → HF /student-webhook)
// ══════════════════════════════════════════════════════════════════════════════
app.post(`/student-tg-webhook/${SECRET}`, (req, res) => {
  res.sendStatus(200);
  const update = req.body;
  if (!update) return;
  console.log(`[StudentBot] update_id=${update.update_id}`);
  forwardToHF("/student-webhook", update, "StudentBot");
});

// ══════════════════════════════════════════════════════════════════════════════
//  3. SEND: HF sends admin bot replies HERE (HF → Render → Telegram Admin Bot)
// ══════════════════════════════════════════════════════════════════════════════
app.post("/tg-send", (req, res) => {
  const { method, payload } = req.body;
  if (!method || !payload)
    return res.status(400).json({ error: "Missing method or payload" });
  if (!ADMIN_TG_TOKEN)
    return res.status(500).json({ error: "TELEGRAM_BOT_TOKEN not set" });
  callTelegramAPI(ADMIN_TG_TOKEN, method, payload, res);
});

// ══════════════════════════════════════════════════════════════════════════════
//  4. SEND: HF sends student bot replies HERE (HF → Render → Telegram Student Bot)
// ══════════════════════════════════════════════════════════════════════════════
app.post("/student-tg-send", (req, res) => {
  const { method, payload } = req.body;
  if (!method || !payload)
    return res.status(400).json({ error: "Missing method or payload" });
  if (!STUDENT_TG_TOKEN)
    return res.status(500).json({ error: "STUDENT_BOT_TOKEN not set" });
  callTelegramAPI(STUDENT_TG_TOKEN, method, payload, res);
});

// ══════════════════════════════════════════════════════════════════════════════
//  5. SETUP: Register BOTH webhooks with Telegram
//  Call: GET /setup-webhooks (once after deploy)
// ══════════════════════════════════════════════════════════════════════════════
app.get("/setup-webhooks", async (req, res) => {
  const host        = req.get("host");
  const adminUrl    = `https://${host}/tg-webhook/${SECRET}`;
  const studentUrl  = `https://${host}/student-tg-webhook/${SECRET}`;
  const results     = [];

  if (!ADMIN_TG_TOKEN) {
    results.push("❌ TELEGRAM_BOT_TOKEN not set");
  } else {
    await new Promise((resolve) => {
      const body = JSON.stringify({
        url: adminUrl,
        drop_pending_updates: true,
        allowed_updates: ["message","edited_message","callback_query"],
      });
      callTelegramAPI(ADMIN_TG_TOKEN, "setWebhook", JSON.parse(body), {
        status: () => ({ json: (d) => { results.push(`Admin Bot: ${d.ok ? "✅" : "❌"} → ${adminUrl}`); resolve(); } })
      });
      setTimeout(resolve, 3000);
    });
  }

  if (!STUDENT_TG_TOKEN) {
    results.push("❌ STUDENT_BOT_TOKEN not set");
  } else {
    await new Promise((resolve) => {
      const body = JSON.stringify({
        url: studentUrl,
        drop_pending_updates: true,
        allowed_updates: ["message","edited_message","callback_query"],
      });
      callTelegramAPI(STUDENT_TG_TOKEN, "setWebhook", JSON.parse(body), {
        status: () => ({ json: (d) => { results.push(`Student Bot: ${d.ok ? "✅" : "❌"} → ${studentUrl}`); resolve(); } })
      });
      setTimeout(resolve, 3000);
    });
  }

  res.send(`
    <h2>🚀 Epoch TG Bridge — Webhook Setup</h2>
    <pre>${results.join("\n")}</pre>
    <hr>
    <b>Admin webhook:</b> ${adminUrl}<br>
    <b>Student webhook:</b> ${studentUrl}<br>
    <hr>
    <b>Status:</b> Admin token ${ADMIN_TG_TOKEN ? "✅ set" : "❌ missing"} |
    Student token ${STUDENT_TG_TOKEN ? "✅ set" : "❌ missing"}
  `);
});

// Simple setup for just admin bot
app.get("/setup-webhook", (req, res) => {
  if (!ADMIN_TG_TOKEN || !HF_URL)
    return res.status(500).send("❌ Missing TELEGRAM_BOT_TOKEN or HF_SPACE_URL");

  const webhookUrl = `https://${req.get("host")}/tg-webhook/${SECRET}`;
  const body = JSON.stringify({
    url: webhookUrl,
    drop_pending_updates: true,
    allowed_updates: ["message","edited_message","callback_query"],
  });
  callTelegramAPI(ADMIN_TG_TOKEN, "setWebhook", JSON.parse(body), res);
});

// ══════════════════════════════════════════════════════════════════════════════
//  6. HEALTH CHECK
// ══════════════════════════════════════════════════════════════════════════════
app.get("/health", (req, res) => {
  const host = req.get("host");
  res.json({
    status:          "ok",
    admin_token:     !!ADMIN_TG_TOKEN,
    student_token:   !!STUDENT_TG_TOKEN,
    hf_url:          HF_URL || "not set",
    admin_webhook:   `https://${host}/tg-webhook/${SECRET}`,
    student_webhook: `https://${host}/student-tg-webhook/${SECRET}`,
    setup_url:       `https://${host}/setup-webhooks`,
  });
});

app.get("/", (req, res) => {
  res.send(`
    <h2>🌸 Epoch TG Bridge v2.0</h2>
    <ul>
      <li>Admin token: ${ADMIN_TG_TOKEN ? "✅" : "❌ missing"}</li>
      <li>Student token: ${STUDENT_TG_TOKEN ? "✅" : "❌ missing"}</li>
      <li>HF Space: ${HF_URL || "❌ not set"}</li>
    </ul>
    <a href="/setup-webhooks">Setup Both Webhooks</a> |
    <a href="/health">Health Check</a>
  `);
});

app.listen(PORT, () => {
  console.log(`🚀 Epoch TG Bridge v2.0 running on port ${PORT}`);
  console.log(`   Admin webhook:   /tg-webhook/${SECRET}`);
  console.log(`   Student webhook: /student-tg-webhook/${SECRET}`);
  console.log(`   Setup both:      /setup-webhooks`);
  console.log(`   HF target:       ${HF_URL || "NOT SET ⚠️"}`);
});
