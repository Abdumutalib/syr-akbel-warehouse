import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function setupMagicLinkHandlers(dataDir, telegramAdminChatId, telegramBotToken) {
  const magicLinkPath = path.join(dataDir, "magic-links.json");
  const ttl = 15 * 60 * 1000; // 15 daqiqa

  function loadTokens() {
    try {
      if (!fs.existsSync(magicLinkPath)) return { tokens: [] };
      const raw = fs.readFileSync(magicLinkPath, "utf8");
      const parsed = JSON.parse(raw);
      const now = Date.now();
      const active = (parsed.tokens || []).filter((t) => t.expiresAt > now);
      return { tokens: active };
    } catch {
      return { tokens: [] };
    }
  }

  function saveTokens(state) {
    fs.mkdirSync(path.dirname(magicLinkPath), { recursive: true });
    fs.writeFileSync(magicLinkPath, JSON.stringify(state, null, 2), "utf8");
  }

  function createToken(email) {
    const token = crypto.randomBytes(24).toString("hex");
    const expiresAt = Date.now() + ttl;
    const state = loadTokens();
    state.tokens.push({ token, email, createdAt: new Date().toISOString(), expiresAt });
    saveTokens(state);
    return token;
  }

  function verifyToken(token) {
    const state = loadTokens();
    const found = state.tokens.find((t) => t.token === token && t.expiresAt > Date.now());
    if (found) {
      state.tokens = state.tokens.filter((t) => t.token !== token);
      saveTokens(state);
      return found.email;
    }
    return null;
  }

  async function sendMagicLinkViaTelegram(token, email, appUrl) {
    if (!telegramAdminChatId || !telegramBotToken) return false;
    const link = `${appUrl}/warehouse-verify-link?token=${token}`;
    const text = `🔐 Admin Kiriş Ҳаволаси\n\n📧 ${email}\n\n👉 Ҳаволаро босиб кириш:\n${link}\n\n⏰ Ҳавола 15 дақиқава туғма`;
    try {
      const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: telegramAdminChatId,
          text,
          parse_mode: "HTML",
        }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  return {
    createToken,
    verifyToken,
    sendMagicLinkViaTelegram,
    loadTokens,
    saveTokens,
  };
}
