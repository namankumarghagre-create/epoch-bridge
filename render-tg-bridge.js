// ═══════════════════════════════════════════════════════════════════
//  Render Telegram Bridge v2  —  epoch-bridge
//  Handles BOTH:
//    • Admin bot  (TELEGRAM_BOT_TOKEN)    → /telegram-webhook on HF
//    • Student bot (STUDENT_BOT_TOKEN)   → /student-webhook on HF
// ═══════════════════════════════════════════════════════════════════

const express = require("express");
const https   = require("https");

const app = express();
app.use(express.json());

// ── ENV vars ────────────────────────────────────────────────────────
const ADMIN_TG_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;   // Admin bot token
const STUDENT_TG_TOKEN = process.env.STUDENT_BOT_TOKEN;    // Student bot token
const HF_URL           = process.env.HF_SPACE_URL;         // e.g. https://namanzo-epoch-system.hf.space
const PORT             = process.env.PORT || 3000;
const SECRET           = process.env.TG_WEBHOOK_SECRET || "epoch_secret_2026";
const STUDENT_SECRET   = process.env.STUDENT_WEBHOOK_SECRET || "epoch_student_2026";

// ── Helper: forward a JSON body to HF Space ─────────────────────────
function forwardToHF(hfPath, body, label) {
  try {
    const bodyStr = JSON.stringify(body);
    const hfUrl   = new URL(`${HF_URL}${hfPath}`);
    const options = {
      hostname: hfUrl.hostname,
      path:     hfUrl.pathname,
      method:   "POST",
      headers: {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(bodyStr),
      },
    };
    const req = https.request(options, (res) => {
      console.log(`[${label}] HF status: ${res.statusCode}`);
    });
    req.on("error", (e) => console.error(`[${label}] Forward error:`, e.message));
    req.write(bodyStr);
    req.end();
  } catch (e) {
    console.error(`[${label}] Exception:`, e.message);
  }
}

