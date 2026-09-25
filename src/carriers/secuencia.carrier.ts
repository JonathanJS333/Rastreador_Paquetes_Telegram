// ADAPTADOR DE DESARROLLO: "secuencia"
//
// No habla con ninguna paqueteria real. Existe para poder VER el sincronizador
// funcionando: cada vez que se le consulta, avanza un paso en una secuencia de
// estados, como si el paquete estuviera viajando de verdad.
//
// Uso:
//   /add secuencia SECU000123
//   (dejar que el sincronizador corra)
//   ...y el estado ira avanzando: created -> in_transit -> customs -> ...
//
// El contador vive en memoria, asi que al reiniciar el bot la secuencia vuelve a
// empezar desde el principio.

import type { CarrierAdapter, NormalizedStatus, TrackingResult } from './carrier.interface.js';

const SECUENCIA: NormalizedStatus[] = [
  'created',
  'in_transit',
  'customs',
  'at_branch',
  'out_for_delivery',
  'delivered',
];

// Cuantas veces hemos consultado cada guia.
const consultas = new Map<string, number>();

export class SecuenciaAdapter implements CarrierAdapter {
  readonly name = 'secuencia';

  supports(trackingNumber: string): boolean {
    return /^SECU\d{6}$/i.test(trackingNumber);
  }

  async track(trackingNumber: string): Promise<TrackingResult> {
    const clave = trackingNumber.toUpperCase();
    const veces = consultas.get(clave) ?? 0;
    consultas.set(clave, veces + 1);

    // A partir del ultimo estado de la lista, se queda ahi.
    const status = SECUENCIA[Math.min(veces, SECUENCIA.length - 1)]!;

    return {
      trackingNumber,
      carrier: this.name,
      status,
      events: [
        {
          status,
          description: `Estado simulado por el adaptador de desarrollo (paso ${veces + 1})`,
          location: 'Oaxaca',
          occurredAt: new Date().toISOString(),
        },
      ],
    };
  }
}
