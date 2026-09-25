// CAPA DE APLICACION
//
// El sincronizador: recorre TODOS los paquetes guardados, le pregunta su estado
// actual a la paqueteria y avisa al usuario SOLO cuando ese estado cambio.
//
// Es lo que hace que el bot sirva sin que nadie escriba nada: cada cierto tiempo
// (ver index.ts) se ejecuta syncAll() por su cuenta.

import type { NormalizedStatus, TrackingResult } from '../carriers/carrier.interface.js';
import type { ShipmentRepository } from '../repositories/shipment.repository.js';
import type { TrackingService } from './tracking.service.js';

// Lo que le paso a un paquete, expresado en DATOS.
//
// A proposito NO lleva el texto del mensaje: esta capa no sabe de palabras en
// espanol. Quien convierte esto en un mensaje legible es la capa de presentacion
// (bot.ts). Asi el mismo aviso podria mandarse por Telegram, por correo o por
// WhatsApp sin tocar este archivo.
export interface CambioDeEstado {
  chatId: number;
  carrier: string;
  trackingNumber: string;
  alias: string | null;
  anterior: NormalizedStatus;
  nuevo: NormalizedStatus;
}

// Como se manda un aviso. Es una funcion suelta a proposito, no una interfaz ni
// una clase: asi esta capa NO sabe nada de Telegram (lo exige la arquitectura) y
// las pruebas pueden sustituirla por un simple arreglo.
export type Avisar = (cambio: CambioDeEstado) => Promise<void>;

export class SyncService {
  constructor(
    private readonly repo: ShipmentRepository,
    private readonly tracking: TrackingService,
    private readonly avisar: Avisar,
  ) {}

  // Revisa todos los paquetes activos y devuelve cuantos avisos se enviaron.
  async syncAll(): Promise<number> {
    let avisados = 0;

    for (const paquete of this.repo.listarTodos()) {
      let resultado: TrackingResult;

      try {
        resultado = await this.tracking.consultar(paquete.carrier, paquete.trackingNumber);
      } catch {
        // Esta paqueteria no responde, o ya no esta soportada. Eso no es motivo
        // para dejar de revisar los paquetes de todos los demas.
        continue;
      }

      // Si el estado es el mismo que ya teniamos guardado, no hay nada que
      // contar. Este es el corazon del asunto: sin esta linea el bot mandaria
      // un mensaje cada 30 minutos aunque nada hubiera pasado.
      if (resultado.status === paquete.status) {
        continue;
      }

      this.repo.actualizarEstado(paquete.id, resultado.status);

      // El estado se guarda ANTES de avisar, a proposito. Si Telegram falla,
      // perdemos ese unico aviso (el usuario puede ver el estado con /list), pero
      // el sincronizador siempre avanza y nunca repite un mensaje ya enviado.
      try {
        await this.avisar({
          chatId: paquete.chatId,
          carrier: paquete.carrier,
          trackingNumber: paquete.trackingNumber,
          alias: paquete.alias,
          anterior: paquete.status,
          nuevo: resultado.status,
        });
        avisados++;
      } catch (error) {
        // Telegram rechazo el mensaje: lo mas comun es que el usuario haya
        // bloqueado el bot. Ese usuario se pierde el aviso, los demas no.
        console.error(`No se pudo avisar al chat ${paquete.chatId}:`, error);
      }
    }

    return avisados;
  }
}
