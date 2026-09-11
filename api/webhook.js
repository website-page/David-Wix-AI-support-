import OpenAI from "openai";
import { SYSTEM_PROMPT, MODEL } from "../personality.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Vercel functions are stateless, so this is a best-effort short-term cache.
// Telegram remains the source of truth for the chat connection.
const memory = globalThis.__davidTelegramMemory || new Map();
globalThis.__davidTelegramMemory = memory;

const MAX_HISTORY = 12;

function getText(message) {
  if (typeof message?.text === "string") return message.text.trim();
  if (typeof message?.caption === "string") return message.caption.trim();
  return "";
}

function historyFor(key) {
  if (!memory.has(key)) memory.set(key, []);
  return memory.get(key);
}

function addToHistory(key, role, content) {
  const history = historyFor(key);
  history.push({ role, content });
  while (history.length > MAX_HISTORY) history.shift();
}

async function telegram(method, body) {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN is missing");

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.description || "unknown error"}`);
  return data.result;
}

async function sendTyping(chatId, businessConnectionId) {
  const body = { chat_id: chatId, action: "typing" };
  if (businessConnectionId) body.business_connection_id = businessConnectionId;
  try {
    await telegram("sendChatAction", body);
  } catch {
    // Typing status is cosmetic; do not fail the reply if Telegram rejects it.
  }
}

async function generateReply(key, incomingText) {
  const history = historyFor(key);

  const response = await openai.responses.create({
    model: MODEL,
    instructions: SYSTEM_PROMPT,
    input: [
      ...history,
      { role: "user", content: incomingText }
    ],
    max_output_tokens: 500,
    temperature: 0.7
  });

  const text = (response.output_text || "").trim();
  if (!text) throw new Error("OpenAI returned an empty response");

  addToHistory(key, "user", incomingText);
  addToHistory(key, "assistant", text);
  return text;
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, service: "David Telegram AI Automation" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const secret = process.env.WEBHOOK_SECRET;
  if (secret && req.headers["x-telegram-bot-api-secret-token"] !== secret) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  try {
    const update = req.body || {};

    // Messages sent through Telegram profile Chat Automation arrive as business_message.
    // Normal message support is included so the bot can also be tested directly.
    const message = update.business_message || update.message;
    if (!message) return res.status(200).json({ ok: true, ignored: true });

    const text = getText(message);
    if (!text) return res.status(200).json({ ok: true, ignored: true, reason: "no text" });

    const chatId = message.chat?.id;
    const businessConnectionId = update.business_message
      ? message.business_connection_id
      : undefined;

    if (!chatId) return res.status(200).json({ ok: true, ignored: true, reason: "no chat id" });

    const key = `${businessConnectionId || "direct"}:${chatId}`;

    await sendTyping(chatId, businessConnectionId);
    const reply = await generateReply(key, text);

    const sendBody = {
      chat_id: chatId,
      text: reply,
      disable_web_page_preview: true
    };

    if (businessConnectionId) sendBody.business_connection_id = businessConnectionId;

    await telegram("sendMessage", sendBody);

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);

    // Return 200 so Telegram does not repeatedly redeliver a failed update forever.
    return res.status(200).json({ ok: false, error: "Processing failed" });
  }
}
