# Championship correction migration release review

0150 remains byte-identical to the SQL already applied locally. SHA-256: `10a282ea8c91ca8ac2c78be5e27f9f1a8e5b72fc41ba1000a3a11de2ee99e47b`.

The policy rejection is legitimate: replacing uniqueness constraints and requiring a new field is not generally compatible with older writers. This release introduces all championship tables together. Published main `1d7e357b4b6404cf8b1b938e8bb27d54ec0cbe67` has no championship readers/writers. Rolling back to that main leaves the tables and evidence intact but removes championship functionality. Never run an intermediate pre-0150 championship development build against this schema: it omits required game references and assumes the old keys.

The exact-file exception covers only drop-constraint and set-not-null. Changed SQL or a renamed file fails review again. No generic release safeguard is relaxed.

Existing results retain points, gain revision zero and the match's canonical game reference. A missing game fails the transactional migration rather than inventing evidence. Results become unique per match/entry/revision; award allocations become unique per event/phase/generation. Prior rows remain. Existing grant allocation references are recovered from grant audit entries without changing those entries.

The PostgreSQL fixture executes unchanged migration SQL against populated pre-migration tables, verifies historical values and attribution, inserts new corrections, rejects duplicate revisions/generations, and verifies rollback for a result lacking a game. Policy tests reject altered/renamed SQL. Normal championship service tests verify current-revision selection and correction idempotency.

Retain normal immutable migration-set/release-manifest checks. No down migration, data reset or local server restart is part of this change.
