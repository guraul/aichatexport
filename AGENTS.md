# AI Chat Export — Agent Guide

## State

Production. All 221 conversations from chatglm.cn successfully exported to `~/raw/inbox/` (217 unique .md files). Single tool: `tools/export.mjs`.

## Architecture

- **Playwright** (Node.js, no build tooling, no tests) running Chromium via `/snap/bin/chromium`
- **API interception** (not DOM extraction) — Playwright listens for the page's own `/conversation/messages` HTTP response
- **Vue Router navigation** (not DOM click) — navigates directly via `router.push({ path: '/alltoolsdetail', query: { cid } })`
- Output: Markdown with YAML frontmatter, saved to `~/raw/inbox/` via `fs.writeFileSync`
- Session: `~/.config/chatglm_session.json` (Playwright `storageState`)
- Config / progress: `~/.config/chatglm-export/{config,conversations}.json`

## Key files

| File | Purpose |
|------|---------|
| `tools/export.mjs` | Main export script |
| `tools/save-auth.js` | Login helper (saves `chatglm_session.json`) |

## API details

- `GET /chatglm/mainchat-api/conversation/messages?assistant_id=X&conversation_id=Y` — loads conversation messages (takes 1–40s depending on size)
- `POST /chatglm/mainchat-api/conversation/recent_list` — paginated conversation list (scroll to load more)
- Messages endpoint requires signed headers (page handles signing, so Playwright intercepts page's own XHR)

## Output format

```markdown
---
title: <conversation title>
source: chatglm.cn
date: YYYY-MM-DD
tags:
  - ai-chat
  - chatglm
---

# User

<user text>

---

# Assistant

<assistant text>
```

## How to run

```bash
node tools/save-auth.js   # Login (one-time)
node tools/export.mjs     # Export all pending conversations
```

The downstream command for LLM Wiki import is: "导入 raw/inbox 中所有文件到 wiki"

## Key conventions

- Output filename: `safeName(title) + '.md'` (special chars → `＿`, max 100 chars)
- Same-title conversations overwrite (no hash suffix)
- Roles: `# User` / `# Assistant`
- Tags: `['ai-chat', 'chatglm']`
- Date: earliest `update_time` found in messages, or today
- Thinking/tool-call content types are skipped
