import { BUILTIN_STORES } from '../domain/rules.js';

export const DATABASE_NAME = 'home-shopping-list-v1';
export const DATA_TABLES = ['stores', 'products', 'needs', 'trips', 'importBatches'];
const TABLES = [...DATA_TABLES, 'appMeta'];

export function newRecord(id = crypto.randomUUID(), now = new Date().toISOString()) {
  return { id, createdAt: now, updatedAt: now, revision: 1 };
}

export function openDatabase(name = DATABASE_NAME) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = event => {
      if (event.oldVersion !== 0) return;
      const db = request.result;
      const indexes = { needs: ['state', 'tripId'], trips: ['storeId', 'status'], importBatches: ['fingerprint'] };
      for (const table of TABLES) {
        const store = db.createObjectStore(table, { keyPath: 'id' });
        for (const index of indexes[table] ?? []) store.createIndex(index, index);
      }
      const tx = request.transaction;
      for (const store of BUILTIN_STORES) {
        tx.objectStore('stores').add({ ...newRecord(store.id), ...store, archivedAt: null });
      }
      tx.objectStore('appMeta').add({
        id: 'dataset',
        datasetId: crypto.randomUUID(),
        deviceId: crypto.randomUUID(),
        token: crypto.randomUUID(),
      });
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('请关闭购物清单的其他标签页，然后重新加载。'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

// Run writes synchronously in the final IDB request callback, including on WebKit.
export function transact(db, change) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TABLES, change ? 'readwrite' : 'readonly');
    const data = {};
    let pending = TABLES.length;
    let result;
    let failure;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('数据库事务已取消。'));

    for (const table of TABLES) {
      const store = tx.objectStore(table);
      const request = table === 'appMeta' ? store.get('dataset') : store.getAll();
      request.onsuccess = () => {
        data[table === 'appMeta' ? 'meta' : table] = request.result;
        pending -= 1;
        if (pending !== 0) return;
        try {
          if (!data.meta) throw new Error('数据库缺少数据集记录。');
          if (!change) {
            result = data;
            return;
          }
          result = change(data, {
            put: (name, value) => tx.objectStore(name).put(value),
            clear: name => tx.objectStore(name).clear(),
          });
          tx.objectStore('appMeta').put({ ...data.meta, token: crypto.randomUUID() });
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
    }
  });
}
