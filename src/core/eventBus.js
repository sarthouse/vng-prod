/**
 * Bus de eventos síncrono transaccional en memoria.
 * Ejecuta listeners de forma síncrona dentro del mismo call stack de repo.transaction(...)
 * para preservar la atomicidad de SQLite / SAVEPOINTs (fail-fast en excepciones).
 */
export function createEventBus({ maxDepth = 10 } = {}) {
  const listeners = new Map();
  let depth = 0;

  const on = (eventName, handler, { id = null, priority = 0 } = {}) => {
    if (!eventName || typeof handler !== 'function') {
      throw new Error('EventBus.on requiere eventName y handler función');
    }
    if (!listeners.has(eventName)) listeners.set(eventName, []);
    const list = listeners.get(eventName);
    if (id && list.some(item => item.id === id)) {
      return;
    }
    list.push({ id, priority: Number(priority) || 0, handler });
    list.sort((a, b) => b.priority - a.priority);
  };

  const emit = (eventName, payload = {}) => {
    if (depth >= maxDepth) {
      throw new Error(`Ciclo detectado en EventBus al emitir "${eventName}" (profundidad máxima ${maxDepth})`);
    }
    const list = listeners.get(eventName);
    if (!list || list.length === 0) return;
    depth++;
    try {
      for (const entry of list) {
        entry.handler(payload);
      }
    } finally {
      depth--;
    }
  };

  const clear = (eventName = null) => {
    if (eventName) listeners.delete(eventName);
    else listeners.clear();
  };

  const listenerCount = (eventName) => (listeners.get(eventName) || []).length;

  return { on, emit, clear, listenerCount };
}

export const domainBus = createEventBus({ maxDepth: 10 });
