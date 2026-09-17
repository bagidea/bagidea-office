# Launch posts — v1.0.0 / v1.0.1

> Written for the **v1.0 launch**. Patches have shipped since (v1.0.2 docs +
> full 14-language site, v1.0.3 a settings-row layout fix, v1.0.4 a proxy /
> firewall diagnostic) — none of them change anything claimed below, so the
> copy stands as written. Check `VERSION` before quoting a version number.

Ready to copy and paste. Every block below is plain text with no markdown
decoration, so selecting a block gives you exactly what goes in the post.

- **Link to use everywhere:** `https://github.com/bagidea/bagidea-office`
- **Images:** `post-1-office.png` · `post-2-engines.png` · `post-3-studio.png` (1080×1080, real screenshots)
- **Long-form article:** https://claude.ai/code/artifact/5ced3714-97a6-457c-940c-9f35575a3837

Which image goes where:

| | Image | Shows |
|---|---|---|
| ① | `post-1-office.png` | the office running on a real desktop — use this one everywhere |
| ② | `post-2-engines.png` | Tools Hub: Blender, Godot, Unity, Unreal, Roblox with real commands |
| ③ | `post-3-studio.png` | Media Studio: make / change / animate |

Numbers below are verified against the code, not rounded up: 18 agents, 19 model
providers, 16 built-in skills, 6 chat platforms, 14 languages, 43 tools.

---

## 1 · Master description

Reusable anywhere — a store listing, a README blurb, a pinned comment, the first
paragraph of any post.

### Thai

BagIdea Office คือทีมพนักงาน AI ที่อยู่บนเดสก์ท็อปคุณเป็นออฟฟิศพิกเซล 3D คุณสั่งงานในแชท น้องๆ ลงมือทำในโฟลเดอร์จริงของคุณ แล้วเดินไปทำงานที่โต๊ะให้เห็นกับตา

จ้างได้ถึง 18 คน แต่ละคนมีบุคลิก ความถนัด ทักษะ เครื่องมือ และสมองของตัวเอง — เลือกโมเดลจาก 19 ผู้ให้บริการ (Claude, GPT, Gemini, DeepSeek, Qwen, Kimi, GLM, xAI, Groq หรือ Ollama/LM Studio ในเครื่องแบบไม่ต้องต่อเน็ต) คนละเจ้ากันได้ในออฟฟิศเดียว

ผู้อำนวยการแบ่งงานให้ทีมเอง · งานเร่งก็สั่งแตกร่างทำขนานได้ · ทำงานต่อเนื่องเองได้สูงสุด 8 รอบต่องานจนจบ · จะขอใช้เครื่องมือที่คุณไม่ได้อนุญาต ต้องเดินมาขอที่ Security Center ก่อนเสมอ

มี 16 ทักษะติดตั้งมาให้ (ค้นข้อมูลเชิงลึก, คุมเบราว์เซอร์จริง, review โค้ด, หาสาเหตุบั๊ก, จัดการไฟล์ PDF/Excel/Word/สไลด์, สร้างปลั๊กอินให้ตัวเอง ฯลฯ) · จำเรื่องคุณและงานได้ข้ามวัน · ตั้งเวลาทำงานล่วงหน้าได้ · คุยกลับผ่าน Telegram, Discord, LINE, Slack, WhatsApp, Messenger · พูดคุยด้วยเสียงได้ · ใช้ได้ 14 ภาษา

ฟรี MIT — โค้ดเปิดทั้งหมด

### English

BagIdea Office is a team of AI employees that lives on your desktop as a 3D pixel office. You give orders in chat; they work in your real folders — and you watch them walk to their desks and do it.

Hire up to 18 of them. Each has their own persona, expertise, skills, tools and their own brain — pick a model from 19 providers (Claude, GPT, Gemini, DeepSeek, Qwen, Kimi, GLM, xAI, Groq, or Ollama / LM Studio running locally with no internet at all). Different agents can run on different providers in the same office.

The Director assigns work across the team on its own · urgent jobs fork into parallel clones · it keeps going by itself for up to 8 rounds until the job is actually finished · and any tool you haven't granted sends the agent walking to the Security Center to ask you first.

