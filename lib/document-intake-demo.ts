import type { DocumentEntry, DocumentExtraction } from './document-intake.ts';
import { demoTombstoneIds, demoTrashKey, isDemoTombstoned } from './trash-storage.ts';

type StoredDocument = DocumentEntry & { blob: Blob };
type EstimateExtraction = { id: string; extraction: DocumentExtraction };
type Store = 'documents' | 'estimate-extractions';

function transact<T>(name: Store, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    const open = indexedDB.open('imprelio-archivio-documenti-v1', 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore('documents', { keyPath: 'id' });
      open.result.createObjectStore('estimate-extractions', { keyPath: 'id' });
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      database.onversionchange = () => database.close();
      try {
        const transaction = database.transaction(name, mode);
        const request = run(transaction.objectStore(name));
        transaction.oncomplete = () => { database.close(); resolve(request.result); };
        transaction.onabort = () => { database.close(); reject(request.error ?? transaction.error); };
      } catch (error) {
        database.close();
        reject(error);
      }
    };
  });
}

function entryOf({ blob: _, ...entry }: StoredDocument) {
  return entry;
}

export async function listDemoIntakeDocuments() {
  const stored = await transact<StoredDocument[]>('documents', 'readonly', store => store.getAll());
  const documents = demoTombstoneIds('document_import');
  const sites = demoTombstoneIds('site');
  return stored.filter(entry => !documents.has(entry.id) && (!entry.site_id || !sites.has(entry.site_id))).map(entryOf);
}

export async function getDemoIntakeDocument(id: string) {
  return transact<StoredDocument | undefined>('documents', 'readonly', store => store.get(id));
}

export async function saveDemoIntakeDocument(entry: DocumentEntry, blob: Blob) {
  async function save() {
    if (isDemoTombstoned('document_import', entry.id)) throw new Error('Il documento è nel cestino. Ripristinalo prima di salvare.');
    if (entry.site_id && isDemoTombstoned('site', entry.site_id)) throw new Error('Il cantiere non è disponibile.');
    try {
      await transact('documents', 'readwrite', store => store.add({ ...entry, blob }));
      return entry;
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'ConstraintError') throw error;
      const existing = await getDemoIntakeDocument(entry.id);
      if (!existing || existing.file_name !== entry.file_name || existing.mime_type !== entry.mime_type
        || existing.size_bytes !== entry.size_bytes || existing.kind !== entry.kind || existing.site_id !== entry.site_id) {
        throw new Error('Il documento è già associato a un altro caricamento.');
      }
      return entryOf(existing);
    }
  }

  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(demoTrashKey, save);
  return save();
}

export async function listDemoEstimateExtractions() {
  const stored = await transact<EstimateExtraction[]>('estimate-extractions', 'readonly', store => store.getAll());
  return new Map(stored.map(({ id, extraction }) => [id, extraction]));
}

export async function saveDemoEstimateExtraction(id: string, extraction: DocumentExtraction) {
  await transact('estimate-extractions', 'readwrite', store => store.put({ id, extraction }));
}
