// ADAPTADOR DE MENTIRA
//
// No llama a ninguna API: inventa los datos. Sirve para dos cosas:
//
//   1. Que el resto del equipo pueda avanzar sin esperar a que la API real funcione.
//   2. Que las pruebas no dependan de internet (si la red falla, no fallan las pruebas).

import type { CarrierAdapter, TrackingResult } from './carrier.interface.js';

export class FakeAdapter implements CarrierAdapter {
  readonly name = 'fake';

  // Solo acepta numeros que empiecen por "FAKE", para que nunca se confunda
  // con una guia real por accidente.
  supports(trackingNumber: string): boolean {
    return /^FAKE\d{6}$/i.test(trackingNumber);
  }

  async track(trackingNumber: string): Promise<TrackingResult> {
    return {
      trackingNumber,
      carrier: this.name,
      status: 'in_transit',
      events: [
        {
          status: 'in_transit',
          description: 'En transito hacia Oaxaca (datos de prueba)',
          location: 'CDMX',
          occurredAt: new Date().toISOString(),
        },
      ],
    };
  }
}
