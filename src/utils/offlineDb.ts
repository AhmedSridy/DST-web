import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { OfflineQueueItem } from '../types/domain.ts';

interface DstOfflineSchema extends DBSchema {
  sessionState: {
    key: string;
    value: { key: string; data: unknown; updatedAt: string };
  };
  offlineQueue: {
    key: string;
    value: OfflineQueueItem;
  };
  cachedSnapshots: {
    key: string;
    value: { key: string; data: unknown; updatedAt: string };
  };
}

let dbPromise: Promise<IDBPDatabase<DstOfflineSchema>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<DstOfflineSchema>('dst-fertilizer-offline-db', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('sessionState')) {
          db.createObjectStore('sessionState', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('offlineQueue')) {
          db.createObjectStore('offlineQueue', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('cachedSnapshots')) {
          db.createObjectStore('cachedSnapshots', { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
}

export async function saveCachedSnapshot<T>(key: string, data: T): Promise<void> {
  try {
    const db = await getDb();
    await db.put('cachedSnapshots', {
      key,
      data,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('IndexedDB saveCachedSnapshot warning:', err);
  }
}

export async function loadCachedSnapshot<T>(key: string): Promise<T | null> {
  try {
    const db = await getDb();
    const record = await db.get('cachedSnapshots', key);
    return (record?.data as T) ?? null;
  } catch {
    return null;
  }
}

export async function saveSessionState<T>(key: string, data: T): Promise<void> {
  try {
    const db = await getDb();
    await db.put('sessionState', {
      key,
      data,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('IndexedDB saveSessionState warning:', err);
  }
}

export async function loadSessionState<T>(key: string): Promise<T | null> {
  try {
    const db = await getDb();
    const record = await db.get('sessionState', key);
    return (record?.data as T) ?? null;
  } catch {
    return null;
  }
}

export async function enqueueOfflineOperation(
  operationType: OfflineQueueItem['operationType'],
  payload: Record<string, unknown>,
): Promise<OfflineQueueItem> {
  const db = await getDb();
  const item: OfflineQueueItem = {
    id: `oq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    operationType,
    payload,
    createdAt: new Date().toISOString(),
    retryCount: 0,
  };
  await db.put('offlineQueue', item);
  return item;
}

export async function getOfflineQueue(): Promise<OfflineQueueItem[]> {
  try {
    const db = await getDb();
    const all = await db.getAll('offlineQueue');
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch {
    return [];
  }
}

export async function removeOfflineQueueItem(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('offlineQueue', id);
}

export async function clearOfflineQueue(): Promise<void> {
  const db = await getDb();
  await db.clear('offlineQueue');
}
