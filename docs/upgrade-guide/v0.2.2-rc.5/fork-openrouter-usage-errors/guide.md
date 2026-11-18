---
kind: upgrade-guide
description: "OpenRouter usage failures use current LLM error codes instead of PROVIDER_ERROR."
---

# OpenRouter usage errors

English | [中文](guide.zh.md)

## Change

The FerrPOINT `PiAiAdapter.providerUsage('openrouter')` method reports malformed provider responses as `LlmError` with `INVALID_RESPONSE`. An unsuccessful HTTP response uses `HTTP_<status>` and retains the numeric status in `failure.status`. The former `PROVIDER_ERROR` code is removed from this operation. The Remote endpoint retains its `llm/provider-usage-rejected` error envelope.

## Migration

1. Update direct adapter consumers that match `PROVIDER_ERROR` to distinguish `INVALID_RESPONSE` from the relevant `HTTP_<status>` values.
2. Check malformed response handling and an HTTP 401 response. Successful usage snapshots retain the same fields; saved Session logs need no changes.
