# BagIdea Office — Extensibility Design: Tools, Skills, Plugins, Workflows & Hubs

> สถานะ: **ร่างเพื่อเคาะทิศทาง** (2026-06) — ตอบคำถาม #120, #124, #125, #126, #127
> อ่านคู่กับโค้ดจริง: `daemon/constants.js` (BUILTIN_TOOLS, SKILL_LIBRARY), `daemon/skills.js`,
> `daemon/plugins.js`, `daemon/server.js` (`runClaude` → `--allowedTools` / `--add-dir` / `--mcp-config`).

เอกสารนี้อธิบาย "ตอนนี้มันทำงานยังไง" ก่อน แล้วค่อยเสนอ "ควรต่อยอดไปทางไหน" ทุกส่วนจบด้วย
**คำถามที่ต้องเคาะ** เพื่อให้เริ่มสร้างได้ถูกทาง

---

## 0. ภาพรวม 4 ชั้นของการต่อยอด (mental model)

```
TOOLS      = สิ่งที่ "มือ" ของ agent ทำได้จริง (อ่าน/เขียนไฟล์, รันคำสั่ง, ค้นเว็บ, เรียก MCP)
   ▲          → มาจาก Claude Code โดยตรง + MCP servers. เพิ่มชนิดใหม่ = ต่อ MCP
SKILLS     = "วิธีคิด/ขั้นตอน" ที่สอน agent ให้ทำงานชนิดหนึ่งได้ดี (ข้อความ SKILL.md)
   ▲          → เนื้อหาเป็นของเรา, ส่งผ่านกลไก native ของ Claude (--add-dir). ใช้ tools ด้านล่าง
PLUGINS    = "อวัยวะใหม่" ของออฟฟิศ (panel UI, HTTP route, command) — โค้ดจริงที่รันใน daemon
   ▲          → ติดตั้งจาก GitHub. ขยายตัวโปรแกรม ไม่ใช่แค่ตัว agent
WORKFLOWS  = "แผนงานภาษามนุษย์" ที่ร้อย skills/tools/agents เข้าด้วยกันเป็นลำดับ (สิ่งที่จะสร้างใหม่)
              → ผู้ใช้ลากวาง node + พิมพ์สั่ง, agent วิเคราะห์แล้วลงมือ/แนะนำ
```

แต่ละชั้น "ใช้" ชั้นที่อยู่ต่ำกว่า: workflow เรียก skills, skill ใช้ tools, plugin เปิด tools/route ใหม่
ให้ทั้งระบบ **Hub** = ที่รวมให้ค้น/แชร์/ติดตั้งของแต่ละชั้น

---

## 1. TOOLS — #120, ส่วนหนึ่งของ #127

### ตอนนี้เป็นยังไง (ข้อเท็จจริง)
- `BUILTIN_TOOLS` ใน `constants.js` = **11 เครื่องมือของ Claude Code** ที่เราเปิดให้เลือก:
  `Read, Glob, Grep, Edit, Write, Bash, WebSearch, WebFetch, Task, TodoWrite, NotebookEdit`
- เวลา spawn agent: `runClaude` เอา tools ที่ agent ได้รับมาต่อเป็น `--allowedTools Read,Bash,...`
  - tool ที่ "ได้รับ" = รันเงียบๆ; tool ที่ **ไม่ได้รับ** = เด้งการ์ดขออนุญาตที่ Security Center
- **MCP** = ช่องทางเพิ่ม tool ชนิดใหม่จริงๆ: `reg.mcpServers[name] = {command}` → กลายเป็น
  `--mcp-config` + อนุญาต `mcp__<name>`. เช่นต่อ MCP ของ GitHub/Postgres/Slack → agent ได้ tool ใหม่ทันที

### สรุปสิ่งที่ผมอยากให้คุณเข้าใจ (ตอบ "tools เพิ่มได้ไหม")
> **"Tool" คือความสามารถระดับล่างสุดที่ Claude เรียกได้จริง — เราไม่ได้ "เขียน tool เอง"
> แต่ (ก) เปิด/ปิด tool ที่ Claude Code มีอยู่, และ (ข) เพิ่มชนิดใหม่ผ่าน MCP server.**
> ถ้าอยากได้ความสามารถใหม่ที่ Claude ไม่มี (เช่น "ส่ง LINE", "query ฐานข้อมูลบริษัท") →
> ต่อ MCP server ตัวนั้น แล้วมันโผล่เป็น tool ให้ agent เลือกใช้

