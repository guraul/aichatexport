# Handover — AI Chat Export

## Project

Playwright 脚本，从 chatglm.cn 导出全部对话为 Markdown，供下游 LLM Wiki 批量导入。

## Result

221 条对话 → `raw/inbox/` 下 217 个 `.md` 文件（4 对同名标题被覆盖），0 残留。

## Problems & Solutions

| # | Problem | Solution |
|---|---------|----------|
| 1 | WAF 拦截直接访问 `alltoolsdetail?cid=xxx` | 不直接请求 URL，通过 SPA 内部导航绕过 |
| 2 | `/conversation/messages` API 需要签名 header | 不自己签名，拦截页面自身发出的 XHR 响应 |
| 3 | 对话列表在 SPA 中无限滚动加载，DOM 操作易崩溃 | 只滚动到找到目标对话即停，不加载全部 |
| 4 | 部分对话在 DOM 中找不到（滚动失效/页面退化） | 改用 Vue Router 直接导航，彻底绕过 DOM |
| 5 | Headless Chromium 频繁 OOM 崩溃 | try-catch + 重建页面/上下文/浏览器三层恢复，每 10 次导出重启一次上下文 |
| 6 | `/conversation/messages` 响应长达 30-40s | 将 waitMsg timeout 设为 120s |
| 7 | 需要 `assistant_id` 参数才能调通 messages API | 从 `recent_list` 响应中提取 `assistant_id` 字段 |
| 8 | 首次尝试 DOM extracted 不稳定、容易被前端改版破坏 | 改为 API 拦截方案，对前端 DOM 变化免疫 |

## Architecture (Final)

```
Playwright browser
  └─ API intercept (context.on('response'))
       ├─ /conversation/recent_list   → 获取全部对话列表（无限滚动）
       └─ /conversation/messages      → 获取单条对话消息
  └─ Vue Router navigation
       └─ router.push({ path: '/alltoolsdetail', query: { cid } })
```

- **Not** Tampermonkey / DOM extraction / direct fetch
- Session: Playwright `storageState` → `.chatglm-export/chatglm_session.json`
- Config & progress: `.chatglm-export/{config,conversations}.json`
- Output: `raw/inbox/<title>.md`（同名覆盖，无 hash）

## Key Files

| File | Purpose |
|------|---------|
| `tools/export.mjs` | Main export script |
| `tools/save-auth.js` | Login helper |
| `AGENTS.md` | Agent context |
| `handover.md` | This file |

## API Endpoints

| Endpoint | Method | Params | Notes |
|----------|--------|--------|-------|
| `/chatglm/mainchat-api/conversation/recent_list` | POST | `{page, page_size}` | 分页获取列表，`has_more` 标志翻页 |
| `/chatglm/mainchat-api/conversation/messages` | GET | `assistant_id`, `conversation_id` | 响应 1-40s，页面内调用自带签名 |

## Known Issues

- `--single-process` 在某些环境反而增加崩溃概率
- 2 条对话 timeout x3（超大消息量，90s+ 仍未响应）
- Output filename: 特殊字符替换为 `＿`，表情符号可能丢失

## Next Steps

- 对其它平台（ChatGPT, Claude, DeepSeek）重复此方案
- 或增加增量导出（只导上次 run 后有更新的对话）
