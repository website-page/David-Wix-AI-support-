# David Telegram AI Automation

A Vercel-ready Telegram bot that uses OpenAI to reply through Telegram Profile Chat Automation / Business-style chat automation.

Telegram officially supports connecting a bot to a profile so the bot can answer messages on the user's behalf. The incoming updates are delivered as `business_message` updates and replies are sent with the matching `business_connection_id`.

## 1. Deploy to Vercel

Import this repository into Vercel.

Add these environment variables:

- `BOT_TOKEN` — your token from @BotFather
- `OPENAI_API_KEY` — your OpenAI API key
- `OPENAI_MODEL` — optional; defaults to `gpt-5-mini`
- `WEBHOOK_SECRET` — optional, but recommended. Use a long random string.

Deploy the project.

## 2. Set the Telegram webhook

After deployment, copy your Vercel URL and set the webhook to:

`https://YOUR-VERCEL-DOMAIN.vercel.app/api/webhook`

If you set `WEBHOOK_SECRET`, include the same value when registering the webhook. For example:

`https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=https%3A%2F%2FYOUR-VERCEL-DOMAIN.vercel.app%2Fapi%2Fwebhook&secret_token=YOUR_WEBHOOK_SECRET`

Do not put your token or secret into this repository.

## 3. Enable Telegram Chat Automation

In @BotFather, enable the bot feature required for Telegram profile/chat automation (Telegram documents this as Secretary Mode / Business bot access).

Then in Telegram open your profile's **Chat Automation** / **AI Automation** settings, connect the bot, and choose which chats the bot may access.

## 4. Test

Open:

`https://YOUR-VERCEL-DOMAIN.vercel.app/api/webhook`

You should receive a small JSON response showing the service is running.

Then send a message through a chat covered by your Telegram automation permissions.

## Notes

- The bot ignores non-text/media-only messages unless they contain a caption.
- Short-term conversation context is kept in memory when the same Vercel instance handles multiple messages. Vercel functions are stateless, so this is not guaranteed to survive a cold start.
- The personality is defined in `personality.js` and can be edited without changing the webhook logic.
- If someone directly asks whether the responder is an AI or automated assistant, the bot answers honestly.
- Never commit `BOT_TOKEN`, `OPENAI_API_KEY`, or `WEBHOOK_SECRET`.
