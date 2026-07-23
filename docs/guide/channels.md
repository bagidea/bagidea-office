# Channels — command the office from Telegram / Discord / LINE / Slack / WhatsApp / Messenger

Messages from outside go straight to the **Director**: he reads, replies, and has the authority to delegate
(DELEGATE) just as if you'd commanded it yourself in chat — replies are sent back through the same channel.
Every incoming message also shows up in the 📡 feed (`📨 [telegram] ...`).

Configure everything at **⚙ → 📡 CHANNELS** (now its own tab) — each channel has a status light ● on / connecting / error

---

## ✈️ Telegram (easiest, start here — no public URL needed)

1. In Telegram, talk to **@BotFather** → `/newbot` → set a name → get a **bot token**
2. Paste the token in CONNECT → flip the switch → 💾 Save
3. Message your bot in Telegram and you're good to go

**Restrict it to just you (recommended):** message the bot once, then open
`https://api.telegram.org/bot<TOKEN>/getUpdates` in your browser — find your
`chat.id` and put it in the chat id field.

> How it works: long-polling — works even if your machine is behind NAT/a firewall

## 🎮 Discord

1. [discord.com/developers](https://discord.com/developers/applications) → New Application → Bot
2. Enable **MESSAGE CONTENT INTENT** (important! under Bot → Privileged Gateway Intents)
3. Copy the **Bot token** into CONNECT
4. Invite the bot to your server: OAuth2 → URL Generator → scope `bot` + permissions
   `Send Messages`, `Read Message History` → open the resulting link
5. (Optional) add a **channel id** to restrict the room (enable Developer Mode in Discord,
   then right-click the room → Copy Channel ID)

> How it works: connects directly to the Discord gateway (WebSocket) — receives messages in real time, replies via REST

## 💬 LINE (requires a public HTTPS URL)

The LINE Messaging API only delivers messages via webhook, so you need to open a path from
the internet into your machine — the easiest is cloudflared:

1. [developers.line.biz](https://developers.line.biz) → create a Messaging API channel
   → get a **Channel access token** + **Channel secret** → enter them in CONNECT
2. Open a tunnel: `cloudflared tunnel --url http://127.0.0.1:8787`
   (you get a URL like `https://xxx.trycloudflare.com`)
3. Set the Webhook URL in the LINE console:
   `https://xxx.trycloudflare.com/channels/line/webhook` → enable Use webhook
4. Add the bot as a friend via the QR code in the console and start messaging

> The system verifies the `X-Line-Signature` with the channel secret and replies via push
> (LINE's reply token expires sooner than the agent finishes thinking through the work)

## 🔷 Slack (requires a public HTTPS URL · experimental 🧪)

1. [api.slack.com/apps](https://api.slack.com/apps) → Create New App → From scratch
2. **OAuth & Permissions** → add scopes `chat:write`, `app_mentions:read`, `im:history`,
   `channels:history` → Install to Workspace → get a **Bot User OAuth Token** (`xoxb-…`)
3. Open a tunnel: `cloudflared tunnel --url http://127.0.0.1:8787`
4. **Event Subscriptions** → enable → Request URL = `https://xxx.trycloudflare.com/channels/slack/webhook`
   (Slack verifies the URL automatically) → subscribe to `message.channels` / `message.im`
5. Enter the token + **Signing Secret** (from the Basic Information page) in **CHANNELS** → flip the switch → 💾

## 🟢 WhatsApp (Cloud API · requires a public HTTPS URL · experimental 🧪)

1. [developers.facebook.com](https://developers.facebook.com) → create an app → add **WhatsApp**
   → get an **Access token** + **Phone number ID**
2. Open a cloudflared tunnel (same as above)
3. In **CHANNELS** enter the access token + phone number id + a **Verify token** (set any string you like,
   matching what you'll enter in Meta) → flip the switch → 💾
4. In Meta → WhatsApp → Configuration → Callback URL =
   `https://xxx.trycloudflare.com/channels/whatsapp/webhook` + the same Verify token → Verify and save

## 💠 Messenger (Facebook Page · requires a public HTTPS URL · experimental 🧪)

1. The same app as WhatsApp works → add **Messenger** → link a Facebook Page → get a **Page access token**
2. In **CHANNELS** enter the page access token + a **Verify token** → flip the switch → 💾
3. In Meta → Messenger → Webhooks → Callback URL =
   `https://xxx.trycloudflare.com/channels/messenger/webhook` + the same Verify token → subscribe to `messages`

> 🧪 Slack / WhatsApp / Messenger are new — if you get stuck setting one up, file an
> [issue](https://github.com/bagidea/bagidea-office/issues) with the step where you got stuck

---

## Things you can do right away

- *"Can you check how project X is coming along?"* — the Director checks the office status for you
- *"Tell Flamingo to build a landing page in project Y"* — actually delegate work from your phone

## Work updates land in your channels (0.9.45+)

The office now pushes milestones out to every connected channel, so long-running
work is followable from your phone:

- **🕊 delegation** — the moment the Director hands a task to an agent
- **📨 finished-work report** — when the delegated work completes, the Director's
  summary arrives in the channel (not just in the app)
- **💡 new pitch** — when the team proposes a project, you hear about it immediately

**Images ride along on Telegram** — if a reply or report references a preview image
(a generated image, an uploaded screenshot, any image path an agent produced), the
actual photo is uploaded to your Telegram chat after the text, not just a file path.

Mute everything with `"channelNotify": false` in `daemon/registry.json` (default is on).
