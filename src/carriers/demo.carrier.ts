import type { CarrierAdapter, TrackingResult } from './carrier.interface.js';

export class DemoAdapter implements CarrierAdapter {
  readonly name = 'demo';


  supports(trackingNumber: string): boolean {
    return /^DEMO\d{6}$/i.test(trackingNumber);
  }

  async track(trackingNumber: string): Promise<TrackingResult> {
    return {
      trackingNumber,
      carrier: this.name,
      status: 'at_branch',
      events: [
        {
          status: 'at_branch',
          description: 'Listo para recoger en sucursal Oaxaca (datos de prueba)',
          location: 'CDMX',
          occurredAt: new Date().toISOString(),
        },
      ],
    };
  }
}
