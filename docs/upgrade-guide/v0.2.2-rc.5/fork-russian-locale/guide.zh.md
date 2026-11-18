---
kind: upgrade-guide
description: "FerrPOINT profile 使用内置 ru 语言，替代部分翻译的 ru-pro 语言包。"
---

# FerrPOINT 俄语语言

[English](guide.md) | 中文

## 变更

FerrPOINT Web profile 选择上游的 `ru` 语言。部分翻译的 `ru-pro` 语言包已移除；其实例管理翻译归属于侧边栏的 `ru` 字典。明确选择 `ru-pro` 的现有 profile 必须更新语言偏好。

## 迁移

1. 停止待升级的安装。在其 `$DSH_HOME/cordis.patch.yml` 和 `$DSH_HOME/profiles/web/cordis.patch.yml` 中，若 `locale` 条目包含 `preference: ru-pro`，将其改为 `preference: ru`。
2. 将明确选择 `ru-pro` 的启动 overlay 改为选择 `ru`。
3. 重启 `dsh web`。确认“设置 → 常规”显示俄语，且“设置 → DSH 实例”显示俄语标签。Session 日志和已保存的实例地址无需更改。
