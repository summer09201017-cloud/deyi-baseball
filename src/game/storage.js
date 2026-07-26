const STORAGE_KEY = 'three-baseball-showdown-save-v1';

export function loadGame() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn('讀取存檔失敗', error);
    return null;
  }
}

export function saveGame(state) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    console.warn('寫入存檔失敗', error);
    return false;
  }
}

export function clearSave() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('刪除存檔失敗', error);
  }
}