16 skills ship built in — deep research, driving a real browser, code review, root-causing bugs, handling PDF/Excel/Word/slides, even building its own plugins. It remembers you and the work across days, schedules jobs ahead, reports back through Telegram, Discord, LINE, Slack, WhatsApp and Messenger, talks out loud, and runs in 14 languages.

Free and MIT — all of it open source.

---

## 2 · Facebook

Attach image ①. Optionally add ② and ③ as a gallery.

### Thai

🏢 BagIdea Office 1.0 ออกแล้ว — ทีม AI ที่อยู่บนเดสก์ท็อปคุณจริงๆ

คุณพิมพ์สั่งงานในแชท น้องๆ เดินไปที่โต๊ะแล้วลงมือทำในโฟลเดอร์จริงของคุณ จ้างได้ถึง 18 คน แต่ละคนมีนิสัย ความถนัด และสมองคนละยี่ห้อได้ — เลือกได้จาก 19 ผู้ให้บริการ หรือรัน Ollama ในเครื่องแบบไม่ต่อเน็ตเลยก็ได้

1.0 เพิ่มความสามารถใหญ่ 6 อย่าง:

🎮 เข้าไปทำงานในเอนจินเกมได้จริง
Blender / Godot / Unity / Unreal / Roblox Studio — น้องปั้นโมเดล จัดไฟ เรนเดอร์ · เปิดซีนรันแล้วอ่าน debug output กลับมา · แก้สคริปต์แล้ว playtest ต่อได้ทันที ไม่ใช่แค่เขียนไฟล์ทิ้งไว้แล้วหวังว่าจะถูก

📦 เลือกได้ว่าจะให้ไปรันที่ไหน
เครื่องคุณ / กล่องปิด Docker / หรือเครื่องอื่นผ่าน SSH ตั้งได้ทั้งออฟฟิศหรือรายคน ในคอนเทนเนอร์น้องเห็นแค่โฟลเดอร์งาน นอกนั้นเหมือนไม่มีอยู่จริง

👻 แตกร่างทำงานขนานโดยไม่เขียนทับกัน
ร่างผีแต่ละตัวได้ checkout ของ git เป็นของตัวเอง งานกลับมาเป็น branch ให้คุณ review — โฟลเดอร์จริงของคุณไม่ถูกแตะเลย

🔎 ค้นความจำด้วย "ความหมาย" ไม่ใช่แค่คำ
ถามว่า "ทำไมวอลเปเปอร์หาย" แล้วโน้ตเก่าที่เขียนว่า "WorkerW teardown kills the embedded world" จะขึ้นมาให้ — ทั้งที่ไม่มีคำไหนตรงกันเลยสักคำ

📚 ทักษะที่แก้ตัวเองได้
เมื่อก่อนน้องเขียนทักษะใหม่เก่งแต่ไม่เคยกลับไปแก้ของเก่า ตอนนี้พองานล้ม มันจะทบทวนว่าคำสั่งในทักษะนั้นผิดตรงไหนแล้วเขียนใหม่ (ของเก่าเก็บไว้ ย้อนกลับได้ · ของที่คุณเขียนเองมันไม่แตะ)

🎨 ห้องทำสื่อในตัว
สร้างภาพ → สั่งแก้ภาพเดิม → ทำเป็นวิดีโอ ในหน้าต่างเดียว แก้แล้วไม่ทับต้นฉบับ สั่งต่อเนื่องได้เรื่อยๆ (ภาพประกอบโพสนี้ทำจากในโปรแกรม)

ของใหม่ทุกอย่างปิดไว้เป็นค่าเริ่มต้น — อัปเดตแล้วไม่ตั้งอะไร = ใช้งานเหมือนเดิมทุกประการ

ฟรี MIT 👉 github.com/bagidea/bagidea-office

### English

🏢 BagIdea Office 1.0 is out — an AI team that actually lives on your desktop.

You type an order in chat; they walk to their desks and do it in your real folders. Hire up to 18, each with their own persona, expertise and their own brand of brain — 19 providers to choose from, or Ollama locally with no internet at all.

Six big new abilities in 1.0:

🎮 They work inside the game engines now
Blender / Godot / Unity / Unreal / Roblox Studio. Model, light and render. Run a scene and read the debug output back. Edit a script and play-test it. Not writing files and hoping.

📦 Choose where a run happens
This machine, a throwaway Docker container, or another machine over SSH. Set it office-wide or per agent. In a container an agent sees the working directory and nothing else on your disk exists.

