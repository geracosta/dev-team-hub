import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * SQLite embebido para el estado de la app (dailies, calendario, identidades).
 * El esquema es deliberadamente simple: una tabla clave→JSON por colección,
 * espejada en memoria vía PersistentMap. Con un equipo de decenas de personas
 * el volumen es mínimo y así el resto del código sigue trabajando con Maps.
 *
 * La ruta sale de DATABASE_PATH (en Docker apunta al volumen /data); por
 * defecto queda junto al server, como roster.json.
 */

const serverRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

const dbPath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(serverRoot, 'dev-team-hub.db');

mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
console.log(`[db] SQLite en ${dbPath}`);

interface Row {
  key: string;
  value: string;
}

/**
 * Map con write-through a SQLite: carga la tabla al construirse y persiste en
 * cada set/delete/clear. Ojo con mutar en el lugar un valor obtenido con
 * get(): eso no persiste solo — hay que volver a llamar set() con el mismo
 * objeto (ver routes/daily.ts).
 */
export class PersistentMap<V> extends Map<string, V> {
  private readonly put;
  private readonly del;
  private readonly wipe;

  constructor(table: string) {
    super();
    // `table` es un identificador interno del código, nunca input de usuario.
    db.exec(
      `CREATE TABLE IF NOT EXISTS ${table} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    );
    this.put = db.prepare(
      `INSERT INTO ${table} (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );
    this.del = db.prepare(`DELETE FROM ${table} WHERE key = ?`);
    this.wipe = db.prepare(`DELETE FROM ${table}`);
    for (const row of db
      .prepare(`SELECT key, value FROM ${table}`)
      .all() as Row[]) {
      super.set(row.key, JSON.parse(row.value) as V);
    }
  }

  override set(key: string, value: V): this {
    super.set(key, value);
    // En la carga inicial (constructor) los statements todavía no existen.
    this.put?.run(key, JSON.stringify(value));
    return this;
  }

  override delete(key: string): boolean {
    this.del?.run(key);
    return super.delete(key);
  }

  override clear(): void {
    this.wipe?.run();
    super.clear();
  }
}
