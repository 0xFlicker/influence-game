/** Finite Studio commands. Matching, control hints and Help share this list. */
export const STUDIO_SHORTCUTS = [
  {id:"play", key:" ", hint:"Space", aria:"Space", label:"Play / pause", group:"Playback", character:false, repeat:false, shift:false},
  {id:"previousFrame", key:"ArrowLeft", hint:"←", aria:"ArrowLeft", label:"Previous frame", group:"Playback", character:false, repeat:true, shift:false},
  {id:"nextFrame", key:"ArrowRight", hint:"→", aria:"ArrowRight", label:"Next frame", group:"Playback", character:false, repeat:true, shift:false},
  {id:"previousSecond", key:"ArrowLeft", hint:"Shift + ←", aria:"Shift+ArrowLeft", label:"Back one second", group:"Playback", character:false, repeat:true, shift:true},
  {id:"nextSecond", key:"ArrowRight", hint:"Shift + →", aria:"Shift+ArrowRight", label:"Forward one second", group:"Playback", character:false, repeat:true, shift:true},
  {id:"start", key:"Home", hint:"Home", aria:"Home", label:"Timeline beginning", group:"Playback", character:false, repeat:false, shift:false},
  {id:"end", key:"End", hint:"End", aria:"End", label:"Timeline end", group:"Playback", character:false, repeat:false, shift:false},
  {id:"mute", key:"m", hint:"M", aria:"m", label:"Mute / unmute monitor", group:"Playback", character:true, repeat:false, shift:false},
  {id:"fullscreen", key:"f", hint:"F", aria:"f", label:"Studio fullscreen", group:"Playback", character:true, repeat:false, shift:false},
  {id:"previousMoment", key:"[", hint:"[", aria:"[", label:"Previous playable moment · beginning", group:"Navigation", character:true, repeat:false, shift:false},
  {id:"nextMoment", key:"]", hint:"]", aria:"]", label:"Next playable moment · beginning", group:"Navigation", character:true, repeat:false, shift:false},
  {id:"source", key:"1", hint:"1", aria:"1", label:"Source", group:"Navigation", character:true, repeat:false, shift:false},
  {id:"cut", key:"2", hint:"2", aria:"2", label:"Selected cut", group:"Navigation", character:true, repeat:false, shift:false},
  {id:"search", key:"/", hint:"/", aria:"/", label:"Find a moment", group:"Navigation", character:true, repeat:false, shift:false},
  {id:"tags", key:"t", hint:"T", aria:"t", label:"Edit this moment’s metadata", group:"Editing", character:true, repeat:false, shift:false},
  {id:"follow", key:"r", hint:"R", aria:"r", label:"Follow current moment in Properties", group:"Editing", character:true, repeat:false, shift:false},
  {id:"export", key:"e", hint:"E", aria:"e", label:"Open Export", group:"Panels", character:true, repeat:false, shift:false},
  {id:"help", key:"?", hint:"?", aria:"?", label:"Keyboard hints", group:"Panels", character:true, repeat:false, shift:null},
] as const;
export type StudioCommand = typeof STUDIO_SHORTCUTS[number]["id"];
export type PreviewCommand = Extract<StudioCommand,"play"|"previousFrame"|"nextFrame"|"previousSecond"|"nextSecond"|"start"|"end"|"mute"|"fullscreen"|"previousMoment"|"nextMoment">;
type KeyEvent = Pick<KeyboardEvent,"key"|"shiftKey"|"metaKey"|"ctrlKey"|"altKey"|"repeat"|"isComposing"|"defaultPrevented"|"getModifierState">;

export function matchStudioShortcut(event: KeyEvent, characters: boolean, key = event.key) {
  if (event.defaultPrevented || event.isComposing || event.getModifierState("AltGraph") || event.metaKey || event.ctrlKey || event.altKey) return;
  const normalized = key.length === 1 ? key.toLowerCase() : key;
  return STUDIO_SHORTCUTS.find(binding => binding.key === normalized
    && (!binding.character || characters) && (!event.repeat || binding.repeat) && (binding.shift === null || binding.shift === event.shiftKey));
}

/** Child controls own typing, typeahead, resizing and their navigation keys. */
export function allowsStudioShortcut(target: Element, key: string) {
  if (target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="searchbox"],[role="spinbutton"],[role="combobox"],[role="listbox"],[role="slider"],[role="separator"],[role="menu"],[role="menubar"],[role="tree"],[role="grid"],[data-studio-shortcuts-suspended]')) return false;
  return key !== " " || !target.closest('button,summary,a[href],[role="button"],[role="checkbox"],[role="radio"],[role="switch"]');
}

export function studioLayerOpen(document: Document) {
  return Array.from(document.querySelectorAll('dialog[open],[role="dialog"][aria-modal="true"],[role="listbox"],[role="menu"]')).some(node => node.getClientRects().length > 0);
}

export function studioSaveChord(event: KeyEvent, mac: boolean) {
  return !event.defaultPrevented && !event.isComposing && !event.getModifierState("AltGraph") && !event.repeat && !event.altKey && !event.shiftKey
    && event.key === "Enter" && (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);
}

export function studioShortcutProps(command: StudioCommand, characters: boolean) {
  const binding = STUDIO_SHORTCUTS.find(item => item.id === command)!;
  const enabled = !binding.character || characters;
  return {title: `${binding.label}${enabled ? ` (${binding.hint})` : ""}`, "aria-keyshortcuts": enabled ? binding.aria : undefined};
}
