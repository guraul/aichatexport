# AI Chat Export — 提案

> 提取 AI 对话记录，导入 LLM Wiki 知识库

## 1. 背景

### 1.1 动机

日常使用网页版 AI Chat（如 chatglm.cn、ChatGPT、Claude 等）进行查询、讨论、头脑风暴，产生了大量有价值的对话内容。这些内容目前散落在各个平台的对话历史中，无法被知识库复用。

已有 LLM Wiki Skill 可以将资料导入 Obsidian vault，但缺少从 AI Chat 页面提取聊天记录的环节。

### 1.2 现状调研

#### 现有方案：AiMsgExport

GitHub 上已有项目 [AiMsgExport](https://github.com/QingJ01/AiMsgExport)，是一个 Tampermonkey 油猴脚本，支持 11 个 AI 平台导出为 Markdown/PDF/PNG/TXT。

**安全性审查结论**（逐行审查 2169 行代码）：

| 审查项 | 结果 |
|--------|------|
| 向外发送聊天数据 | ❌ 无任何 fetch/XMLHttpRequest 调用 |
| 读取 cookie/token/密码 | ❌ 0 处读取敏感信息 |
| 上传数据到第三方 | ❌ 仅 Blob 本地下载 |
| 请求危险 GM 权限 | ❌ 仅 `GM_addStyle`（加 CSS） |
| CDN 库 | ✅ html2canvas/jspdf/turndown，标准客户端库 |

结论：**安全性可靠，无数据泄露风险**。

**局限性**：不支持 chatglm.cn（智谱清言）。

### 1.3 需求

需要一个 Tampermonkey 脚本，在 chatglm.cn 页面添加"导出到 Wiki"功能，提取聊天记录并保存到本地 `raw/inbox/` 目录，然后通过 LLM Wiki Skill 导入知识库。

## 2. 方案设计

### 2.1 整体架构

```
用户浏览 chatglm.cn
      │
      ▼
Tampermonkey 脚本注入
      │
      ├── 读取 DOM 提取聊天消息
      ├── 按 user/assistant 角色整理
      ├── 生成 Markdown 文件
      └── 保存到本地 raw/inbox/
              │
              ▼
用户说"导入 raw/inbox" → LLM Wiki Skill 处理 → 入库
```

### 2.2 核心功能

| 功能 | 说明 |
|------|------|
| 从 DOM 提取对话 | 读取 chatglm.cn 页面上的聊天消息 |
| 识别角色 | 区分用户(user)和AI(assistant)消息 |
| 生成 Markdown | 以标准格式输出，含 frontmatter |
| 保存到本地 | 通过 Blob 下载到 `raw/inbox/` |
| 一键触发 | 页面右下角"导出到 Wiki"按钮 |

### 2.3 技术方案

**平台**：Tampermonkey 油猴脚本（兼容 Safari + Chrome + Firefox）

**数据获取方式**：DOM 提取（非 API 拦截）
- 优点：无需处理鉴权，不受 API 变动影响
- 缺点：依赖页面 DOM 结构

**备用方案**：API 拦截（参考 GLM-Free-API 项目）
- 通过 `chatglm_refresh_token` cookie 调用官方 API
- 可获取更完整的对话数据结构

### 2.4 导出格式

```markdown
---
title: 对话主题
source: chatglm.cn
date: 2026-07-07
tags:
  - ai-chat
  - chatglm
---

# User

用户的问题内容

# Assistant

AI 的回复内容

---

# User

下一个问题

# Assistant

AI 的回复
```

### 2.5 与 LLM Wiki 的集成

脚本导出到 `raw/inbox/` 后，用户在 opencode/WorkBuddy 中说：

> "导入 raw/inbox 中所有文件到 wiki"

LLM Wiki Skill 自动执行：
1. 创建来源摘要页 → `wiki/sources/`
2. 提取概念/实体 → `wiki/concepts/` 和 `wiki/entities/`
3. 更新 index.md 和 log.md
4. 移动文件到 `raw/processed/`

## 3. 项目计划

### Phase 1：基础脚本（v0.1）
- [ ] chatglm.cn DOM 结构分析
- [ ] 消息提取逻辑（user/assistant 识别）
- [ ] Markdown 生成
- [ ] 下载按钮 UI

### Phase 2：增强功能（v0.2）
- [ ] 多平台支持（ChatGPT、Claude、DeepSeek 等）
- [ ] 对话标题自动提取
- [ ] 代码块格式保留
- [ ] 图片/附件处理

### Phase 3：全流程自动化（v0.3）
- [ ] 直接写入本地文件系统（通过本地 HTTP server）
- [ ] 自动触发 LLM Wiki 导入
- [ ] 批量导出历史对话

## 4. 安全设计

| 原则 | 说明 |
|------|------|
| 本地优先 | 所有处理在浏览器内完成，数据不离开本地 |
| 最小权限 | 仅请求必要的 Tampermonkey 权限 |
| 无外部依赖 | 除标准库外，不加载第三方 SDK |
| 开源透明 | 代码完全公开，可审查 |

## 5. 参考项目

- [AiMsgExport](https://github.com/QingJ01/AiMsgExport) — 多平台 AI 对话导出脚本
- [GLM-Free-API](https://github.com/xiaoY233/GLM-Free-API) — ChatGLM API 逆向分析
- [chat-export-toolkit](https://github.com/gandli/chat-export-toolkit) — 可扩展的导出工具包
- [guraul/llm-wiki](https://github.com/guraul/llm-wiki) — LLM Wiki Skill
