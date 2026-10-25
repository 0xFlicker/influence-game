---
title: Honor recipient selection when redirecting an Influence conversation
date: 2026-10-24
module: Influence conversations
problem_type: logic_error
component: open-conversation scheduler
tags: [influence, lobby, mingle, huddles, scheduling]
---

The first-round Lobby in `mad-peach-north` repeatedly addressed Kimi before she received a turn. The scheduler excluded the preceding speaker after three directed handoffs but also discarded valid selections of other participants. A three-person test missed this because the selected participant also happened to be next in the fair queue.

Count handoffs within the current pair. A → B → A → B excludes only A from B's next recipient choices; selecting C schedules C and starts a new pair. Passes and group addresses return to fair scheduling. Keep recipient validation and prompt guidance aligned; never derive recipients from speech.

Regression coverage must include four participants, with the chosen recipient different from the next fair-queue participant, plus chains through different participants and repeated exchanges within the new pair. Existing accepted dialogue remains unchanged.
