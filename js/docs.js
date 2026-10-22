// Prescription PDFs attached on this device. Stored in IndexedDB only — they
// are never uploaded, so clinical documents stay private to this browser.

const DB_NAME = 'joshhealth-physio-docs';
const STORE = 'docs';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(result.result ?? result);
    tx.onerror = () => reject(tx.error);
  });
}

export async function addDoc(programmeId, file) {
  const doc = { id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, programmeId, name: file.name, type: file.type || 'application/pdf', size: file.size, addedAt: Date.now(), blob: file };
  await run('readwrite', (s) => s.put(doc));
  return doc;
}

export async function listDocs(programmeId) {
  const all = await run('readonly', (s) => s.getAll());
  return all.filter((d) => d.programmeId === programmeId).sort((a, b) => a.addedAt - b.addedAt);
}

export async function getDoc(id) {
  return run('readonly', (s) => s.get(id));
}

export async function deleteDoc(id) {
  await run('readwrite', (s) => s.delete(id));
}

export async function clearDocs() {
  await run('readwrite', (s) => s.clear());
}
