const STORAGE_KEY = "roam_device_id";

// No auth in the MVP: each browser/device gets a random id persisted in
// localStorage, used to scope participant rows. See docs/DATABASE.md for
// the trust model this implies.
export function getDeviceId(): string {
  if (typeof window === "undefined") {
    throw new Error("getDeviceId() must be called client-side.");
  }

  const existing = window.localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;

  const id = crypto.randomUUID();
  window.localStorage.setItem(STORAGE_KEY, id);
  return id;
}
