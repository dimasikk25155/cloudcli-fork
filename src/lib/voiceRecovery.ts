export type SavedVoiceRecording = {
  id: string;
  scope: string;
  createdAt: number;
  blob: Blob;
  filename: string;
  recordedMs: number;
  status: 'recording' | 'pending' | 'ready';
  transcript?: string;
};

const DATABASE = 'neo3-voice-recovery';
const STORE = 'recordings';

// Do not store tokens or share recordings across accounts, projects or chats.
export function voiceRecoveryScope(userId: string | number, projectId: string, sessionId?: string | null) {
  return JSON.stringify([String(userId), projectId, sessionId || 'new']);
}

async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('Voice recovery storage is unavailable'));
    const request = indexedDB.open(DATABASE, 1);
    let expired = false;
    const timer = setTimeout(() => { expired = true; reject(new Error('Voice recovery storage timed out')); }, 5000);
    const fail = () => { expired = true; clearTimeout(timer); reject(request.error || new Error('Voice recovery storage is blocked')); };
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex('scope', 'scope');
    };
    request.onerror = fail;
    request.onblocked = () => { expired = true; clearTimeout(timer); reject(new Error('Voice recovery storage is blocked')); };
    request.onsuccess = () => {
      clearTimeout(timer);
      if (expired) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode, { durability: 'strict' });
      const request = action(tx.objectStore(STORE));
      // A request's success is not a committed backup. Wait for the transaction.
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error || new Error('Voice recovery transaction aborted'));
      tx.onerror = () => reject(tx.error || new Error('Voice recovery write failed'));
    });
  } finally {
    db.close();
  }
}

export async function saveVoiceRecording(recording: SavedVoiceRecording): Promise<void> {
  await transact('readwrite', (store) => store.put(recording));
}

export async function listVoiceRecordings(scope: string): Promise<SavedVoiceRecording[]> {
  const values = await transact('readonly', (store) => store.index('scope').getAll(scope));
  return (values as SavedVoiceRecording[]).filter((item) => item.blob.size > 0)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function removeVoiceRecording(id: string): Promise<void> {
  await transact('readwrite', (store) => store.delete(id));
}
