import styles from "./workspace.module.css";
import {STUDIO_SHORTCUTS} from "./studio-shortcuts";

/** The dispatcher and visible controls use these same finite bindings. */
export function StudioShortcutHints({characters,onCharactersChange}: {characters:boolean; onCharactersChange:(enabled:boolean)=>void}) {
  const mac = typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");
  return <><p className={styles.dialogIntro}>Works while focus is in Studio. Click the preview to focus playback controls. Typing, menus and dialogs keep their normal keys.</p>
    <label className={styles.check}><input type="checkbox" aria-label="Enable letter and symbol shortcuts" checked={characters} onChange={event=>onCharactersChange(event.target.checked)} />Enable letter and symbol shortcuts</label>
    {!characters && <p className={styles.dialogIntro}>Letter, digit and symbol shortcuts are off. Space, arrows, native controls and metadata Save still work.</p>}
    {(["Playback","Navigation","Editing","Panels"] as const).map(group=><section key={group} className={styles.shortcutGroup}><h3>{group}</h3><dl className={styles.shortcutHints}>
      {STUDIO_SHORTCUTS.filter(binding=>binding.group===group).map(binding=><div key={binding.id} data-disabled={binding.character && !characters}><dt>{binding.label}</dt><dd><kbd>{binding.hint}</kbd></dd></div>)}
      {group === "Editing" && <div><dt>Save changed metadata in Properties</dt><dd><kbd>{mac ? "⌘" : "Ctrl"} + Enter</kbd></dd></div>}
    </dl></section>)}
    <section className={styles.shortcutGroup}><h3>Focused controls</h3><dl className={styles.shortcutHints}>
      <div><dt>Step on the timeline</dt><dd><kbd>↑ / ↓</kbd></dd></div>
      <div><dt>Resize the desktop divider</dt><dd><kbd>← / →</kbd></dd></div>
      <div><dt>Activate a button</dt><dd><kbd>Space / Enter</kbd></dd></div>
      <div><dt>Close the current menu or dialog</dt><dd><kbd>Esc</kbd></dd></div>
    </dl></section>
    <p className={styles.dialogIntro}>T opens the selected moment’s metadata without changing labels or cut membership. Labels save through their checkboxes. Wheel zooms around the playhead; Shift+wheel pans and disables Auto-scroll. Follow current moment affects Properties independently.</p>
  </>;
}