👻 Parallel clones stop overwriting each other
Each gets its own git checkout, and their work comes back as branches for you to review. Your own working copy is never touched.

🔎 Recall by meaning, not just words
Ask "why did the wallpaper vanish" and a note reading "WorkerW teardown kills the embedded world" comes back, despite sharing no meaningful word with the question.

📚 Skills that correct themselves
It was good at writing new ones and never fixed an old one. Now when a job fails, it works out which instruction misled it and rewrites it. Previous version kept; anything you wrote yourself is left alone.

🎨 A media room
Make a picture, change that picture, animate it, in one window. An edit never overwrites its input, so you keep refining. The images here were made in it.

All of it off until you turn it on. Update and change nothing, and it behaves exactly as before.

Free, MIT 👉 github.com/bagidea/bagidea-office

---

## 3 · X — thread of six

Post 1 → image ① · Post 2 → image ② · Post 6 → image ③

### 1/

BagIdea Office 1.0 is out.

An AI team that lives on your desktop as a pixel office and works in your real folders. Hire up to 18. Each one gets its own persona, skills and brain — 19 model providers, or Ollama locally with no internet.

Six new abilities in 1.0. 🧵

### 2/

🎮 They work inside the engines now.

Blender · Godot · Unity · Unreal · Roblox Studio

Model and render. Run a scene and read the debug output back. Edit a script, then play-test it.

An agent can finally SEE why the game broke instead of guessing from the source.

### 3/

📦 Pick where a run happens: this machine, a throwaway Docker container, or another box over SSH — office-wide or per agent.

In a container the agent sees the working directory and nothing else on your disk exists.

### 4/

👻 Parallel clones each get their own git checkout, so two of them editing one file both succeed. Work comes back as branches to review; your working copy is never touched.

🔎 Memory now searches by meaning. Ask "why did the wallpaper vanish" and get back a note about WorkerW teardown — zero shared words.

### 5/

📚 Skills correct themselves.

It was always good at writing new ones and never went back to fix a bad one. Now a failed job triggers the review — the strongest evidence an instruction is wrong.

Old version kept. Anything you wrote by hand, it won't touch.

### 6/

🎨 And a media room: make a picture, change that picture, animate it — one window, and an edit never overwrites its input.

The images in this thread were made in it.

All of it off by default. Free, MIT:
github.com/bagidea/bagidea-office

### Single post (if you'd rather not thread)

BagIdea Office 1.0 — an AI team that lives on your desktop and works in your real folders.

New: agents work inside Blender, Godot, Unity, Unreal and Roblox · runs in a Docker container or on another machine · parallel clones stop overwriting each other · memory recalls by meaning · skills fix themselves after a failure · built-in media room.

Free, MIT 👇
github.com/bagidea/bagidea-office

---

## 4 · YouTube community post

Attach image ①.

### Thai

🏢 BagIdea Office 1.0 — ทีม AI บนเดสก์ท็อปคุณ จ้างได้ 18 คน แต่ละคนเลือกสมองเองได้จาก 19 เจ้า (หรือรันในเครื่องแบบไม่ต่อเน็ต)

ใหม่ในเวอร์ชันนี้:
🎮 เข้าไปทำงานใน Blender / Godot / Unity / Unreal / Roblox ได้จริง — เรนเดอร์ รันซีน อ่าน debug แล้วแก้ต่อ
📦 เลือกได้ว่าจะรันบนเครื่องคุณ ในกล่อง Docker หรือเครื่องอื่นผ่าน SSH
👻 แตกร่างขนานแล้วไม่เขียนทับกัน งานกลับมาเป็น branch ให้ review
🔎 ค้นความจำด้วยความหมาย ไม่ใช่แค่คำที่ตรงกัน
📚 ทักษะแก้ตัวเองได้เมื่องานล้ม
🎨 ห้องทำภาพ/วิดีโอในตัว — สร้าง แก้ แล้วทำให้ขยับ

ทุกอย่างปิดไว้ก่อน · ฟรี MIT 👉 github.com/bagidea/bagidea-office

💬 อยากดูคลิปตัวไหนก่อนครับ — น้องปั้นโมเดลใน Blender หรือไล่บั๊กเกม Godot?

### English

🏢 BagIdea Office 1.0 — an AI team on your desktop. Hire up to 18, each picking its own brain from 19 providers (or running locally with no internet).

