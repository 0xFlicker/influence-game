---
module: Watch presentation
tags: [playback, polling, waiting-room]
problem_type: ui_bug
---

# Waiting-room connection badge flicker

The live format viewer polled presentation every second with `preserveScreen`
based on whether any replay frames existed. Before the first closed phase, a
successful presentation response legitimately contains zero frames. Each poll
therefore set hydration to loading, then ready, alternating Connecting and Live.

Background presentation refreshes must preserve the current screen even when
its prefix is empty. Initial hydration still owns initial loading; request
failures still advance the existing reconnect/unavailable policy.

Production diagnosis for `neat-black-orb`: the public presentation endpoint
returned `in_progress`, `throughSequence: 0`, zero frames and zero messages.
This establishes the empty-prefix trigger, not a failure of the game runner.
