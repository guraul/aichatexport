# ChatGLM 对话导出 — 技术方案

> 基于 Playwright Skill 架构，提取 chatglm.cn 对话到 Markdown（LLM Wiki 导入格式）

## 1. 架构变更

**最初提案**（PROPOSAL.md）采用 Tampermonkey 油猴脚本，DOM 提取，浏览器内运行。

**实际验证后**改用 Playwright Skill（Node.js 无头浏览器），原因：

| 维度 | Tampermonkey | Playwright Skill |
|------|-------------|-----------------|
| 登录 | 依赖浏览器已有 session | 通过 WeChat QR 扫码自动登录 |
| 数据提取 | 只能 DOM 提取（依赖页面结构） | 可拦截 API 响应（结构化数据） |
| 批量导出 | 用户手动翻页点开每条对话 | 脚本自动遍历列表 + 每条对话 |
| WAF 绕过 | 浏览器本身已有 session 绕过 | 需模拟 SPA 点击绕过（直接 URL 访问触发滑块） |
| 导出路径 | Blob 下载（浏览器沙箱限制） | 直接写入本地文件系统 |

## 2. 登录方案

| 步骤 | 实现 |
|------|------|
| 1. 启动无头 Chromium | `headless: true`, `--no-sandbox` |
| 2. 打开 chatglm.cn | 检测到未登录，出现 `.login-btn` |
| 3. 点击 `.login-btn` | 弹出 WeChat QR 码（canvas 元素） |
| 4. 解码 QR | screenshot QR 区域 → `zbarimg` 解码 → `qrencode -t ANSIUTF8` 终端显示 |
| 5. 用户扫码 | 投票等待 `.login-btn` 消失或 cookie `chatglm_token` 出现 |
| 6. 保存 session | Playwright `context.storageState()` → `~/.config/chatglm_session.json` |
| 关键发现 | QR canvas 实际编码的是 `open.weixin.qq.com/connect/confirm?uuid=...`（非 `connect/qrconnect?appid=...`） |

## 3. WAF 反爬

### 3.1 现象

| 方式 | 结果 |
|------|------|
| 直接 `page.goto("...alltoolsdetail?cid=...")` | ❌ 返回 214 字节滑块验证页面 "Access Verification — Please slide to verify" |
| 主页点击 `.history-item` SPA 导航 | ✅ 成功加载对话内容，URL 变为 `...?t=...&cid=...&lang=zh` |

### 3.2 绕过方案

必须从主页进入后，**点击**对话条目触发 SPA 路由跳转。不能直接访问对话 URL。

### 3.3 额外注意

- 部分 headless Chromium 内核可能在点击后崩溃（与对话大小无关，小对话也发生过）
- 需要 `--disable-dev-shm-usage --disable-gpu` 等参数降低 crash 概率
- 也可能需要 `--single-process --no-zygote` 等稳定参数

## 4. API 逆向

### 4.1 对话列表

```
POST /chatglm/mainchat-api/conversation/recent_list
Headers: 无特殊签名，靠 cookie 鉴权
Response:
{
  "status": 0,
  "result": {
    "has_more": true,
    "conversation_list": [
      {
        "conversation_id": "6a46690614b6262ea5d33c37",
        "assistant_id": "65940acff94777010aa6b796",
        "title": "Node.js项目结构解析",
        "history_total": 135,
        "update_time": 1784195197
      }
    ]
  }
}
```

### 4.2 对话消息

```
GET /chatglm/mainchat-api/conversation/messages?assistant_id=...&conversation_id=...
Headers: 需要签名（见 4.3）
Response:
{
  "status": 0,
  "result": {
    "conversation_id": "...",
    "messages": [
      {
        "id": "...",
        "input": {
          "content": [{ "type": "text", "text": "用户消息" }],
          "role": "user"
        },
        "output": {
          "role": "assistant",
          "parts": [
            {
              "content": [{ "type": "think", "text": "思考过程" }],
              "role": "assistant"
            },
            {
              "content": [{ "type": "text", "text": "最终回复" }]
            }
          ]
        }
      }
    ]
  }
}
```

消息类型一览：
- `think` — 思考过程
- `text` — 最终文本回复
- `tool_calls` — 工具调用
- `tool_result` — 工具结果
- `code` — 代码块

### 4.3 签名算法

从 `main.55e2c594.js`（6MB）提取的请求签名逻辑：

