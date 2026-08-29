export type EditorStorageRead =
  | { ok: true; value: string | null }
  | { ok: false; value: null };

export function readEditorStorage(key: string): EditorStorageRead {
  try {
    return { ok: true, value: window.sessionStorage.getItem(key) };
  } catch {
    return { ok: false, value: null };
  }
}

export function writeEditorStorage(key: string, value: string): boolean {
  try {
    window.sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeEditorStorage(key: string): boolean {
  try {
    window.sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
