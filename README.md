# AI Chat Export

提取 AI 对话记录并导入 LLM Wiki 知识库。

## 问题

日常在 chatglm.cn 等 AI Chat 平台上的讨论和 idea 交流，内容有价值但散落在各平台对话历史中，无法被知识库复用。

## 方案

Tampermonkey 油猴脚本，在 AI Chat 页面添加"导出到 Wiki"按钮：

```
浏览 AI Chat 页面 → 点击导出 → 生成 Markdown → 保存到 raw/inbox/ → LLM Wiki 导入
```

## 路线

- **Phase 1**: chatglm.cn 支持
- **Phase 2**: 多平台扩展
- **Phase 3**: 全流程自动化

详见 [PROPOSAL.md](PROPOSAL.md)。
