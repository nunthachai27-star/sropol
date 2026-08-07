# Clinical chatbot on self-hosted GLM-5.2 (cost-gated, TDD)

**Date:** 2026-08-03 · **Approved scope:** Phase 0..3 (staged; each gated)
**Codex consultations:** 3 rounds (architecture · GLM-5.2/cost delta · gap sweep) — gpt-5.5/xhigh.
**Model:** `glm-5.2` served by SGLang at `https://sglang-glm.bmscloud.in.th/v1` (OpenAI-compatible, 512k ctx). NOT MedGemma.

## Why this exists

Clinicians (nurses/doctors at KK-province hospitals) need natural-language access to the
patient/risk data KK-LRMS already holds, answered by an on-prem LLM in Thai. Self-hosting
"relaxes" only the external-egress PDPA risk — minimization, access control, audit, and log
safety still apply in full. GLM-5.2 has compute cost, so the feature is **opt-in via .env and
default-OFF**.

## Verified constraints (probed, not assumed)

1. `GET /v1/models` → `{"id":"glm-5.2","max_model_len":524288}`. Endpoint reachable, no auth key needed (probe succeeded without Bearer).
2. **GLM-5.2 is a reasoning model.** SSE chunks carry `delta.reasoning_content` SEPARATE from `delta.content`. With thinking ON and a tight `max_tokens`, all output lands in `reasoning_content` and `message.content` is EMPTY.
3. Existing `src/lib/llm-client.ts` reads ONLY `choices[0].message.content` and throws "empty content" → would break for GLM-5.2 under thinking-ON. It is SHARED with dev-simulation — changes must be backward-compatible.
4. SGLang GLM-5.2 supports disabling thinking: `extra_body.chat_template_kwargs.enable_thinking=false` (docs.sglang.io GLM-5.2 cookbook). `reasoning_effort:"high"` only reduces effort, not a cheap low mode.
5. kk-lrms already has the feature-flag pattern: `MOPH_ALERTS_ENABLED` in `.env.example` + config module `src/config/moph-alert-config.ts`. Chatbot copies the pattern but **default-OFF**.

## Design decisions

1. **Inference = direct GLM-5.2 via extended `llm-client.ts`.** No pi-engine for now (talkmateai-pi-engine
   container: no verified HTTP/tool/RAG/memory API surface on :8000 — probes to /, /docs,
   /openapi.json, /health, /v1/models all refused from this namespace; docker inspect blocked by
   socket permission). Revisit ONLY if pi.dev exposes documented, authenticated OpenAPI.
2. **Thinking disabled for production chat** (`enable_thinking:false`) + hard `maxTokens` cap. This is the
   #1 cost lever (reasoning tokens are billed and can eat the entire budget). Reasoning surfaced
   separately ONLY as a diagnostic field via `llmChatDetailed()` — never auto-fallback empty content→reasoning
   (that would leak hidden reasoning and break `llmJson`).
3. **Backward-compatible llm-client extension.** Keep `llmChat()` (string content only — dev-simulation
   unaffected). Add `llmChatDetailed()` → `{ content, reasoningContent, finishReason, usage }`, plus
   `extraBody?` and `baseUrl?` options so the chatbot targets GLM without moving dev-simulation's
   vLLM defaults (`LLM_BASE_URL`/`LLM_DEFAULT_MODEL` env remain authoritative for existing callers).
4. **Cost gate = `CLINICAL_CHAT_ENABLED` default `"false"`.** `src/config/clinical-chat-config.ts`
   exports `clinicalChatEnabled()`. Gate BOTH the UI and every `/api/chat/*` route. Disabled route
   returns `503 { error: "ปิดใช้งานผู้ช่วยแชททางคลินิก" }` and NEVER calls the LLM (no fetch). The
   strictly-inverted default vs MOPH_ALERTS_ENABLED is intentional: alerts are safety-mandated,
   chatbot is a cost-incurring convenience.
