# AI Features — main keys, voice, images, memory, realtime

The program's AI features are powered by **Main API Keys** — set them once at
⚙ → 🔗 CONNECT and everything unlocks.

## 🔑 Main API Keys

| Key | Unlocks |
|---|---|
| **OPENAI_API_KEY** | 🎤 Speech-to-text (Whisper) · 🖼 Image generation |
| **GEMINI_API_KEY** | 🎤 Speech-to-text · 🗣 Agent voices · 📞 Realtime · 🖼 Image generation |

- If a key isn't set, the related buttons appear **dimmed and disabled**, with a note explaining which key is required.
- The cards on the CONNECT page clearly state what each key unlocks, plus a link to obtain the key.
- **See which features are ready**: ⚙ → TOOLS → SYSTEM TOOLS (✅/🔒)

**Additional API Keys** (e.g. `GEMINI2`) are stored separately for agents to use in their own work
— injected into every session's env automatically.

## 🎤 Speech-to-text

- **🎤 button** next to the chat box: click to record, speak, click again → text drops into the input field.
- **Right Ctrl**: press to start recording, press again → sent as a command on behalf of the CEO immediately (works in every mode).
- A live VU meter appears in the red box so you know the mic is picking you up.
- The first time, the WebView asks for mic permission — click Allow once.

## 🗣 Agent voices (TTS)

Set a voice for an agent on the edit page (⚙ → AGENTS → edit → 🗣 Voice) — there are **16 presets,
clearly split female ♀ / male ♂ (8 each)**, each with its own mood/style
(bright, calm and cool, warm and deep, storyteller, etc.). Press **▶ Preview**
to listen before choosing (`bagidea voices` lists them all).

- Agents speak **only when something is genuinely worth announcing** (an important task done / the owner asks them to read it aloud) —
  they don't read every message; it's just flavor.
- Toggle all on/off at ⚙ → AGENTS → 🗣 Agent voices
- Requires GEMINI_API_KEY

## 📞 Realtime voice chat

Press the **📞** button next to the chat box → talk live by voice with the **main agent** via Gemini Live.
(The 📞 button only shows when main is selected — it's the office's spokesperson.) It knows the office's info
(OFFICE.md + the team) and uses **the voice you set for main**; if none is set, it uses the default preset ·
press 📞 again to hang up · requires GEMINI_API_KEY

