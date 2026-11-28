import {formatPresentationMetadata, type LaunchFormatId} from "@influence/engine/format-presentation-metadata";
import {formatWalkthroughTimeline} from "./format-walkthrough-shots";
import styles from "./format-walkthrough.module.css";

export function FormatWalkthrough({formatId, elapsedMs, controlsInset}: {formatId:LaunchFormatId; elapsedMs:number; controlsInset:number}) {
  const timeline = formatWalkthroughTimeline(formatId);
  const active = timeline.findIndex(({endMs}) => elapsedMs < endMs);
  const index = active === -1 ? timeline.length - 1 : active;
  const {shot} = timeline[index]!;
  return (
    <section className={styles.stage} style={{paddingBottom: controlsInset}} data-format-cue="format_selected"
      data-format-walkthrough={formatId} data-walkthrough-shot={index} aria-label={`${formatPresentationMetadata(formatId).displayName} example`}>
      <div className={styles.content}>
        <header>
          <p className={styles.kicker}>{formatPresentationMetadata(formatId).displayName} · Example</p>
          <h2>{shot.title}</h2>
        </header>
        <div className={styles.picture} data-walkthrough-picture>
          <ul className={`${styles.board} ${shot.chain ? styles.chain : ""}`} data-walkthrough-cast={shot.tiles.length > 3 ? "large" : "small"}>
            {shot.tiles.map((tile, position) => (
              <li className={styles.tile} data-walkthrough-tone={tile.tone} data-walkthrough-pointer={shot.pointer === position || undefined}
                data-walkthrough-count={tile.value !== undefined || undefined} key={tile.name}>
                <strong>{tile.name}</strong>
                {tile.value !== undefined && <span className={styles.value}>{tile.value}</span>}
                {formatId === "even_votes" && typeof tile.value === "number" && <span className={styles.ballots} aria-hidden="true">
                  {Array.from({length: Math.floor(tile.value / 2)}, (_, pair) => <span className={styles.pair} key={pair}><i /><i /></span>)}
                  {tile.value % 2 === 1 && <i />}
                </span>}
                {tile.label === "Vulnerable"
                  ? <span className={`${styles.label} ${styles.hyphenatedLabel}`}>{"Vulner\u00adable"}</span>
                  : tile.label && <span className={styles.label}>{tile.label}</span>}
                {shot.chain && position <= (shot.pointer ?? -1) && <span className={styles.arrow} aria-hidden="true">→</span>}
              </li>
            ))}
          </ul>
          {shot.roles && <div className={styles.roles}>{shot.roles.map(role => <p key={role}>{role}</p>)}</div>}
        </div>
        <p className={styles.note} data-walkthrough-note>{shot.note}</p>
      </div>
    </section>
  );
}
