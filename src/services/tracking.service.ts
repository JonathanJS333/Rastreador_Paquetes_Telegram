// CAPA DE APLICACION
//
// Aqui vive la logica de negocio. Esta capa NO sabe de Telegram: solo orquesta.
// Tampoco escribe SQL: para eso le pide las cosas al repositorio.

import { getAdapter } from '../carriers/carrier.factory.js';
import type { TrackingResult } from '../carriers/carrier.interface.js';
import type { Shipment, ShipmentRepository } from '../repositories/shipment.repository.js';

// La base de datos rechaza los paquetes repetidos gracias a la restriccion UNIQUE
// del esquema. Aqui traducimos ese error tecnico a algo que un usuario entienda.
function esDuplicado(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed');
}

export class TrackingService {
  // El repositorio llega desde fuera (se lo da index.ts). El servicio no lo crea.
  constructor(private readonly repo: ShipmentRepository) {}

  // Consulta el estado actual de un paquete, sin guardar nada.
  //
  // Si la paqueteria no esta soportada, getAdapter lanza un error con un mensaje
  // claro. Aqui NO lo capturamos a proposito: quien llama (el bot) es quien debe
  // decidir como contarselo al usuario.
  async consultar(paqueteria: string, numeroGuia: string): Promise<TrackingResult> {
    const adapter = getAdapter(paqueteria);
    return adapter.track(numeroGuia);
  }

  // Guarda un paquete nuevo para este usuario y consulta su estado por primera vez.
  async agregar(
    telegramId: number,
    chatId: number,
    paqueteria: string,
    numeroGuia: string,
    alias?: string,
  ): Promise<Shipment> {
    // Comprobamos que la paqueteria existe ANTES de guardar nada. Si no,
    // tendriamos paquetes guardados que nunca se podrian consultar.
    const adapter = getAdapter(paqueteria);

    // El usuario tiene que existir antes que el paquete, porque la tabla
    // "shipments" apunta a la tabla "users".
    this.repo.registrarUsuario(telegramId, chatId);

    let guardado: Shipment;
    try {
      guardado = this.repo.agregar(telegramId, paqueteria, numeroGuia, alias);
    } catch (error) {
      if (esDuplicado(error)) {
        throw new Error(`Ya tienes guardado el paquete ${numeroGuia} de ${paqueteria}.`);
      }
      throw error;
    }

    // Primera consulta, para que el paquete no nazca "sin informacion".
    // Si la API falla, el paquete YA esta guardado: no perdemos el trabajo del
    // usuario, simplemente se queda con estado "unknown".
    try {
      const resultado = await adapter.track(numeroGuia);
      this.repo.actualizarEstado(guardado.id, resultado.status);
      return { ...guardado, status: resultado.status };
    } catch {
      return guardado;
    }
  }

  // Los paquetes guardados de un usuario.
  listar(telegramId: number): Shipment[] {
    return this.repo.listarPorUsuario(telegramId);
  }
}
