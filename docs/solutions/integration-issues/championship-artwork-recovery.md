# Preserve identity and progress during championship artwork preparation

The championship locks only after every finalist has verified headshot/body artwork. Its preparation revision retains original account/agent links and freezes live character inputs without editing the live profile.

Three failure modes need explicit handling:

- A global one-job worker allowance can let a failed event monopolize every tick. Give each event an allowance and prioritize untouched jobs, then oldest retries within the event.
- Empty visual-design strings must use the persona fallback; include recorded gender and preserve existing image pixels as reference input. Frozen character identity must survive ordinary owner edits.
- A retry after deployment must not reconstruct a different prompt at the same operation key. Hydrate the original request, verify its content hash and reference hashes, and reuse its prompt/dimensions. Recover journaled successful output before considering another provider call.

Private payloads hold image/request bodies; PostgreSQL holds ownership, leases, state and verified object references. Publish content-addressed images and read back their bytes before marking ready. A failed publication reuses the private bytes. An uncertain provider outcome retains its receipt for scoped producer reconciliation, never owner approval or a spending ceiling.

The regression suite covers original pixels reaching the stubbed provider, actual local publication/readback, unchanged profiles, linked frozen entries, interrupted accepted output, changed-template retries, pre-lock alternates and fairness between events. Actual generated character quality still requires the eventual authorized provider execution; fixture images do not prove artistic fidelity.