```js
// 生成 timestamp: Date.now() 字符串 + 校验位
let t = Date.now().toString();
let digitSum = t.split('').map(Number).reduce((a, b) => a + b, 0);
let lastDigit = Number(t[t.length - 1]);
let checkDigit = (digitSum - lastDigit) % 10;
let timestamp = t.substring(0, t.length - 2) + checkDigit + t.substring(t.length - 1, t.length);

// 生成 nonce: UUID v4 去横线
let nonce = crypto.randomUUID().replace(/-/g, '');

// 生成 sign: MD5(timestamp + "-" + nonce + "-8a1317a7468aa3ad86e997d08f3f31cb")
let sign = md5(`${timestamp}-${nonce}-8a1317a7468aa3ad86e997d08f3f31cb`);
```

**盐值（固定）**: `8a1317a7468aa3ad86e997d08f3f31cb`

## 5. 数据提取方案

### 5.1 推荐方案：API 拦截

利用 Playwright 拦截 `messages` API 响应（不走签名，让页面自身发起请求）：

```
1. page.goto("https://chatglm.cn/")       ← 主页
2. 等待 recent_list 响应                   ← 获取全部对话元数据
3. for each conversation:
   a. page.click(".history-item")          ← 触发 SPA 导航（绕过 WAF）
   b. 等待 messages API 响应被 capture      ← 拦截结构化数据
   c. 解析 input.content / output.parts    ← 提取消息
   d. 生成 Markdown 写本地文件
```

### 5.2 备用方案：纯 API（需复现签名）

如果点击路径不稳定（页面 crash），可复现签名算法直接用 Node.js 请求 `messages` API：

```
1. 从 cookie 获取 chatglm_token 作为 Authorization Bearer
2. 生成 x-timestamp, x-nonce, x-sign
3. 直接 GET messages API
4. 解析响应数据
```

## 6. 消息 → Markdown 格式

```markdown
---
title: 对话标题
source: chatglm.cn
date: 2026-07-16
tags:
  - ai-chat
  - chatglm
---

# User

用户消息文本

# Assistant

AI 回复文本（过滤掉 think/tool_calls/tool_result，只保留 text 类型的最终回复）

---

# User

...
```

## 7. 核心问题清单

| # | 问题 | 状态 | 说明 |
|---|------|------|------|
| 1 | WAF 阻止直接 URL 访问 | ✅ 已绕过 | 主页点击 SPA 导航可绕过 |
| 2 | 页面点击后有时 crash | ⚠️ 偶发 | 需增加稳定性参数，或走纯 API 方案 |
| 3 | 签名算法已提取 | ✅ 已验证 | `md5(timestamp + "-" + nonce + salt)` |
| 4 | 对话消息结构已明确 | ✅ 已验证 | `input.content[]`, `output.parts[].content[]` |
| 5 | 对话列表 API | ✅ 已验证 | `recent_list` 返回 id/title/history_total |
| 6 | 登录 session 持久化 | ✅ 已验证 | `storageState` 保存到 `~/.config/chatglm_session.json` |
| 7 | Token 刷新 | ⚠️ 未测试 | `chatglm_refresh_token` → `access_token` 路径未验证 |
| 8 | 分页加载更多对话 | ❌ 未验证 | `has_more: true` 需要分页参数 |
| 9 | 工具调用/图片/附件处理 | ❌ 未验证 | 消息结构中有 `tool_calls`/`tool_result` 类型 |

## 8. 实施计划

### Phase 1：核心导出脚本
- [ ] 实现 API 拦截型 Playwright 导出脚本（遍历列表 → 点击 → 拦截 → 写文件）
- [ ] 处理 `think`/`tool_calls`/`tool_result` 类型过滤
- [ ] Markdown 生成 + 文件写入 `raw/inbox/`

### Phase 2：稳定性加固
- [ ] 纯 API 方案（复现签名，无浏览器依赖）
- [ ] 登录 token 自动刷新
- [ ] 对话分页加载（`has_more` → 翻页）

### Phase 3：多平台扩展
- [ ] ChatGPT, Claude, DeepSeek 等
- [ ] 统一调度框架

## 9. 参考

- [GLM-Free-API](https://github.com/xiaoY233/GLM-Free-API) — ChatGLM API 逆向（协助发现 `refresh_token` 和 `stream` 端点）
- [AiMsgExport](https://github.com/QingJ01/AiMsgExport) — 多平台 DOM 提取模式参考
- [Superpowers Brainstorming Skill](../skills/aichatexport-brainstorming.md) — 本项目初始设计文档
- [AGENTS.md](./AGENTS.md) — 项目 Agent 指南
