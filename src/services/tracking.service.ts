// CAPA DE APLICACION
//
// Aqui vive la logica de negocio. Esta capa NO sabe de Telegram ni de bases de
// datos: solo orquesta. Por eso no importa grammy ni better-sqlite3.

import { getAdapter } from '../carriers/carrier.factory.js';
import type { TrackingResult } from '../carriers/carrier.interface.js';

export class TrackingService {
  // Consulta el estado actual de un paquete.
  //
  // Si la paqueteria no esta soportada, getAdapter lanza un error con un mensaje
  // claro. Aqui NO lo capturamos a proposito: quien llama (el bot) es quien debe
  // decidir como contarselo al usuario.
  async consultar(paqueteria: string, numeroGuia: string): Promise<TrackingResult> {
    const adapter = getAdapter(paqueteria);
    return adapter.track(numeroGuia);
  }
}