5. **Chat route** `src/app/api/chat/route.ts` (Phase 0, non-stream POST) → `api/chat/stream/route.ts`
   (Phase 3) using a route-local `ReadableStream` + `text/event-stream`. NOT `SseManager` (that is
   process-global fanout/per-user signaling, wrong transport for 1:1 token streaming). Business logic
   lives in `src/services/chat/*` (constitution: logic out of routes).
6. **RAG = direct SQL retrieval first, pgvector only as Phase 1B.** Repo has rich structured tables and
   no pgvector extension; adding vector search = Postgres image change + migration + embedding pipeline
   before the chatbot can answer anything. Phase 1 `context-builder.ts` assembles allow-listed clinical
   context from `maternal_journeys`, `cached_patients`, `cached_anc_visits`, `cached_referrals`,
   partograph observations, `moph_alert_log`. BGE-M3 (:18099) + pgvector deferred to 1B ("find similar
   cases" semantics).
7. **Prompts are config, not literals.** `src/services/chat/prompt-config.ts` — versioned template,
   override-able (constitution: no hardcoded conditions for LLM prompts). System prompt plus per-call
   injection of the redacted context block.
8. **PDPA allow/deny lists.** MAY reach LLM: age, GA, gravida/para, risk levels, CPD factors,
   vitals/labs, partograph values, referral status/urgency/reason AFTER redaction, timestamps, source
   IDs, pseudonymous case labels ("Case A") + local citations. NEVER reach LLM: raw name, raw CID,
   ciphertext, `cid_hash`, BMS tokens/JWTs, ProviderID CID, recipient CIDs, free-text notes before
   scrubbing. Display names stay UI-side via `maskName`/`maskNameStrict`.

## Phases (TDD — test first, red→green each task)

### Phase 0 — env gate + GLM smoke
Files: `.env.example`, `src/config/clinical-chat-config.ts`, `src/lib/llm-client.ts`,
`src/services/chat/glm-client.ts`, `src/app/api/chat/route.ts`.
First test: `tests/unit/api/clinical-chat-gate.test.ts` — (a) flag unset or `false` → 503 with Thai
message and `fetch` NOT called; (b) enabled smoke mocks GLM response and asserts the outbound request
body includes `chat_template_kwargs.enable_thinking:false`.
Risk: GLM-5.2 Thai quality/latency; reasoning still leaking cost if thinking-off param is misnamed.

### Phase 1 — RAG + PDPA redaction
Files: `src/services/chat/context-builder.ts`, `pii-redactor.ts`, `prompt-config.ts`,
`session-memory.ts` (Redis TTL via `cache.ts`), `chat-service.ts`, `api/chat/stream/route.ts`,
`components/chat/ClinicalChatPanel.tsx`.
First test: seeded patient context proves NO name/CID/hash reaches the prompt (allow-list enforced).
Risk: free-text referral/partogram notes leaking identifiers (the #1 production risk).

### Phase 2 — tool/function calling
Files: `src/services/chat/tools.ts`, `tool-router.ts`; optional MCP adapters (knowledge-mcp
`search_knowledge`, `icd11_lookup` — no PHI in tool queries).
First test: cross-hospital query denied; tool args PHI-free.
Risk: model-selected tools hallucinate scope (requesting another hospital's patient).

### Phase 3 — multi-turn memory + UI polish
Files: `components/chat/*`, Redis memory helpers, per-user rate limiting (cost lever #2).
First test: memory expires and stores masked transcript only.
Risk: SGLang concurrency stalls despite streaming; unbounded transcript growing context.

## Highest-risk item (fix before optimizing retrieval quality)
**PDPA leakage through RAG assembly or LLM error logging** — especially free-text clinical fields.
The prompt must never contain a patient name/CID, and logs must never log the raw prompt body.

## Open / operator items
- pi-engine (`talkmateai-pi-engine`) — revisit when it exposes documented, authenticated OpenAPI.
- Phase 1B pgvector + BGE-M3 — only after direct-SQL RAG proves value (not required for v1).
- Live smoke against real GLM endpoint + a real seeded patient before enabling in production.
