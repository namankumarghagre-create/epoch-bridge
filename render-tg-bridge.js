// ═══════════════════════════════════════════════════════════
//  Render Telegram Bridge  — add this to your existing Render server
//  
//  1. Deploy this on Render (alongside your WhatsApp bridge)
//  2. Set env: TELEGRAM_BOT_TOKEN, HF_SPACE_URL
//  3. Run: node render-tg-bridge.js  (or merge into existing server)
//  4. After deploy, visit: https://YOUR-RENDER-URL/setup-webhook
// ═══════════════════════════════════════════════════════════

const express = require("express");
const https   = require("https");

const app  = express();
app.use(express.json());

const TG_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const HF_URL     = process.env.HF_SPACE_URL;          // e.g. https://NamanZO-Epoch-system.hf.space
const PORT       = process.env.PORT || 3000;
const SECRET     = process.env.TG_WEBHOOK_SECRET || "epoch_secret_2026";

// ── 1. Telegram sends updates HERE ──────────────────────────
app.post(`/tg-webhook/${SECRET}`, async (req, res) => {
  res.sendStatus(200);   // ACK Telegram instantly

  const update = req.body;
  if (!update) return;

  // Forward to HuggingFace Space
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

// ── 2. One-time setup: register webhook with Telegram ───────
app.get("/setup-webhook", (req, res) => {
  if (!TG_TOKEN || !HF_URL) {
    return res.status(500).send("❌ Missing TELEGRAM_BOT_TOKEN or HF_SPACE_URL env vars");
  }

  const webhookUrl = `${req.protocol}://${req.get("host")}/tg-webhook/${SECRET}`;
  const apiUrl     = `https://api.telegram.org/bot${TG_TOKEN}/setWebhook`;
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

// ── 3. Health check ──────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status:  "ok",
    tg:      !!TG_TOKEN,
    hf_url:  HF_URL || "not set",
    webhook: `${req.protocol}://${req.get("host")}/tg-webhook/${SECRET}`,
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Render TG Bridge running on port ${PORT}`);
  console.log(`   Setup webhook: http://localhost:${PORT}/setup-webhook`);
  console.log(`   HF target:     ${HF_URL}`);
});
