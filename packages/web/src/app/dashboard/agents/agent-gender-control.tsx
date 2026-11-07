"use client";

import { useId } from "react";
import { AGENT_GENDER_OPTIONS, type AgentGender } from "@/lib/api";
import styles from "./agent-workspace.module.css";

export function AgentGenderControl({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: AgentGender) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <fieldset className={styles.genderControl} disabled={disabled}>
      <legend>Gender</legend>
      <div>
        {AGENT_GENDER_OPTIONS.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name={id}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