### ข้อเสนอ #120 — เปิด Claude tools ให้ครบ
Claude Code มี tool มากกว่า 11 ตัวที่เราลิสต์ ตัวที่ควรเพิ่มเข้า `BUILTIN_TOOLS` (ปลอดภัย + มีประโยชน์):
| Tool | ทำอะไร | เปิดให้ใคร |
|---|---|---|
| `Skill` | ให้ agent "เรียกใช้" skill ที่มีได้เอง (จำเป็นถ้าจะใช้ native skills เต็มที่) | ทุกคน |
| `BashOutput` / `KillShell` | จัดการ background process ที่ตัวเองสั่งรัน | คนที่มี Bash |
| `SlashCommand` | เรียก slash-command ที่ติดตั้งไว้ | เลือก |
| `WebFetch`/`WebSearch` | (มีแล้ว) | — |
- ทำเป็น **catalog** มี label ไทย + ระดับความเสี่ยง (อ่านอย่างเดียว / แก้ไข / รันโค้ด / เครือข่าย)
  เพื่อให้หน้า UI โชว์ว่าอันไหน "ปลอดภัย" อันไหน "ต้องระวัง"
- MCP servers ที่ติดตั้งไว้ ก็โชว์รวมในแคตตาล็อกเดียวกัน (มาจาก `reg.mcpServers`)

---

## 2. SKILLS — #125

### ตอนนี้เป็นยังไง (ข้อเท็จจริง — ตอบ "ไปดึงของ Claude มาเลยไหม")
**ไม่ได้ดึงเนื้อหาจาก Claude — แต่ใช้ "กลไก" ของ Claude ส่งเนื้อหา "ของเรา":**
1. `SKILL_LIBRARY` (constants.js) = **15 skill ที่เราเขียนเอง** (deep-research, code-review, office-ops,
   plugin-builder, archive-search, file-media-toolkit, schedule-via-office-job, ฯลฯ) — เนื้อหา (`content`) เป็นข้อความที่เราแต่ง
2. `daemon/skills.js` `syncSkillFiles()` เขียนแต่ละ skill ที่ agent ได้รับ ลงเป็นไฟล์จริง:
   `workspace/agents/<id>/.claude/skills/<id>/SKILL.md` (frontmatter `name`/`description` + body)
3. `runClaude` ส่ง `--add-dir workspace/agents/<id>` → **Claude Code ค้นเจอ SKILL.md เองตามกลไก
   native (progressive disclosure):** ในพรอมต์มีแค่ `description` บรรทัดเดียว; เนื้อหาเต็มถูกโหลด
   "ตอนที่ agent ตัดสินใจใช้ skill นั้น" เท่านั้น → ประหยัด token มหาศาล (นี่คือหัวใจของ Hermes refactor)
4. นอกจาก builtin ยังมี **skill ที่ออฟฟิศเรียนรู้เอง** (`maybeLearnSkill`) จากงานจริง → เก็บแบบเดียวกัน

```
เนื้อหา skill (ของเรา)  ──เขียนเป็น──►  SKILL.md  ──--add-dir──►  Claude Code ค้น+โหลดตอนใช้
       SKILL_LIBRARY                    (รูปแบบมาตรฐานของ Claude)        (กลไก native)
```

### ความสัมพันธ์กับ "Claude core skills"
- Claude Code เองก็มี skill ของมัน (ในตัว harness) — **คนละชุดกับของเรา** ไม่ทับกัน
- เราเลือกใช้ **รูปแบบ + กลไกเดียวกัน** (SKILL.md + --add-dir) → ได้ของฟรี: progressive disclosure,
  ใช้ได้แม้ session ถูก resume, ไม่ต้อง inline body. นี่ถูกทางแล้ว ✅ (flag `reg.nativeSkills`)

