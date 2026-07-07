# AI Chat Export — Agent Guide

## State

Pre-code phase. Only docs exist (README.md, PROPOSAL.md). Single commit.

## Project

Tampermonkey userscript (`*.user.js`) that extracts AI chat conversations to Markdown for LLM Wiki import. No build tooling, no package manager, no tests yet.

## Architecture

- Plain ES5/ES6 browser JavaScript running as a userscript
- DOM extraction (not API interception) — reads chat messages from page DOM
- Output: Markdown files with YAML frontmatter, saved via Blob download
- No external server or data egress

## Targets

| Priority | Platform | Status |
|----------|----------|--------|
| P0 | chatglm.cn | Not started |
| P1 | ChatGPT, Claude, DeepSeek | Not started |

## Key conventions (from PROPOSAL.md)

- Export format: Markdown with frontmatter (`title`, `source`, `date`, `tags: [ai-chat, <platform>]`)
- Roles rendered as `# User` / `# Assistant` headings
- Files saved locally to `raw/inbox/` (downstream LLM Wiki Skill picks them up)
- Tampermonkey permissions: request only `GM_addStyle` (pattern after AiMsgExport)

## Integration

Works with external LLM Wiki Skill (not in this repo). The downstream command is: "导入 raw/inbox 中所有文件到 wiki"