// ── Helper: call Telegram Bot API ───────────────────────────────────
function callTelegram(token, method, payload) {
  return new Promise((resolve, reject) => {
    const body    = JSON.stringify(payload);
    const options = {
      hostname: "api.telegram.org",
      path:     `/bot${token}/${method}`,
      method:   "POST",
      headers: {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}


// ════════════════════════════════════════════════════════════════════
//  1a. RECEIVE — Admin bot updates  →  HF /telegram-webhook
// ════════════════════════════════════════════════════════════════════
app.post(`/tg-webhook/${SECRET}`, (req, res) => {
  res.sendStatus(200);
  const update = req.body;
  if (!update) return;
  console.log(`[AdminBot] update_id=${update.update_id}`);
  forwardToHF("/telegram-webhook", update, "AdminBot→HF");
});


// ════════════════════════════════════════════════════════════════════
//  1b. RECEIVE — Student bot updates  →  HF /student-webhook
// ════════════════════════════════════════════════════════════════════
app.post(`/student-webhook/${STUDENT_SECRET}`, (req, res) => {
  res.sendStatus(200);
  const update = req.body;
  if (!update) return;
  console.log(`[StudentBot] update_id=${update.update_id}`);
  forwardToHF("/student-webhook", update, "StudentBot→HF");
});


// ════════════════════════════════════════════════════════════════════
//  2. SEND — HF calls this to send Admin bot messages via Telegram
// ════════════════════════════════════════════════════════════════════
app.post("/tg-send", async (req, res) => {
  const { method, payload } = req.body;
  if (!method || !payload)
    return res.status(400).json({ error: "Missing method or payload" });

  if (!ADMIN_TG_TOKEN)
    return res.status(500).json({ error: "TELEGRAM_BOT_TOKEN not set on Render" });

  try {
    const result = await callTelegram(ADMIN_TG_TOKEN, method, payload);
    res.status(result.status).json(result.body);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});


// ════════════════════════════════════════════════════════════════════
//  3. SEND — HF calls this to send Student bot messages via Telegram
// ════════════════════════════════════════════════════════════════════
app.post("/student-tg-send", async (req, res) => {
  const { method, payload } = req.body;
  if (!method || !payload)
    return res.status(400).json({ error: "Missing method or payload" });

  if (!STUDENT_TG_TOKEN)
    return res.status(500).json({ error: "STUDENT_BOT_TOKEN not set on Render" });

  try {
    const result = await callTelegram(STUDENT_TG_TOKEN, method, payload);
    res.status(result.status).json(result.body);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});


// ════════════════════════════════════════════════════════════════════
//  4. SETUP — Register webhooks with Telegram (both bots)
// ════════════════════════════════════════════════════════════════════
app.get("/setup-webhook", async (req, res) => {
  const host    = req.get("host");
  const results = [];

  // ── Admin bot ──────────────────────────────────────────────────
  if (ADMIN_TG_TOKEN) {
    const adminUrl = `https://${host}/tg-webhook/${SECRET}`;
    const r = await callTelegram(ADMIN_TG_TOKEN, "setWebhook", {
      url:                  adminUrl,
      drop_pending_updates: true,
      allowed_updates:      ["message", "edited_message", "callback_query"],
    });
    const ok = r.body?.ok;
    console.log(`[Setup] Admin bot webhook ${ok ? "✅" : "❌"}: ${adminUrl}`);
    results.push(`Admin bot:   ${ok ? "✅" : "❌"} ${adminUrl}`);
  } else {
    results.push("Admin bot:   ⚠️  TELEGRAM_BOT_TOKEN not set");
  }

  // ── Student bot ────────────────────────────────────────────────
  if (STUDENT_TG_TOKEN) {
    const studentUrl = `https://${host}/student-webhook/${STUDENT_SECRET}`;
    const r = await callTelegram(STUDENT_TG_TOKEN, "setWebhook", {
      url:                  studentUrl,
      drop_pending_updates: true,
      allowed_updates:      ["message", "edited_message", "callback_query"],
    });
    const ok = r.body?.ok;
    console.log(`[Setup] Student bot webhook ${ok ? "✅" : "❌"}: ${studentUrl}`);
    results.push(`Student bot: ${ok ? "✅" : "❌"} ${studentUrl}`);
  } else {
    results.push("Student bot: ⚠️  STUDENT_BOT_TOKEN not set");
  }

  res.send(
    "🤖 Webhook Setup Results\n\n" +
    results.join("\n") +
    "\n\n---\nRequired Render env vars:\n" +
    "  TELEGRAM_BOT_TOKEN  = admin bot token\n" +
    "  STUDENT_BOT_TOKEN   = student bot token\n" +
    "  HF_SPACE_URL        = https://namanzo-epoch-system.hf.space\n" +
    "  TG_WEBHOOK_SECRET   = epoch_secret_2026\n" +
    "  STUDENT_WEBHOOK_SECRET = epoch_student_2026"
  );
});


// ════════════════════════════════════════════════════════════════════
//  5. WA SEND — WhatsApp bridge relay (from HF to WA bridge)
//  HF calls POST /wa-send with { phone, message }
// ════════════════════════════════════════════════════════════════════
const WA_BRIDGE_URL = process.env.WA_BRIDGE_URL;  // HF WA bridge Space URL

app.post("/wa-send", async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message)
    return res.status(400).json({ error: "Missing phone or message" });

  if (!WA_BRIDGE_URL)
    return res.status(500).json({ error: "WA_BRIDGE_URL not set on Render" });

  try {
    const bodyStr = JSON.stringify({ phone, message });
    const waUrl   = new URL(`${WA_BRIDGE_URL}/send`);
    const options = {
      hostname: waUrl.hostname,
      path:     waUrl.pathname,
      method:   "POST",
      headers: {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(bodyStr),
      },
    };
    const result = await new Promise((resolve, reject) => {
      const req2 = https.request(options, (r2) => {
        let data = "";
        r2.on("data", (c) => data += c);
        r2.on("end", () => resolve({ status: r2.statusCode, body: data }));
      });
      req2.on("error", reject);
      req2.write(bodyStr);
      req2.end();
    });
    res.status(result.status).send(result.body);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});


// ════════════════════════════════════════════════════════════════════
//  6. HEALTH CHECK
// ════════════════════════════════════════════════════════════════════
app.get("/health", (req, res) => {
  const host = req.get("host");
  res.json({
    status:          "ok",
    admin_bot:       !!ADMIN_TG_TOKEN,
    student_bot:     !!STUDENT_TG_TOKEN,
    hf_url:          HF_URL || "NOT SET",
    wa_bridge:       WA_BRIDGE_URL || "NOT SET",
    admin_webhook:   `https://${host}/tg-webhook/${SECRET}`,
    student_webhook: `https://${host}/student-webhook/${STUDENT_SECRET}`,
    endpoints: {
      receive_admin:   `POST /tg-webhook/${SECRET}`,
      receive_student: `POST /student-webhook/${STUDENT_SECRET}`,
      send_admin:      "POST /tg-send",
      send_student:    "POST /student-tg-send",
      send_wa:         "POST /wa-send",
      setup:           "GET /setup-webhook",
      health:          "GET /health",
    }
  });
});


app.listen(PORT, () => {
  console.log(`🚀 Render Bridge v2 running on port ${PORT}`);
  console.log(`   Admin bot:   ${ADMIN_TG_TOKEN ? "✅ Token set" : "❌ TELEGRAM_BOT_TOKEN missing"}`);
  console.log(`   Student bot: ${STUDENT_TG_TOKEN ? "✅ Token set" : "❌ STUDENT_BOT_TOKEN missing"}`);
  console.log(`   HF target:   ${HF_URL || "❌ HF_SPACE_URL missing"}`);
  console.log(`   Setup both webhooks: https://your-app.onrender.com/setup-webhook`);
});
