# 👥 Team templates — a whole team in one click

*New in v1.5.0.*

Hiring agents one at a time is fine for a hobby. Someone installing the
office on a customer's machine, or starting a real project on day one, needs a
**team**: names, roles, personas, skills, voices, all chosen to work together.

⚙ → AGENTS → **👥 HIRE A TEAM**, or `bagidea hire --team <id>`.

| template | agents | built for |
|---|---|---|
| 💻 **dev-shop** | Mira (tech lead) · Theo (backend) · Lina (frontend) · Ravi (QA) | shipping software; pairs with GitHub Triage and Codex |
| 🔬 **research-lab** | Noor (researcher) · Kenji (analyst) · Ada (writer) | finding out what is true and writing it down |
| 🎬 **content-studio** | Sol (strategist) · June (copywriter) · Pax (designer) · Omar (community) | the Campaign Board and the Content Pipeline |
| 🎧 **customer-support** | Hana (lead) · Ben · Aiko · Ivo (knowledge base) | the Inbox Agent, with approvals in front of every send |
| 🧑‍💼 **solo-assistant** | Sam (assistant) · Vera (bookkeeper) | one busy person's calendar, inbox, research, money |

**What hiring does.** Each agent is created with its persona (expertise,
personality, rules), job title, avatar, aura, voice and builtin skills, on the
office's default brain (Claude). An agent whose id already exists is **never
overwritten** — hiring a team twice is safe. The hire cap still applies; the
result says who was hired and who was skipped. Everything can be edited
afterwards in the agent editor, like any other agent.

**Where the templates live.** `daemon/teams/<id>.json`. A template is plain
data — copy one, change the names and personas, and it appears in the picker.
The shape:

```json
{ "id": "my-team", "name": "🏗 My team", "tagline": "…", "for": "…",
  "agents": [{ "id": "lead", "name": "…", "role": "Engineer", "tier": 2, "avatar": 3, "aura": "gold", "voice": "clear",
               "persona": { "expertise": "…", "personality": "…", "rules": "…" },
               "skills": ["project-kickoff", "code-review"], "tools": [] }] }
```

Roles: Director · Founder · Researcher · Engineer · Designer · Analyst ·
Operator · Specialist. Avatars 1–12. Voices: boyish, clear, genki, sweet,
warm, gentle, cool, deep, lively.

## From the terminal

```
bagidea teams                  # the templates, and who is already in the office
bagidea hire --team dev-shop
```

## The API

```
GET  /teams            { teams: [{ id, name, tagline, for, agents: [{ id, name, role, present }] }], staff, max }
POST /teams/hire       { id }  → { hired: [...], skipped: [{ id, why }], staff, max }     human UI only
```
