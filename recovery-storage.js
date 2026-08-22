import { RECOVERY_KEY, parseRecoveryRecord } from "./recovery-core.js";

export const RECOVERY_DATABASE_NAME = "bluebeam-killer-recovery";
export const RECOVERY_STORE_NAME = "documents";

function openRecoveryDatabase(factory = globalThis.indexedDB) {
  if (!factory?.open) return Promise.reject(new Error("IndexedDB is not available."));
  return new Promise((resolve, reject) => {
    const request = factory.open(RECOVERY_DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(RECOVERY_STORE_NAME)) request.result.createObjectStore(RECOVERY_STORE_NAME, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("The recovery database could not be opened."));
    request.onblocked = () => reject(new Error("The recovery database is blocked by another tab."));
  });
}

async function useRecoveryStore(mode, operation, factory) {
  const database = await openRecoveryDatabase(factory);
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(RECOVERY_STORE_NAME, mode), store = transaction.objectStore(RECOVERY_STORE_NAME), request = operation(store);let result;
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error || new Error("The recovery request failed."));
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || new Error("The recovery transaction failed."));
      transaction.onabort = () => reject(transaction.error || new Error("The recovery transaction was cancelled."));
    });
  } finally {
    database.close();
  }
}

export async function loadRecoveryRecord(factory = globalThis.indexedDB) {
  const value = await useRecoveryStore("readonly", store => store.get(RECOVERY_KEY), factory);
  return parseRecoveryRecord(value);
}

export async function saveRecoveryRecord(record, factory = globalThis.indexedDB) {
  const value = parseRecoveryRecord(record);
  if (!value) throw new Error("The recovery data is not valid.");
  await useRecoveryStore("readwrite", store => store.put(value), factory);
  return value;
}

export async function deleteRecoveryRecord(factory = globalThis.indexedDB) {
  await useRecoveryStore("readwrite", store => store.delete(RECOVERY_KEY), factory);
  return true;
}
