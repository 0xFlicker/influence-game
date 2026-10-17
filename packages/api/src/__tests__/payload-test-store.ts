import { setPayloadObjectStoreForTests, type PayloadObjectStore } from "../services/payload-storage.js";

export class MemoryPayloadStore implements PayloadObjectStore {
  readonly objects = new Map<string, Uint8Array>();
  async putIfAbsent(key: string, bytes: Uint8Array) {
    if (this.objects.has(key)) return false;
    this.objects.set(key, Uint8Array.from(bytes));
    return true;
  }
  async get(key: string) {
    const bytes = this.objects.get(key);
    if (!bytes) throw new Error("Test payload missing");
    return Uint8Array.from(bytes);
  }
}
export const testPayloadStore = new MemoryPayloadStore();
setPayloadObjectStoreForTests(testPayloadStore);
