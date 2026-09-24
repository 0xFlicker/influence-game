"use client";

import { useId } from "react";
import styles from "./character-formation.module.css";

const silhouette = "M200 92c-27 0-42 21-42 49 0 24 10 43 23 51v20c-12 12-39 16-56 30-25 22-34 66-37 112h224c-3-46-12-90-37-112-17-14-44-18-56-30v-20c13-8 23-27 23-51 0-28-15-49-42-49Z";

/** Indeterminate formation, never a claim about provider progress or final anatomy. */
export function CharacterFormation({ name }: { name: string }) {
  const id = useId();
  return <div className={styles.scene} role="status" aria-label="Creating character image">
    <div className={styles.art} aria-hidden="true">
      <div className={styles.aura} />
      <svg viewBox="0 0 400 420" className={styles.figure} fill="none">
        <defs>
          <linearGradient id={`${id}-body`} x1="150" y1="90" x2="245" y2="360" gradientUnits="userSpaceOnUse"><stop stopColor="#e9dfff" stopOpacity=".32"/><stop offset=".5" stopColor="#b79aec" stopOpacity=".13"/><stop offset="1" stopColor="#aa86e3" stopOpacity="0"/></linearGradient>
          <linearGradient id={`${id}-edge`} x1="160" y1="90" x2="240" y2="354" gradientUnits="userSpaceOnUse"><stop stopColor="#f4ecff" stopOpacity=".85"/><stop offset=".65" stopColor="#b79aec" stopOpacity=".35"/><stop offset="1" stopColor="#b79aec" stopOpacity="0"/></linearGradient>
          <linearGradient id={`${id}-scan`} x2="0" y2="1"><stop stopColor="#e8daff" stopOpacity="0"/><stop offset=".9" stopColor="#e8daff" stopOpacity=".16"/><stop offset="1" stopColor="#fff5ff" stopOpacity=".8"/></linearGradient>
          <clipPath id={`${id}-shape`}><path d={silhouette}/></clipPath>
        </defs>
        <ellipse className={styles.orbit} cx="200" cy="226" rx="156" ry="156" stroke="#c8aff2" strokeOpacity=".13" strokeDasharray="2 12" />
        <path d="M52 180v-24h24m248 0h24v24M52 284v24h24m248 0h24v-24" stroke="#c8aff2" strokeOpacity=".25" />
        <ellipse className={styles.floor} cx="200" cy="365" rx="104" ry="16" stroke="#d6c2ff" strokeOpacity=".35"/>
        <ellipse className={styles.ripple} cx="200" cy="365" rx="104" ry="16" stroke="#d6c2ff" strokeOpacity=".3"/>
        <g className={styles.body}>
          <path d={silhouette} fill={`url(#${id}-body)`} stroke={`url(#${id}-edge)`} strokeWidth="1.5"/>
          <g clipPath={`url(#${id}-shape)`}>
            <g className={styles.scan}><rect x="80" y="110" width="240" height="100" fill={`url(#${id}-scan)`}/><path d="M80 210h240" stroke="#f5edff" strokeOpacity=".55"/></g>
            <path d="M110 260h180m-185 18h190m-190 18h190m-200 18h210m-210 18h210" stroke="#e2cdff" strokeOpacity=".08"/>
          </g>
        </g>
        <g className={styles.sparks} fill="#eadbff">
          {[ [106,330], [284,320], [132,300], [258,350], [72,290], [324,310], [155,355], [238,320] ].map(([cx, cy], index) => <circle key={index} cx={cx} cy={cy} r={index % 3 === 0 ? 2 : 1.2} />)}
        </g>
        <path className={styles.core} d="M200 224v22m-11-11h22" stroke="#f5edff" strokeWidth="1.5"/>
      </svg>
    </div>
    <div className={styles.caption}><p className={styles.eyebrow}>Taking shape</p><h2>{name ? `Bringing ${name} to life` : "Bringing your character to life"}</h2><p className={styles.detail}>Your character image is being created.</p></div>
  </div>;
}
