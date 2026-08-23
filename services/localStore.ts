// Local persistence adapter replacing Firestore. Collections are plain JSON
// arrays keyed by document id, stored under one localStorage key per
// collection. All writes resolve after the store has been updated so callers
// can await them like they awaited Firestore writes.
import { AppData } from '../types';

const PREFIX = 't3.store.v1.';
const COLLECTIONS: (keyof AppData)[] = [
    'items',
    'tags',
    'persons',
    'projects',
    'decisions',
    'routines',
    'logs',
    'leaveBlocks',
    'approvals',
];

function keyFor(collection: keyof AppData): string {
    return `${PREFIX}${String(collection)}`;
}

export function loadCollection<T>(collection: keyof AppData): T[] {
    try {
        const raw = localStorage.getItem(keyFor(collection));
        return raw ? (JSON.parse(raw) as T[]) : [];
    } catch {
        return [];
    }
}

export function saveCollection(collection: keyof AppData, docs: unknown[]): void {
    try {
        localStorage.setItem(keyFor(collection), JSON.stringify(docs));
    } catch (error) {
        // Quota or serialization failures must not crash the app shell.
        console.error(`Failed to persist collection "${String(collection)}":`, error);
    }
}

export function upsertDoc<T extends { id: string }>(collection: keyof AppData, doc: T): void {
    const docs = loadCollection<T>(collection);
    const index = docs.findIndex(d => d.id === doc.id);
    if (index >= 0) {
        docs[index] = doc;
    } else {
        docs.push(doc);
    }
    saveCollection(collection, docs);
}

export function deleteDocById(collection: keyof AppData, id: string): void {
    saveCollection(
        collection,
        loadCollection<{ id: string }>(collection).filter(d => d.id !== id),
    );
}

export function upsertMany<T extends { id: string }>(collection: keyof AppData, docs: T[]): void {
    const current = loadCollection<T>(collection);
    for (const doc of docs) {
        const index = current.findIndex(d => d.id === doc.id);
        if (index >= 0) {
            current[index] = doc;
        } else {
            current.push(doc);
        }
    }
    saveCollection(collection, current);
}

export function deleteManyById(collection: keyof AppData, ids: string[]): void {
    const idSet = new Set(ids);
    saveCollection(
        collection,
        loadCollection<{ id: string }>(collection).filter(d => !idSet.has(d.id)),
    );
}

export function allCollections(): (keyof AppData)[] {
    return [...COLLECTIONS];
}
