# Capability fit

Reuse a capability only when its contract remains truthful without exceptions.

## Reuse `sealed_elim`

Use the shared sealed non-polarity path when every eligible player submits one target ballot, legal targets follow an existing catalog policy, resolution differs only by tally math, and the ordinary aggregate/viewer roll call is sufficient. Prefer `$add-sealed-format` for this case.

## Create or extend a distinct capability

Use a distinct capability when any of these change:

- voters exclude role holders, finalists, or another computed set;
- legal targets are a preselected subset or depend on an earlier branch;
- actions are public before the final sealed ballot;
- the format has roles, draws, substitutions, speeches, passes, or multi-step public state;
- it runs multiple keyed social windows;
- its terminal aggregate must preserve lifecycle facts beyond ballots and totals;
- the viewer needs trusted intermediate state that ordinary ballot events cannot express.

Document why existing capabilities are insufficient. Add an exhaustive registration type and fail closed on unknown capability/event combinations.
