---
kind: upgrade-guide
description: "OpenRouter 用量查询使用当前 LLM 错误代码，替代 PROVIDER_ERROR。"
---

# OpenRouter 用量错误

[English](guide.md) | 中文

## 变更

FerrPOINT 的 `providerUsage('openrouter')` 扩展以代码为 `INVALID_RESPONSE` 的 `LlmError` 报告格式无效的响应。HTTP 请求失败时使用 `HTTP_<status>`，并在 `failure.status` 中保留数字状态码。此操作不再使用 `PROVIDER_ERROR` 代码。

## 迁移

1. 将匹配 `PROVIDER_ERROR` 的 `llm/providerUsage` 消费方改为区分 `INVALID_RESPONSE` 与相关的 `HTTP_<status>` 值。
2. 检查格式无效的响应和 HTTP 401 响应的处理。成功用量快照的字段不变；已保存的 Session 日志无需更改。
