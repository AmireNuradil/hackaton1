let database;

function openDatabase() {
  if (!database) {
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open('ton-dnya', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('days', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Закройте другие вкладки с дневником.'));
    }).catch((error) => { database = null; throw error; });
  }
  return database;
}

async function access(mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('days', mode);
    const request = operation(transaction.objectStore('days'));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error ?? request.error);
  });
}

export const fetchDays = () => access('readonly', (store) => store.getAll());
export const saveDay = (day) => access('readwrite', (store) => store.put(day));
export const deleteDay = (id) => access('readwrite', (store) => store.delete(id));
