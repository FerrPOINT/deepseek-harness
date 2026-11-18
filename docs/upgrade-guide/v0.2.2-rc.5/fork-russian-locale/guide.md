---
kind: upgrade-guide
description: "FerrPOINT profiles use the shipped ru locale instead of the partial ru-pro language pack."
---

# FerrPOINT Russian locale

English | [中文](guide.zh.md)

## Change

The FerrPOINT Web profile selects the upstream `ru` locale. The partial `ru-pro` language pack is removed; its instance-management and OpenRouter translations belong to their owning plugins' `ru` dictionaries. Existing profiles that explicitly select `ru-pro` must update their preference.

## Migration

1. Stop the installation being upgraded. In its `$DSH_HOME/cordis.patch.yml` and `$DSH_HOME/profiles/web/cordis.patch.yml`, replace `preference: ru-pro` with `preference: ru` under the `locale` entry, if present.
2. Update any invocation overlay that explicitly selects `ru-pro` to select `ru`.
3. Restart `dsh web`. Confirm Settings → General shows Russian and Settings → DSH instances displays Russian labels. Session logs and saved instance addresses need no changes.
