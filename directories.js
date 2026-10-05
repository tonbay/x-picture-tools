globalThis.XPTDirectories = {
  async transact(id, handle, write = false) {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('xpt-directories', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('handles');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try { return await new Promise((resolve, reject) => {
      const tx = db.transaction('handles', write ? 'readwrite' : 'readonly');
      const request = write ? (handle === undefined ? tx.objectStore('handles').delete(id) : tx.objectStore('handles').put(handle, id)) : tx.objectStore('handles').get(id);
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () => reject(tx.error || Error('資料夾設定讀取失敗'));
    }); } finally { db.close(); }
  },
  get(id) { return this.transact(id); },
  set(id, handle) { return this.transact(id, handle, true); },
  remove(id) { return this.transact(id, undefined, true); },
  async uniqueFile(directory, filename) {
    const dot = filename.lastIndexOf('.');
    for (let i = 0; i < 10000; i++) {
      const name = i ? `${filename.slice(0, dot)} (${i})${filename.slice(dot)}` : filename;
      try { await directory.getFileHandle(name); }
      catch (error) { if (error.name !== 'NotFoundError') throw error; return directory.getFileHandle(name, {create: true}); }
    }
    throw Error('同名檔案過多');
  }
};
