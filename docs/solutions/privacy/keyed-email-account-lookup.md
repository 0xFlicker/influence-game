---
module: Authentication
problem_type: architecture_pattern
tags: [privacy, email, account-support, migration]
---

# Keep exact account matching with keyed email hashes

Provider subject bindings and verified email ownership serve different
purposes. Keep verified claims keyed by the normalized address digest and use
the dedicated server-side key for exact comparisons. Preserve legacy address
digests for support discovery. Leave legacy metadata out of the authentication
decision. Ambiguous matches stay blocked.

Hash and verify existing rows before dropping the old fields. Rewrite the
affected relations in the same stopped-writer migration transaction. Keep
the key check in the migration schema so fixture resets and restricted
render-proof database checks still operate on application tables.

An operator lookup resolves a public account ID. The separate deletion request
checks that ID, the current profile confirmation, and the operator's current
role. Keep the entered email out of URLs, responses, deletion records, and
logs. See the [signup and cutover runbook](../../authentication/signup-admission.md).
