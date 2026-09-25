// CONEXION Y ESQUEMA DE LA BASE DE DATOS
//
// SQLite guarda TODA la base de datos en un solo archivo (aqui, ./data/bot.sqlite).
// No hay que instalar ni mantener ningun servidor: es perfecto para empezar.
//
// El dia que el proyecto crezca, se cambia a PostgreSQL reescribiendo solo la
// carpeta "repositories/". Nada mas se entera.

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

// EL ESQUEMA: como se organizan los datos.
// Se ejecuta en cada arranque, pero "IF NOT EXISTS" hace que no pase nada
// si las tablas ya existen.
const ESQUEMA = `
CREATE TABLE IF NOT EXISTS users (
  telegram_id INTEGER PRIMARY KEY,
  chat_id     INTEGER NOT NULL,
  language    TEXT    NOT NULL DEFAULT 'es-MX',
  notify      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS shipments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id     INTEGER NOT NULL REFERENCES users(telegram_id),
  tracking_number TEXT    NOT NULL,
  carrier         TEXT    NOT NULL,
  alias           TEXT,
  dest_cp         TEXT,
  status          TEXT    NOT NULL DEFAULT 'unknown',
  last_event_at   TEXT,
  last_checked_at TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT    NOT NULL,
  UNIQUE (telegram_id, tracking_number, carrier)
);

CREATE TABLE IF NOT EXISTS tracking_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  status      TEXT    NOT NULL,
  description TEXT,
  location    TEXT,
  occurred_at TEXT,
  created_at  TEXT    NOT NULL
);
`;

export function abrirBaseDeDatos(ruta: string): Database.Database {
  // Nos aseguramos de que la carpeta existe (por ejemplo, ./data/).
  mkdirSync(dirname(ruta), { recursive: true });

  const db = new Database(ruta);

  // Las claves foraneas vienen DESACTIVADAS en SQLite por defecto. Las activamos,
  // para que no se puedan guardar paquetes de usuarios que no existen.
  db.pragma('foreign_keys = ON');

  // WAL mejora el comportamiento cuando hay varias operaciones a la vez.
  db.pragma('journal_mode = WAL');

  // Creamos las tablas si no existen.
  db.exec(ESQUEMA);

  return db;
}
