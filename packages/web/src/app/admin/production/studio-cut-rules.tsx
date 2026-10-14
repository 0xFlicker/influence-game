"use client";
import {PRODUCTION_LABELS, THINKING_LABELS, SPEECH_LABELS, type ProductionKindPolicy, type ProductionMomentKind, type ProductionRecipe} from "@influence/engine/production-moments";
import {StudioSelect} from "./studio-select";
import styles from "./workspace.module.css";

export const initialRecipe = (thinking: boolean): ProductionRecipe => ({mode: "recipe", thinking, base: "full", policies: {thinking: thinking ? {mode: "any", labels: ["smart", "fourth_wall"]} : {mode: "none"}, speech: {mode: "all"}}});
export function recipeSummary(recipe: ProductionRecipe): string {
  const summary = (["speech", "thinking"] as const).filter(kind => kind !== "thinking" || recipe.thinking).map(kind => {
    const policy = recipe.policies[kind];
    const content = kind === "speech" ? "speech" : "thinking";
    if (!policy) return `${recipe.base === "full" ? "Episode" : "No"} ${content}`;
    return policy.mode === "all" ? `All ${content}` : policy.mode === "none" || !policy.labels.length ? `No ${content}` : `${policy.labels.map(label => PRODUCTION_LABELS[label]).join(" or ")} ${content}`;
  });
  summary.push(recipe.base === "full" ? "Normal gameplay" : "No default gameplay");
  for (const kind of ["opening", "result"] as const) summary.push(`${recipe.policies[kind]?.mode === "all" || !recipe.policies[kind] && recipe.base === "full" ? "With" : "Without"} ${kind}`);
  for (const [kind, policy] of Object.entries(recipe.policies)) {
    if (["speech", "thinking", "opening", "result"].includes(kind) || !policy) continue;
    summary.push(policy.mode === "all" ? `All ${kind}` : policy.mode === "none" || !policy.labels.length ? `No ${kind}` : `${policy.labels.map(label => PRODUCTION_LABELS[label]).join(" or ")} ${kind}`);
  }
  return summary.join(" · ");
}

/** Finite per-kind choices; all membership is resolved by the shared selector. */
export function StudioCutRules({recipe, onChange, kinds}: {recipe: ProductionRecipe; onChange: (next: ProductionRecipe) => void; kinds: readonly ProductionMomentKind[]}) {
  function policy(kind: ProductionMomentKind, next: ProductionKindPolicy | undefined) {
    const policies = {...recipe.policies};
    if (next) policies[kind] = next; else delete policies[kind];
    onChange({...recipe, policies});
  }
  return <>
    <p className={styles.dialogIntro}>Choose which content to keep. Matching labels keeps any checked label within that type; thinking and speech match independently.</p>
    {(["thinking", "speech"] as const).map(kind => {
      const current = recipe.policies[kind], mode = current?.mode ?? (recipe.base === "full" ? "all" : "none");
      return <fieldset key={kind} className={styles.ruleGroup}>
        <legend>{kind === "thinking" ? "Thinking" : "Speech"}</legend>
        {kind === "thinking" && !recipe.thinking ? <p className={styles.dialogIntro}>Thinking is unavailable in Mystery. Use Omniscient to edit private thoughts.</p> : <>
          <StudioSelect label={`${kind === "thinking" ? "Thinking" : "Speech"} inclusion`} value={mode} onChange={value => policy(kind, value === "any" ? {mode: "any", labels: []} : {mode: value as "all" | "none"})} options={[{value: "all", label: "All"}, {value: "none", label: "None"}, {value: "any", label: "Matching labels"}]} />
          {current?.mode === "any" && <div className={styles.editorialLabels}>{(kind === "thinking" ? THINKING_LABELS : SPEECH_LABELS).map(label => <label key={label}><input aria-label={`Keep ${kind} marked ${PRODUCTION_LABELS[label]}`} type="checkbox" checked={current.labels.includes(label)} onChange={event => policy(kind, {mode: "any", labels: event.target.checked ? [...current.labels, label] : current.labels.filter(value => value !== label)})} />{PRODUCTION_LABELS[label]}</label>)}</div>}
        </>}
      </fieldset>;
    })}
    <label className={styles.check}><input aria-label="Include normal gameplay" type="checkbox" checked={recipe.base === "full"} onChange={event => onChange({...recipe, base: event.target.checked ? "full" : "empty"})} />Include normal gameplay</label>
    <p className={styles.dialogIntro}>Includes the current audience’s normal scenes, actions, ballots and outcomes. Type choices above override this baseline.</p>
    <div className={styles.checks}>{(["opening", "result"] as const).map(kind => <label key={kind} className={styles.check}><input type="checkbox" aria-label={kind === "opening" ? "Add episode opening" : "Add game result"} disabled={!kinds.includes(kind)} checked={recipe.policies[kind]?.mode === "all" || !recipe.policies[kind] && recipe.base === "full"} onChange={event => policy(kind, {mode: event.target.checked ? "all" : "none"})} />{kind === "opening" ? "Add episode opening" : "Add game result"}</label>)}</div>
    <details><summary>Other game moments</summary><div className={styles.settingsGrid}>{kinds.filter(kind => !["thinking", "speech", "opening", "result"].includes(kind)).map(kind => <StudioSelect key={kind} label={`${kind[0]!.toUpperCase()}${kind.slice(1)} inclusion`} value={recipe.policies[kind]?.mode ?? "default"} onChange={value => policy(kind, value === "default" ? undefined : {mode: value as "all" | "none"})} options={[{value: "default", label: recipe.base === "full" ? "Episode default" : "None by default"}, {value: "all", label: "All"}, {value: "none", label: "None"}]} />)}</div></details>
  </>;
}
