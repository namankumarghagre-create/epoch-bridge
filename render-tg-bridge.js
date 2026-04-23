// ═══════════════════════════════════════════════════════════
//  Render Telegram Bridge (RECEIVE & SEND)
// ═══════════════════════════════════════════════════════════

const express = require("express");
const https   = require("https");

const app  = express();
app.use(express.json());

const TG_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const HF_URL     = process.env.HF_SPACE_URL;          
const PORT       = process.env.PORT || 3000;
const SECRET     = process.env.TG_WEBHOOK_SECRET || "epoch_secret_2026";

// ── 1. RECEIVE: Telegram sends updates HERE ─────────────────
app.post(`/tg-webhook/${SECRET}`, async (req, res) => {
  res.sendStatus(200);   

  const update = req.body;
  if (!update) return;

  try {
    const body = JSON.stringify(update);
    const hfUrl = new URL(`${HF_URL}/telegram-webhook`);

    const options = {
      hostname: hfUrl.hostname,
      path:     hfUrl.pathname,
      method:   "POST",
      headers: {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const fwdReq = https.request(options, (fwdRes) => {
      console.log(`[TG→HF] update_id=${update.update_id} → HF status ${fwdRes.statusCode}`);
    });
    fwdReq.on("error", (e) => console.error("[TG→HF] Forward error:", e.message));
    fwdReq.write(body);
    fwdReq.end();

  } catch (e) {
    console.error("[TG→HF] Exception:", e.message);
  }
});

// ── 2. SETUP: Register webhook with Telegram ────────────────
app.get("/setup-webhook", (req, res) => {
  if (!TG_TOKEN || !HF_URL) {
    return res.status(500).send("❌ Missing TELEGRAM_BOT_TOKEN or HF_SPACE_URL env vars");
  }

  const webhookUrl = `https://${req.get("host")}/tg-webhook/${SECRET}`;
  const body       = JSON.stringify({
    url:                  webhookUrl,
    drop_pending_updates: true,
    allowed_updates:      ["message", "edited_message"],
  });

  const options = {
    hostname: "api.telegram.org",
    path:     `/bot${TG_TOKEN}/setWebhook`,
    method:   "POST",
    headers: {
      "Content-Type":   "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
  };

  const apiReq = https.request(options, (apiRes) => {
    let data = "";
    apiRes.on("data", (chunk) => data += chunk);
    apiRes.on("end", () => {
      const result = JSON.parse(data);
      if (result.ok) {
        console.log("✅ Telegram webhook set:", webhookUrl);
        res.send(`✅ Webhook registered!\n\nURL: ${webhookUrl}\n\nTelegram response: ${data}`);
      } else {
        res.status(500).send(`❌ Telegram error: ${data}`);
      }
    });
  });
  apiReq.on("error", (e) => res.status(500).send(`❌ Request error: ${e.message}`));
  apiReq.write(body);
  apiReq.end();
});

// ── 3. HEALTH CHECK ─────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status:  "ok",
    tg:      !!TG_TOKEN,
    hf_url:  HF_URL || "not set",
    webhook: `https://${req.get("host")}/tg-webhook/${SECRET}`,
  });
});

// ── 4. SEND: Hugging Face sends replies back HERE ───────────
app.post("/tg-send", (req, res) => {
  const { method, payload } = req.body;
  if (!method || !payload) return res.status(400).json({ error: "Missing method or payload" });

  const body = JSON.stringify(payload);
  const options = {
    hostname: "api.telegram.org",
    path:     `/bot${TG_TOKEN}/${method}`,
    method:   "POST",
    headers: {
      "Content-Type":   "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
  };

  const apiReq = https.request(options, (apiRes) => {
    let data = "";
    apiRes.on("data", (chunk) => data += chunk);
    apiRes.on("end", () => {
      try {
        res.status(apiRes.statusCode).json(JSON.parse(data));
      } catch(e) {
        res.status(500).json({ error: "Parse error" });
      }
    });
  });
  apiReq.on("error", (e) => res.status(500).json({ error: e.message }));
  apiReq.write(body);
  apiReq.end();
});

app.listen(PORT, () => {
  console.log(`🚀 Render TG Bridge running on port ${PORT}`);
  console.log(`   Setup webhook: http://localhost:${PORT}/setup-webhook`);
  console.log(`   HF target:     ${HF_URL}`);
});
