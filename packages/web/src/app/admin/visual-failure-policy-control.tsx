"use client";
export function VisualFailurePolicyControl({ value, disabled, onChange }: {
  value: "best_effort" | "require_visuals"; disabled: boolean;
  onChange: (value: "best_effort" | "require_visuals") => void;
}) {
  return <div className="space-y-2">
    <label className="block">Visual failure policy <select aria-label="Visual failure policy" value={value} disabled={disabled} className="mt-2 block w-full min-w-0 max-w-full rounded bg-neutral-900 p-2 sm:ml-3 sm:mt-0 sm:inline-block sm:w-auto" onChange={event => onChange(event.target.value as typeof value)}>
      <option value="best_effort">Best effort — continue with portraits</option>
      <option value="require_visuals">Require visuals — pause for repair</option>
    </select></label>
    <p className="text-sm text-white/60">Changing policy does not resume a paused game. Provider errors and costs remain available below.</p>
  </div>;
}
