let database;

function openDatabase() {
  if (!database) {
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open('afterimage-journal', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('days', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Close other open copies of the journal to continue.'));
    }).catch((error) => {
      database = null;
      throw error;
    });
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