New in this version:
🎮 They work inside Blender / Godot / Unity / Unreal / Roblox — render, run a scene, read the debug output, fix it
📦 Choose where a run happens: your machine, a Docker container, or another box over SSH
👻 Parallel clones stop overwriting each other — work comes back as branches
🔎 Memory searches by meaning, not just matching words
📚 Skills correct themselves when a job fails
🎨 A built-in media room — make a picture, change it, animate it

All off by default · Free, MIT 👉 github.com/bagidea/bagidea-office

💬 Which should I demo first — an agent modelling in Blender, or debugging a Godot game?

---

## 5 · Optional add-on blocks

Drop any of these into a post, or leave them out. They are extra, not needed.

### The tool shelf

🧰 ชั้นเครื่องมือรื้อใหม่ทั้งหมด — 43 ตัว เช็คคำสั่งกับ registry จริงทุกตัว เพิ่ม Chrome DevTools, Context7 (ดึงเอกสารรุ่นปัจจุบันของไลบรารีที่กำลังเขียน), Exa, Firecrawl, Figma, ElevenLabs · ต่อ MCP ที่เขาโฮสต์ให้ด้วยการวาง URL ได้แล้ว

🧰 The tool shelf was rebuilt — 43 tools, every command verified against the live registries. New: Chrome DevTools, Context7 (pulls the current docs for whatever library you're coding against), Exa, Firecrawl, Figma, ElevenLabs. A hosted MCP server can now be added by pasting its URL.

### The audit story — good engagement on X and dev communities

ตอนรื้อพบว่า 7 ปุ่มในชั้นเครื่องมือเดิมกดแล้วพังมาตลอด — npm เลิกดูแล reference server ไปหลายตัว และมีหนึ่งตัวที่ไม่เคยมีอยู่บน npm เลย แต่นั่งหลังปุ่ม "ติดตั้งคลิกเดียว"

Auditing our own tool shelf found seven dead buttons. npm had deprecated six reference servers, and the seventh pointed at a package that never existed on npm at all. It 404s. It sat behind a one-click install button.

### Where the roadmap came from

เราเลือกว่าจะทำอะไรโดยไปดูของจริงว่า OpenClaw, Hermes Agent, thClaws, ARRA Oracle ไปถึงไหนแล้ว เทียบกับของที่เรามี — ส่วนใหญ่เราทำไปแล้ว เหลือ 5 ข้อที่ทำไม่ได้จริงๆ และ 1.0 ปิดครบทั้ง 5

We picked what to build by auditing where the other open-source agent projects have actually got to — OpenClaw, Hermes Agent, thClaws, ARRA Oracle — against what we already had. Most of the list we'd shipped months ago. Five gaps were real, and 1.0 closes all five.

### The ghost story — the most-shared line in testing

รอบทดสอบแรก ghost สองตัวเขียนทับกัน ทั้งที่นั่งอยู่คนละ worktree ที่ดีสมบูรณ์ เพราะหัวหน้าเขียนโจทย์แบบที่ใครก็เขียน — "ในโฟลเดอร์ C:\work\game ให้แก้ shared.txt" พอได้ path เต็มมา น้องก็เดินออกจากบ้านตัวเองกลับไปหาพี่น้องทันที

The first real run still had two clones overwrite each other — from inside two perfectly good private checkouts. The parent had written the job the way anyone would: "in C:\work\game, edit shared.txt". Hand an agent an absolute path and it uses it.

---

## Notes

- Every number above is checked against the source: `MAX_STAFF = 18`,
  19 entries in `providers.js`, 16 in `SKILL_LIBRARY`, 6 channels in
  `channels.js`, 14 languages in `web/assets/i18n.js`, 28 MCP + 15 built-in
  tools in `web/tools.json`.
- The video part of the Media Studio is wired and unit-tested but has not been
  run against a real Veo generation, because a clip bills a couple of dollars.
  The posts above deliberately say "animate it" without claiming a demo.
- The images live next to this file. The Photoshop source and the earlier
  AI-generated posters are deliberately **not** committed — a 36 MB .psd does
  not belong in git history, and the generated posters were replaced by real
  screenshots because a post about software is more convincing showing the
  software.
- The long-form article link above is a private Claude artifact: it opens for
  the owner, not for the public.
