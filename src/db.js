import { db, DB_PATH, DB_DIR, registerDbInitializer, getConnection, getCurrentDbName, hasActiveDatabase, resolveRequestDatabase, runWithDatabase, closeConnection, closeAllConnections, isValidDbName, getDbPath } from './db/connection.js';
import { applySchema } from './db/schema.js';
import { runSeeds } from './db/seed.js';

function initializeConnection(conn) {
  applySchema(conn);
  runSeeds(conn);
}

registerDbInitializer(initializeConnection);

export { db, DB_PATH, DB_DIR, getConnection, getCurrentDbName, hasActiveDatabase, resolveRequestDatabase, runWithDatabase, closeConnection, closeAllConnections, isValidDbName, getDbPath };

export function initDb(name) {
  return getConnection(name || getCurrentDbName());
}
