"use client";

import type React from "react";
import { HOME_AGENTS, type HomeAgent } from "./home-data";

function initials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

function agentStyle(agent: HomeAgent) {
  return {
    "--home-agent-rgb": `var(${agent.colorVar})`,
  } as React.CSSProperties;
}

export function AgentStrip() {
  return (
    <div className="influence-panel rounded-[28px] px-4 py-4 sm:px-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="influence-section-title">Agents On Air</p>
          <p className="influence-copy mt-1 text-sm">
            A live board of alliances, pressure, and exits.
          </p>
        </div>
        <div className="hidden rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.26em] text-text-secondary sm:block">
          Round 08
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {HOME_AGENTS.map((agent) => (
          <div
            key={agent.id}
            className="home-agent-card rounded-[22px] px-3 py-3"
            data-status={agent.status}
            style={agentStyle(agent)}
          >
            <div className="flex items-center gap-3">
              <div className="home-agent-avatar">
                <span>{initials(agent.name)}</span>
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-text-primary">
                  {agent.name}
                </p>
                <p className="truncate text-[11px] uppercase tracking-[0.18em] text-text-secondary/80">
                  {agent.archetype}
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="home-agent-status text-[11px] font-semibold uppercase tracking-[0.2em]">
                {agent.status === "spotlight"
                  ? "Live"
                  : agent.status === "eliminated"
                    ? "Out"
                    : "Active"}
              </span>
              <span className="text-right text-[11px] text-text-secondary/75">
                {agent.readout}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
