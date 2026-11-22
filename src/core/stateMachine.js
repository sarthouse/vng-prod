/**
 * Máquina de estados declarativa (State Pattern) para documentos del ERP.
 * Centraliza las transiciones válidas (SSOT) y lanza errores 400 claros.
 */
export function createStateMachine(transitions = {}, { label = 'Documento' } = {}) {
  const table = new Map();
  for (const [from, targets] of Object.entries(transitions)) {
    table.set(from, new Set(Array.isArray(targets) ? targets : []));
  }

  const canTransition = (from, to) => {
    const allowed = table.get(from);
    return Boolean(allowed && allowed.has(to));
  };

  const assertTransition = (from, to, { allowSame = false, message = null } = {}) => {
    if (allowSame && from === to) return true;
    if (!canTransition(from, to)) {
      const err = new Error(message || `Transición inválida en ${label}: no se puede pasar de "${from}" a "${to}".`);
      err.status = 400;
      throw err;
    }
    return true;
  };

  const allowedFrom = (from) => Array.from(table.get(from) || []);

  return { canTransition, assertTransition, allowedFrom };
}
