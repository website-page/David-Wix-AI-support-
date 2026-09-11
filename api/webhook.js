import OpenAI from "openai";
import { SYSTEM_PROMPT, MODEL } from "../personality.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
  if (!token) throw new Error("BOT_TOKEN is missing in Vercel environment variables");

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(`Telegram ${method} failed: ${data.description || `HTTP ${response.status}`}`);
  }
  return data.result;
}

async function sendTyping(chatId, businessConnectionId) {
  const body = { chat_id: chatId, action: "typing" };
  if (businessConnectionId) body.business_connection_id = businessConnectionId;
  try {
    await telegram("sendChatAction", body);
  } catch (error) {
    console.error("Typing status failed:", error.message);
  }
}

async function generateReply(key, incomingText) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing in Vercel environment variables");
  }

  const history = historyFor(key);
  const response = await openai.responses.create({
    model: MODEL,
    instructions: SYSTEM_PROMPT,
    input: [...history, { role: "user", content: incomingText }],
    max_output_tokens: 500
  });

  const text = (response.output_text || "").trim();
  if (!text) throw new Error("OpenAI returned an empty response");

  addToHistory(key, "user", incomingText);
  addToHistory(key, "assistant", text);
  return text;
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "David Telegram AI Automation",
      status: "online"
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const secret = process.env.WEBHOOK_SECRET;
  if (secret && req.headers["x-telegram-bot-api-secret-token"] !== secret) {
    console.error("Telegram webhook rejected: secret token mismatch");
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const update = req.body || {};

  try {
    // Telegram Business sends messages as business_message updates.
    // Normal message is also supported for direct bot testing.
    const message = update.business_message || update.message;

    if (!message) {
      // A connection update is useful evidence that Telegram reached the webhook.
      if (update.business_connection) {
        console.log("Business connection update received", {
          id: update.business_connection.id,
          enabled: update.business_connection.is_enabled,
          rights: update.business_connection.rights
        });
        return res.status(200).json({ ok: true, type: "business_connection" });
      }
      return res.status(200).json({ ok: true, ignored: true, reason: "unsupported update" });
    }

    const text = getText(message);
    if (!text) {
      return res.status(200).json({ ok: true, ignored: true, reason: "no text" });
    }

    const chatId = message.chat?.id;
    const businessConnectionId = update.business_message
      ? message.business_connection_id
      : undefined;

    if (!chatId) {
      return res.status(200).json({ ok: true, ignored: true, reason: "no chat id" });
    }

    if (update.business_message && !businessConnectionId) {
      throw new Error("Telegram business_message has no business_connection_id");
    }

    const key = `${businessConnectionId || "direct"}:${chatId}`;

    console.log("Incoming message", {
      type: update.business_message ? "business_message" : "message",
      chatId,
      hasBusinessConnection: Boolean(businessConnectionId)
    });

    await sendTyping(chatId, businessConnectionId);
    const reply = await generateReply(key, text);

    const sendBody = {
      chat_id: chatId,
      text: reply,
      disable_web_page_preview: true
    };

    if (businessConnectionId) {
      sendBody.business_connection_id = businessConnectionId;
    }

    const sent = await telegram("sendMessage", sendBody);

    console.log("Reply sent successfully", {
      chatId,
      messageId: sent?.message_id,
      businessConnection: Boolean(businessConnectionId)
    });

    return res.status(200).json({ ok: true, replied: true });
  } catch (error) {
    // Log the real error in Vercel instead of hiding it behind a fake success.
    console.error("Webhook processing failed:", error);
    return res.status(500).json({
      ok: false,
      error: "Processing failed",
      message: error?.message || "Unknown error"
    });
  }
}
