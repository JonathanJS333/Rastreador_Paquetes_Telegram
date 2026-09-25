// EL REPOSITORIO
//
// Es la UNICA puerta de entrada a la base de datos. El resto del proyecto nunca
// escribe SQL: le pide cosas al repositorio.
//
// Si algun dia cambiamos SQLite por PostgreSQL, solo se reescribe este archivo
// (y db.ts). Nada mas se entera.

import type { Database } from 'better-sqlite3';
import type { NormalizedStatus } from '../carriers/carrier.interface.js';
import { abrirBaseDeDatos } from './db.js';

// Como ve el resto del proyecto un paquete guardado.
// Se usa camelCase porque es codigo; en la base de datos las columnas van en
// snake_case. La traduccion entre ambos se hace en la funcion "aShipment".
export interface Shipment {
  id: number;
  telegramId: number;
  // A que conversacion hay que mandarle los avisos. No siempre coincide con
  // telegramId: si alguien usa el bot dentro de un grupo, son numeros distintos.
  chatId: number;
  trackingNumber: string;
  carrier: string;
  alias: string | null;
  destCp: string | null;
  status: NormalizedStatus;
  createdAt: string;
}

// Como viene realmente una fila de la base de datos.
interface FilaShipment {
  id: number;
  telegram_id: number;
  chat_id: number;
  tracking_number: string;
  carrier: string;
  alias: string | null;
  dest_cp: string | null;
  status: string;
  created_at: string;
}

function aShipment(fila: FilaShipment): Shipment {
  return {
    id: fila.id,
    telegramId: fila.telegram_id,
    chatId: fila.chat_id,
    trackingNumber: fila.tracking_number,
    carrier: fila.carrier,
    alias: fila.alias,
    destCp: fila.dest_cp,
    // Aqui SI hace falta convertir: la base de datos solo guarda texto, no sabe
    // nada de nuestros estados. Este es el unico punto donde confiamos en que
    // el valor guardado es uno de los validos.
    status: fila.status as NormalizedStatus,
    createdAt: fila.created_at,
  };
}

// Todas las consultas de paquetes necesitan el chat_id del usuario, porque ahi
// es donde hay que mandarle los avisos, y ese dato vive en la tabla "users".
// Por eso todas hacen el mismo JOIN. Tenerlo en un solo sitio evita que alguna
// consulta nueva se olvide de traerlo.
const SELECT_PAQUETE = `
  SELECT s.*, u.chat_id AS chat_id
  FROM shipments s
  JOIN users u ON u.telegram_id = s.telegram_id
`;

export class ShipmentRepository {
  private readonly db: Database;

  constructor(rutaBaseDeDatos: string) {
    this.db = abrirBaseDeDatos(rutaBaseDeDatos);
  }

  // Registra al usuario si es la primera vez que escribe.
  // "ON CONFLICT" significa: si ya existe, solo actualiza su chat_id.
  registrarUsuario(telegramId: number, chatId: number): void {
    this.db
      .prepare(
        `INSERT INTO users (telegram_id, chat_id, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT (telegram_id) DO UPDATE SET chat_id = excluded.chat_id`,
      )
      .run(telegramId, chatId, new Date().toISOString());
  }

  // Guarda un paquete nuevo y lo devuelve ya con su id asignado.
  agregar(
    telegramId: number,
    carrier: string,
    trackingNumber: string,
    alias?: string,
  ): Shipment {
    // Los signos "?" son marcadores: los valores van aparte, nunca pegados al SQL.
    // Eso evita la "inyeccion SQL", que es el fallo de seguridad mas clasico.
    const resultado = this.db
      .prepare(
        `INSERT INTO shipments (telegram_id, tracking_number, carrier, alias, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(telegramId, trackingNumber, carrier, alias ?? null, new Date().toISOString());

    const creado = this.buscarPorId(Number(resultado.lastInsertRowid));

    if (!creado) {
      throw new Error('No se pudo leer el paquete recien guardado');
    }

    return creado;
  }

  // Actualiza el estado de un paquete y anota cuando lo revisamos por ultima vez.
  actualizarEstado(shipmentId: number, status: NormalizedStatus): void {
    this.db
      .prepare(
        `UPDATE shipments
         SET status = ?, last_checked_at = ?
         WHERE id = ?`,
      )
      .run(status, new Date().toISOString(), shipmentId);
  }

  // Todos los paquetes activos de un usuario, el mas reciente primero.
  listarPorUsuario(telegramId: number): Shipment[] {
    const filas = this.db
      .prepare(
        `${SELECT_PAQUETE}
         WHERE s.telegram_id = ? AND s.active = 1
         ORDER BY s.id DESC`,
      )
      .all(telegramId) as FilaShipment[];

    return filas.map(aShipment);
  }

  // TODOS los paquetes activos, de todos los usuarios. Lo usa el sincronizador,
  // que revisa el estado de cada paquete sin que nadie se lo pida.
  listarTodos(): Shipment[] {
    const filas = this.db
      .prepare(
        `${SELECT_PAQUETE}
         WHERE s.active = 1
         ORDER BY s.id ASC`,
      )
      .all() as FilaShipment[];

    return filas.map(aShipment);
  }

  // Cuantos paquetes hay guardados en total. Util para diagnostico.
  contar(): number {
    const fila = this.db
      .prepare('SELECT COUNT(*) AS total FROM shipments')
      .get() as { total: number };

    return fila.total;
  }

  private buscarPorId(id: number): Shipment | undefined {
    const fila = this.db
      .prepare(
        `${SELECT_PAQUETE}
         WHERE s.id = ?`,
      )
      .get(id) as FilaShipment | undefined;

    return fila ? aShipment(fila) : undefined;
  }
}
