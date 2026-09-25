// CONTRATOS DEL DOMINIO
//
// Aqui se define QUE es un paquete rastreado y QUE debe saber hacer cualquier
// paqueteria que queramos anadir en el futuro.
//
// Esta es la capa mas interna del proyecto (PLAN.md, seccion 2.3). Por eso este
// archivo NO importa axios, ni grammy, ni better-sqlite3: solo describe formas.
// Si algun dia ves un "import" aqui arriba, algo se ha hecho mal.

// Los unicos estados que el bot sabe mostrar. Cada paqueteria dice las cosas a su
// manera ("En reparto", "Out for delivery", "Disponible para ocurre"...), y el
// trabajo de cada adaptador es traducirlo a uno de estos.
export type NormalizedStatus =
  | 'unknown' // no lo sabemos todavia
  | 'created' // la guia existe, pero el paquete aun no ha salido
  | 'in_transit' // en camino
  | 'customs' // retenido en aduana (muy comun con Shein, Temu, AliExpress)
  | 'at_branch' // en sucursal, listo para recoger ("ocurre")
  | 'out_for_delivery' // en reparto, sale hoy
  | 'delivered' // entregado
  | 'exception' // intento fallido, direccion incorrecta...
  | 'returned'; // devuelto al remitente

// Un momento concreto del recorrido del paquete.
export interface TrackingEvent {
  status: NormalizedStatus;
  description: string;
  location?: string;
  occurredAt?: string; // fecha en formato ISO 8601
}

// La respuesta completa de una consulta de rastreo.
export interface TrackingResult {
  trackingNumber: string;
  carrier: string;
  status: NormalizedStatus;
  events: TrackingEvent[];
  estimatedDelivery?: string;
}

// EL CONTRATO.
// Cualquier paqueteria que queramos anadir tiene que cumplir exactamente esto.
// Si lo cumple, encaja en el sistema sin tocar nada mas.
export interface CarrierAdapter {
  readonly name: string; // 'fake', 'estafeta', 'dhl'...
  supports(trackingNumber: string): boolean; // sabe rastrear este numero?
  track(trackingNumber: string): Promise<TrackingResult>;
}
