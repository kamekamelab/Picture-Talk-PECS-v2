import { initialState, validateState } from './domain.js';
const DB_NAME = 'picture-talk-pecs-v2';
let database;
export async function openStorage() {
  database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('app');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('別のタブを閉じてから、もう一度開いてください。'));
  });
  database.onversionchange = () => { database.close(); location.reload(); };
  const value = await new Promise((resolve, reject) => {
    const tx = database.transaction('app', 'readonly');
    const request = tx.objectStore('app').get('state');
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
  });
  if (value === undefined) {
    const state = initialState();
    await writeState(state);
    return state;
  }
  return validateState(value);
}
export function writeState(value) {
  const clean = validateState(value);
  return new Promise((resolve, reject) => {
    const tx = database.transaction('app', 'readwrite');
    tx.objectStore('app').put(clean, 'state');
    tx.oncomplete = () => resolve(clean);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('保存が中断されました。'));
  });
}
