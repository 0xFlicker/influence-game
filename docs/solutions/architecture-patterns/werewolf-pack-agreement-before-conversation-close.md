---
title: Separate Werewolf pack agreement from conversation closure
date: 2026-11-10
module: Werewolf
problem_type: architecture_pattern
component: rules, provider contracts, observations, replay
severity: medium
tags: [werewolf, pack, strategy, versioning, recovery, presentation]
---

# Separate pack agreement from conversation closure

The v9–v12 reducer ended the pack phase as soon as two targets matched, and the
prompt explicitly told wolves this. Coaching alone could not leave time for
shared next-day planning. Individual thinking never reaches a partner either.

V13 records agreement in reducer state at the accepted proposal prefix. It freezes
the original explicit agreement ballots and target, then offers remaining slots
with a singleton target enum plus optional speech. This reuses one structured
decision and one durable provider slot per opportunity. It adds neither a target
ballot nor a House-authored strategy summary. The exact decoder validates locked
targets inside the attempt boundary; rejected output cannot consume a turn.

Agreement does not reset either wolf's three-turn cap. The voluntary pass streak
starts after the locking decision. Pre-agreement silence cannot end talk early;
failed provider slots reset the voluntary streak and cannot erase the lock. Only
closure emits the single pack resolution, with separate agreement and closure
coordinates. Historical v7–v12 events, requests and observation hashes remain
unchanged. Waiting lobbies retain the version captured at creation.

The current night's accepted pack proposals already survive through that day's
wolf priority, discussion and ballot contexts. Test these actual invocations;
do not place coordination only in private thinking or broaden village/Mystery
observations. The next night's existing proposal reset stays unchanged.

Default catalog selections matter when proving parity: the complete binding
inventory also contains optional individual ballot views. Encoding every bound
segment would add choices the viewer's normal sequence omits. Compare the default
selection, then independently test strategy speech, thought-only and closure-only
cuts with omitted neighbors. See the [v13 proof workflow](../../presentation-parity.md#werewolf-v13-pack-strategy-proof)
and [implementation plan](../../plans/2026-11-10-001-feat-werewolf-v13-pack-day-planning.md).

Long frozen names exposed clipped pack labels in fresh proof. Wrap cast names and
measure the speaker's natural label width before tightening a short speech bubble.
Do not derive label height from an already tightened bubble and feed that height
back into fitting: the two measurements can oscillate. Reuse the existing compact
room for short two-person geometry; retain the circular room when it fits.

Proof adapters must pass canonical previous/next cues for full sequences and
provide an actual viewer-room reference for isolated thoughts. Sample thought pages
after their establishment offset. For short recorded pages, round their midpoint
to the nearest frame instead of flooring into the preceding page. A frame's DOM
audit must wait for stage and child pagination to commit, not report the initial
zero-width layout. Retain page coverage and per-frame audit data alongside images.