### ข้อเสนอต่อยอด skills
- **ผู้ใช้/agent สร้าง skill เองได้จาก UI** (ตอนนี้มี learn อัตโนมัติ + แก้ผ่าน API) → หน้า "Skills"
  ให้พิมพ์ name/description/ขั้นตอน แล้ว save เป็น SKILL.md ทันที
- **skill มี metadata เพิ่ม**: tools ที่ skill นี้แนะนำให้เปิด, ตัวอย่างการใช้, ภาษา → ใช้ใน Hub + workflow

---

## 3. PLUGINS & PLUGIN HUB — #124

### ตอนนี้
- plugin = โฟลเดอร์ + `plugin.json` (id, name, description, panel?, commands[], window) + `index.js`
  (`(ctx) => ({onCommand, routes})`) + `panel.html`. ติดตั้งจาก GitHub repo ใดก็ได้ (`bagidea plugin install <url>`)
- มี 3 repo ตัวอย่างบน GitHub (template, calculator, music)

### ข้อเสนอ: Plugin Hub
- **ทางที่แนะนำ (เริ่มเบา ไม่ต้องมี backend):** `hub registry` = ไฟล์ JSON เดียว (เหมือน `sponsors.json`)
  เก็บรายชื่อ plugin ที่ผ่านการคัดเลือก (`{id, name, desc, repo, author, tags, verified}`) host บน
  GitHub Pages → ในแอปมีหน้า **"Browse Hub"** ดึง JSON มาโชว์ + ปุ่มติดตั้ง (เรียก `plugin install <repo>`)
- **ความปลอดภัย (สำคัญมาก):** plugin = โค้ดที่รันในเครื่องผู้ใช้ → ต้องมี **เครื่องหมาย "verified"**
  (เราตรวจแล้ว) แยกจาก "community" (ติดตั้งเองเสี่ยงเอง + เตือนชัด). อย่าให้ใครpushเข้า hub ได้อิสระ
  (supply-chain risk — ตรงกับกฎที่เราตั้งไว้แล้วเรื่อง community write access)
- **โตทีหลัง:** submit ผ่าน PR เข้า repo ของ hub registry → เรา review → merge = ขึ้น hub
- โครงนี้ใช้ซ้ำได้กับ Skills Hub / Workflow Hub (ดูข้อ 5)

---

## 4. WORKFLOW BUILDER — #126 (ฟีเจอร์เด่น)

### เป้าหมาย (จากที่คุณเล่า)
ผู้ใช้ที่ "ไม่รู้จะสั่งยังไง" ลากวาง **node ภาษามนุษย์** เป็นแผนงาน เช่น
"เมื่อ workflow นี้รัน → ดึงข้อมูล X → สรุป → ส่งเข้า Telegram" แล้ว **agent วิเคราะห์แผน** เองว่า
ต้องใช้ skill/tool ไหน, ต้องขอ permission อะไร, หรือควรจ้าง agent เพิ่ม แล้วลงมือทำ / แนะนำผู้ใช้

### สถาปัตยกรรมที่เสนอ (ไม่เป๊ะเป็น n8n แต่ "เข้าใจง่าย + ปล่อยให้ agent คิด")
```
WORKFLOW = { nodes:[ {id, type, text, x, y}, ... ], edges:[ {from, to}, ... ] }
node.type:  trigger  | action | fetch | decision | output | note
node.text:  ภาษามนุษย์ล้วน เช่น "สรุปข่าว AI วันนี้แล้วส่งเข้า Telegram ตอน 9 โมง"
```
1. **Canvas (overlay/หน้าต่างใหม่):** ลากวาง node, ต่อเส้น, ดับเบิลคลิกพิมพ์คำสั่งภาษามนุษย์
   (ใช้ scrollbar/ธีมเดิม; pop-out เป็นหน้าต่างได้เหมือน plugin)
2. **"Analyze" (ปุ่ม):** ส่ง workflow JSON ให้ Director วิเคราะห์ (skill ใหม่ `workflow-architect`) →
   ได้ผลเป็น **แผนการรันที่อ่านได้** + รายการสิ่งที่ขาด:
   - skills ที่ต้องใช้ / ที่ยังไม่มี (เสนอสร้าง)
   - tools/permission ที่ต้องเปิด (เสนอให้ allow)
   - agent ที่ควรมอบหมาย / ควรจ้างเพิ่ม (พร้อมหน้าที่)
   - ช่องโหว่/คำถามที่ผู้ใช้ต้องตอบ
