import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "dispatch_store.json");

export interface AppPersistentStore {
  version: number;
  lastSavedAt: string;
  tickets: any[];
  cleanerOverrides: Record<string, any>;
  scheduledVisits: any[];
  quotes: any[];
  invoices: any[];
}

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (err) {
    console.error("Failed to create data directory:", err);
  }
}

/**
 * Loads stored data from disk
 */
export function loadStore(): AppPersistentStore | null {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, "utf-8");
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn("Could not read dispatch_store.json, creating initial store:", err);
  }
  return null;
}

/**
 * Atomically writes data to disk
 */
export function saveStore(store: AppPersistentStore): boolean {
  try {
    const json = JSON.stringify(
      {
        ...store,
        lastSavedAt: new Date().toISOString(),
      },
      null,
      2
    );
    fs.writeFileSync(STORE_FILE, json, "utf-8");
    return true;
  } catch (err) {
    console.error("Failed to write dispatch_store.json:", err);
    return false;
  }
}