> **Note — calls go straight to main only:** A live call always reaches the **main agent**
> (the default is the Director — SHINO, the office's spokesperson), never another agent.
> That's why the 📞 button only appears when main is selected (or at the CEO seat, where the call routes to main anyway).
> **There is no "set as main" button** that promotes another employee to lead — the main slot
> is a fixed Director position. If you want to change who main is / its persona / its voice,
> go to **⚙ → AGENTS → edit the Director (main) row** and adjust the name / persona / 🗣 voice
> of that row directly.

## 🖼 AI image generation

- You: `bagidea image "a cute robot mascot"` → get an image file
- Agents can call it themselves (via /gen/image) — generated images **show up in chat automatically**
- Uses OpenAI gpt-image-1 or Gemini (fallback)

## 🎨 Media Studio

⋯ → **Media Studio** opens the office's media room: make a picture, change one,
then make it move — in one window, because the work is iterative. You look at
the last result while writing the next instruction.

| | |
|---|---|
| 🖼 **Make** | text → PNG. OpenAI first, Gemini as the fallback. |
| ✏️ **Change** | picture + instruction → a **new** PNG. *"make the sky darker"* |
| 🎬 **Animate** | text, or a picture as the first frame → MP4 (Veo). |

Everything lands in `workspace/uploads/`, so it shows in chat and is reachable
from any project straight away.

A few deliberate choices:

- **An edit never overwrites its input.** You always get a new file, and the
  result becomes the selection — so a second instruction refines the first
  rather than starting over.
- **Agents can make and change pictures; only you can make video.** A clip costs
  around **$2**, an order of magnitude more than anything else the office spends,
  so `/gen/video` requires the UI and the button says the price next to it.
- **Video is minutes, not seconds.** The Studio starts the job, then polls and
  keeps showing how long it has been, so a slow generation never looks like a
  frozen window.

Agents reach the first two from Bash:

```bash
curl -s -X POST http://127.0.0.1:8787/gen/image \
  -H "content-type: application/json" -d '{"prompt":"<english prompt>"}'
curl -s -X POST http://127.0.0.1:8787/gen/image/edit \
  -H "content-type: application/json" \
  -d '{"url":"/uploads/<file>.png","prompt":"<english instruction>"}'
```

## 📎 Attachments & media in chat

- Press the **📎** button or **drag and drop a file** onto the window — it uploads and attaches to your message.
- Chat displays **images / video / audio** inline · agents can also open attached files with Read.
- When an agent creates a file and mentions its path, a preview is shown right away.

## 📄 File & Media Toolkit — the office *works with* your files

Every agent carries a **File & Media Toolkit** skill by default, so the team can actually
read, convert and produce real documents and media — not just talk about them. No key or
setup: just ask in plain language, and the agent reaches for the right tool.

| Ask for… | What it does | Uses (if present) |
|---|---|---|
| "Summarize this PDF" / "pull the tables out" | read & extract from PDFs | `pdftotext` / `pdfimages` |
| "Turn this spreadsheet into CSV/JSON" | convert **xlsx / docx / pptx** ↔ data/text | LibreOffice (`soffice`) |
| "Make a slide deck from these notes" | author **docs & slide decks** | `pandoc` |
| "Get me the transcript of this YouTube link" | download + **transcribe** video/audio | `yt-dlp` + `ffmpeg` |
| "Resize / crop / convert these images" | image edits & format conversion | ImageMagick |
| "Reshape this JSON" | slice & filter JSON | `jq` |
| "Open a PR / read this issue" | GitHub from the terminal | `gh` |

- **Files in, work out:** drop a file in chat (📎) or point the agent at a path, and ask.
- **Graceful degradation:** the toolkit uses whichever helper binaries are installed; if one
  is missing the agent says so instead of failing silently. The one-shot installer pulls the
  common ones (`ffmpeg`, `gh`, …) where it can. On Windows, LibreOffice / pandoc / yt-dlp can
  be added anytime (e.g. `winget install LibreOffice.LibreOffice`, `winget install JohnMacFarlane.Pandoc`).

## 🧠 Memory (Hermes-style)

It grows with you while staying token-efficient:

- **OFFICE.md** (🗂 → NOTES, at the bottom): shared info every agent knows — read
  only when relevant to the work, not loaded every time.
- **Per-agent memory notebooks** `workspace/memory/<agent>.md`: agents jot down important facts
  about you / the work themselves, automatically, after real work (`bagidea memory <agent>` to read).
- A new session sees only **a pointer + the last few lines of memory** — the rest is fetched on demand.

### 🔎 Recall by meaning, not only by words

What decides *which* memory a session sees is a search over everything the office
knows. That search matches **words** — BM25, no dependencies, works offline. It
is fast and it is often enough, and it has one blind spot you will eventually
hit: ask *"why did the wallpaper vanish"* and a note reading *"WorkerW teardown
kills the embedded world"* shares not one meaningful token with the question, so
however good that note is, it does not come back.

⚙ → SKILLS → **🔎 SEMANTIC RECALL** adds the other half. Point it at any
OpenAI-shaped `/embeddings` endpoint and each memory also gets a vector; a search
then runs both ways and **fuses the two rankings**, so words and meaning each get
a say and neither replaces the other.

| | |
|---|---|
| Endpoint | anything OpenAI-shaped — `http://localhost:11434/v1` for a local Ollama |
| Model | `nomic-embed-text` is the usual choice |
| Key | optional; name a key from 🔗 CONNECT rather than pasting one here |

A local Ollama is the recommended setup and the reason this is built the way it
is: your memory never leaves the machine, and it costs nothing.

Worth knowing:

- **It is off until you turn it on**, and the office works exactly as before
  while it is off. If the endpoint later goes down, recall quietly returns to
  matching words rather than failing.
- **Saving tests the endpoint** and tells you the vector size, because an
  embeddings endpoint that only fails later fails *silently*.
- **The first pass takes a while** — every existing memory has to be embedded
  once. It runs in the background, saves as it goes, and resumes after a
  restart. A dedicated embedding model does this in a minute or two; a general
  chat model can take ten.
- **Changing the model discards the old vectors.** Embeddings from two different
  models are not comparable, and comparing them anyway produces confident
  nonsense rather than an error.

## ☕ A living office + project proposals

- ⚙ → AGENTS → ☕ SOCIAL: let idle agents wander over to meet up — sometimes two chat,
  sometimes **groups of 3–4** chat / banter / brainstorm (mostly canned dialogue,
  free, no token cost; occasionally a real conversation via Claude).
- When a chat crystallizes into an idea → they write a **project proposal** for approval in 🗂 → TASKS.
  The proposal is steered toward being an independent creative work, or a **plugin for the office** (it won't
  touch the program's core systems directly, since that would break things).
- Press **✅ Approve / ✕ Reject** along with **typing a message to the team** (optional, works either way).
  Once approved, the task is created in the **`projects/`** folder (default) and the Director assembles a team for it
  — read the full details before deciding with `bagidea proposal show <id>`