3. **ผู้ใช้กด "Approve"** → ระบบ:
   - (ทางA) **compile เป็น skill เดียว** (`workflow:<name>` SKILL.md ที่ฝังลำดับขั้น) ให้ agent รันซ้ำได้ — *แนะนำเป็นจุดเริ่ม*
   - (ทางB) **compile เป็น job/schedule** (ใช้ระบบ Office Ops jobs ที่มีอยู่) ถ้ามี trigger เวลา
   - (ทางC) รันทันทีครั้งเดียวผ่าน DELEGATE chain ปกติ
4. **เก็บ workflow** เป็นไฟล์ (`workspace/workflows/<id>.json`) → แก้/รันซ้ำ/แชร์ขึ้น Hub ได้

> จุดต่างจาก n8n: เราไม่บังคับให้ผู้ใช้ต่อ logic เป๊ะ — **node เป็นเจตนา, agent เป็นคนเติมรายละเอียด
> + ตัดสินใจ** นี่คือจุดขาย: "วางแผนหยาบๆ แล้วให้ทีม AI คิดต่อ"

### เฟสการสร้าง
- **P1 (MVP):** canvas node + edges + พิมพ์ข้อความ + ปุ่ม Analyze (Director สรุปแผน + สิ่งที่ขาด) → ยังไม่ auto-run
- **P2:** Approve → compile เป็น skill/job + รันจริง + รายงานผลในแชท
- **P3:** agent เสนอจ้าง/permission อัตโนมัติ + Workflow Hub

---

## 5. HUBS รวม (Skills / Workflow / Tools / Plugin) — #127

**ข้อเสนอ: ทำเป็น "BagIdea Hub" เดียว มีหลายหมวด** แทนที่จะแยก 4 ระบบ — ลดงาน, ผู้ใช้เรียนรู้ที่เดียว
```
BagIdea Hub  (ดึงจาก hub registry JSON บน GitHub Pages — pattern เดียวกับ sponsors.json)
 ├─ 🧩 Plugins    (repo ติดตั้งได้, verified/community)
 ├─ 🧠 Skills     (SKILL.md สำเร็จรูป import เข้า SKILL_LIBRARY ของตัวเอง)
 ├─ 🔧 Tools/MCP  (MCP server สำเร็จรูป + คำสั่งต่อ — "อยากได้ความสามารถ X ต่ออันนี้")
 └─ 🔀 Workflows  (workflow JSON สำเร็จรูป import มาแก้ต่อ)
```
- **Tools/MCP hub** ช่วยตอบโจทย์ "tool เพิ่มได้ไหม" โดยตรง: ผู้ใช้เห็นรายการ MCP ยอดนิยม
  (GitHub, Postgres, Slack, filesystem ...) กดเพื่อรับคำสั่งต่อ + คำเตือนความปลอดภัย
- ทั้งหมดเป็น **read-only registry** ก่อน (ปลอดภัย) — การ submit เข้า hub = PR → review → merge

---

## ❓ สิ่งที่อยากให้คุณเคาะ ก่อนเริ่มสร้าง
1. **Workflow Builder เริ่มที่ P1 (canvas + Analyze เป็นแผน) ก่อนเลยไหม** — หรืออยากเห็น mock UI ก่อน?
2. **Hub = รวมศูนย์ "BagIdea Hub" เดียว 4 หมวด** ตามที่เสนอ ใช่ไหม? (vs แยกเป็น 4 hub)
3. **Hub registry = ไฟล์ JSON บน GitHub Pages + verified/community + submit ผ่าน PR** โอเคไหม?
4. **#120 tools:** ให้ผมเพิ่ม `Skill`/`BashOutput`/`KillShell`/`SlashCommand` เข้า catalog + ทำหน้าที่โชว์
   ระดับความเสี่ยง — เริ่มเท่านี้ก่อนพอไหม?
