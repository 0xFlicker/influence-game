---
title: Use native JSON Schema for single-response game decisions
date: 2026-10-19
module: Model invocation
problem_type: integration_issue
component: provider adapters
severity: medium
tags: [structured-output, muse, providers, evidence, evaluation]
---

# Use native JSON Schema for single-response game decisions

## Problem

Game decisions used one function tool as an output envelope. Muse's automatic
tool choice could return prose instead of that function call, wasting a provider
attempt even though the model had made a decision. Maintaining tool-choice modes
also gave equivalent game decisions different transport and validation paths.

## Decision

Future Influence player, House, Werewolf, and retrospective calls request one
exact native JSON-schema response. OpenAI and Muse compile to Responses
`text.format`; Katana and local OpenAI-compatible servers compile to Chat
Completions `response_format`. The decision schema retains its description,
required fields, semantic decoder, and optional performance-cue rules.

There is no tool-choice mode or tool fallback. The adapter rejects tool calls,
prose, fenced or embedded JSON, missing fields, and extra fields inside the
provider-attempt boundary. Refusals and truncated output retain their own typed
failure classifications. Shared retries and phase-owned legal fallbacks remain
in force. Length repair includes the rejected response and exact allowed size.

The House's opening diary question also has an exact `{question}` contract;
whitespace-only questions are invalid. House traces use the runtime and attempt
of the accepted response, including when a fallback provider succeeds.

## Boundaries

- Preserve completed games, canonical events, accepted values, replay, Studio,
  and old raw provider evidence. Historical trace fields and semantic artifact
  identifiers containing `tool` remain identifiers, not a new tool transport.
- Deployment drains active games. This change does not promise continuity for
  games started under the previous inference contract.
- Preserve emitted thinking and available native reasoning separately, together
  with sanitized requests, responses, retries, failures, and usage. Retrospectives
  remain speech-only.
- LM Studio is best effort. No production model qualification policy is inferred
  from a local experiment, and native reasoning is never substituted for a
  missing decision.
- Actual multi-tool operations outside game inference, such as profile editing,
  retain their own tool contracts.

## Validation

Provider adapter tests assert native schema request shapes and strict decoding.
Player, Werewolf, House, and retrospective tests cover malformed responses and
bounded retries; PostgreSQL tests exercise durable acceptance and historical
production sources. Paid evaluation uses complete localhost API games and
exports hash-verified private evidence, rather than relying on console output.
