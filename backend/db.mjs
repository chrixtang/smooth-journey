// In-memory data layer for Smooth Journey (nothing stored server-side across restarts).
// Swappable via _setDb for tests.

export function memoryDb() {
  const m = new Map();
  const k = (pk, sk) => pk + "\u0000" + sk;
  const copy = (x) => (x ? JSON.parse(JSON.stringify(x)) : null);
  return {
    _map: m,
    async get(pk, sk) { return copy(m.get(k(pk, sk))); },
    async put(item) { m.set(k(item.pk, item.sk), copy(item)); },
    async putIfAbsent(item) {
      if (m.has(k(item.pk, item.sk))) return false;
      m.set(k(item.pk, item.sk), copy(item));
      return true;
    },
    async del(pk, sk) { m.delete(k(pk, sk)); },
    async query(pk, prefix) {
      return [...m.values()]
        .filter((i) => i.pk === pk && (!prefix || i.sk.startsWith(prefix)))
        .sort((a, b) => (a.sk < b.sk ? -1 : 1))
        .map(copy);
    },
    async byIndex(g) {
      return [...m.values()]
        .filter((i) => i.gsi1pk === g)
        .sort((a, b) => ((a.gsi1sk || "") < (b.gsi1sk || "") ? -1 : 1))
        .map(copy);
    }
  };
}

let current = null;
export function db() {
  if (!current) current = memoryDb();
  return current;
}
export function _setDb(d) { current = d; }   // tests only
