// ADAPTADOR DE TRACE API
//
// Trace (traceapi.dev) es un AGREGADOR: con una sola API cubre muchas
// paqueterias a la vez (Estafeta, Redpack, DHL, FedEx, UPS, J&T, YunExpress,
// 4PX...). Por eso este archivo no sirve a una paqueteria, sino a VARIAS: se
// crea una instancia por paqueteria cambiando solo el nombre. Ver la lista al
// final y carrier.factory.ts.
//
// Vive en la capa de infraestructura: aqui SI se habla por HTTP.

import type {
  CarrierAdapter,
  NormalizedStatus,
  TrackingEvent,
  TrackingResult,
} from './carrier.interface.js';

// Lo minimo que necesitamos de una respuesta HTTP.
//
// Se define aqui, en vez de usar el tipo Response de Node, por un motivo muy
// concreto: asi las pruebas pueden pasar un objeto inventado de tres lineas y
// NO hace falta internet. Una prueba que depende de la red deja de servir el
// dia que la red va mal, porque ya no sabes si el fallo es tuyo o de fuera.
export interface RespuestaHttp {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

// Como se pide algo por HTTP. Es una FUNCION, no una libreria: asi se puede
// sustituir en las pruebas. Por defecto se usa el fetch que ya trae Node, sin
// instalar nada (PLAN.md 3).
export type PeticionHttp = (
  url: string,
  opciones: { method: string; headers: Record<string, string>; body: string },
) => Promise<RespuestaHttp>;

const URL_DE_TRACE = 'https://api.traceapi.dev/v1/track';

// Trace usa 6 estados; nosotros tenemos 9. Esta es la traduccion.
// Ojo: no hay traduccion para "at_branch" ni para "returned" porque Trace no
// los distingue (ver PLAN.md 1.4). Hoy esos dos casos se quedan en "unknown".
const ESTADOS_DE_TRACE: Record<string, NormalizedStatus> = {
  pending: 'created',
  in_transit: 'in_transit',
  customs: 'customs',
  out_for_delivery: 'out_for_delivery',
  delivered: 'delivered',
  exception: 'exception',
};

// Traduce el estado que manda Trace. Si no lo conocemos, devuelve undefined en
// vez de inventarse una traduccion.
function traducirEstadoDeTrace(status: unknown): NormalizedStatus | undefined {
  if (typeof status !== 'string') return undefined;
  return ESTADOS_DE_TRACE[status];
}

// Convierte la lista de eventos de Trace a la nuestra.
//
// El cambio de nombre mas importante: Trace lo llama "timestamp" y nosotros
// "occurredAt".
function leerEventos(datos: Record<string, unknown>): TrackingEvent[] {
  const crudos = Array.isArray(datos['events']) ? datos['events'] : [];

  return crudos.map((crudo) => {
    const evento = comoObjeto(crudo);
    const descripcion = typeof evento['description'] === 'string' ? evento['description'] : '';

    const convertido: TrackingEvent = {
      status: traducirEstadoDeTrace(evento['status']) ?? 'unknown',
      description: descripcion,
    };

    // Aqui esta el detalle fino: nuestro tipo declara "location" y "occurredAt"
    // como OPCIONALES. Con la opcion exactOptionalPropertyTypes del proyecto,
    // poner "location: undefined" seria un error de tipos. Por eso la clave se
    // anade solo si de verdad hay dato.
    if (typeof evento['location'] === 'string') convertido.location = evento['location'];
    if (typeof evento['timestamp'] === 'string') convertido.occurredAt = evento['timestamp'];

    return convertido;
  });
}

// Devuelve el valor como objeto, o un objeto vacio si no lo es. Evita repetir
// la misma comprobacion en cada sitio.
function comoObjeto(valor: unknown): Record<string, unknown> {
  return typeof valor === 'object' && valor !== null ? (valor as Record<string, unknown>) : {};
}

export class TraceApiAdapter implements CarrierAdapter {
  constructor(
    // El nombre del adaptador ES el codigo que espera Trace ('estafeta',
    // 'redpack'...). No hacen falta dos campos que dirian lo mismo.
    readonly name: string,
    private readonly apiKey: string,
    // El transporte se recibe desde fuera para poder sustituirlo en las pruebas.
    private readonly http: PeticionHttp = fetch,
  ) {}

  // Siempre false, a proposito.
  //
  // Trace sabe adivinar algunas paqueterias por el formato del numero (1Z de
  // UPS, YT de YunExpress), pero DHL y Estafeta usan LAS DOS 10 digitos: es
  // imposible distinguirlas. Por eso la paqueteria se indica a mano en /add y
  // nunca se adivina (PLAN.md 1.5).
  //
  // El guion bajo delante de "_trackingNumber" significa "recibo el numero
  // porque la regla lo pide, pero no lo miro". Sin el guion, TypeScript se
  // quejaria de que hay un dato sin usar.
  supports(_trackingNumber: string): boolean {
    return false;
  }

  async track(trackingNumber: string): Promise<TrackingResult> {
    const datos = await this.pedirATrace(trackingNumber);

    if (!datos) {
      // La API fallo, o no tenia datos de esa guia. Se devuelve "no lo se" en
      // vez de lanzar un error: que Trace este caido un domingo no puede tumbar
      // el bot ni impedir que se revisen los demas paquetes (PLAN.md 6.3).
      return { trackingNumber, carrier: this.name, status: 'unknown', events: [] };
    }

    const eventos = leerEventos(datos);
    const estado = traducirEstadoDeTrace(datos['status']);

    return {
      trackingNumber,
      carrier: this.name,
      // PENDIENTE (ver PLAN.md 1.4): Trace no distingue "en sucursal" (el
      // ocurre) ni "devuelto al remitente". Hoy, si su estado no esta en la
      // tabla, se queda en "unknown" y no pasa nada mas. El dia que haga falta,
      // aqui es donde se miraria el texto del ultimo evento.
      status: estado ?? 'unknown',
      events: eventos,
    };
  }

  // Devuelve la respuesta de Trace, o null si algo salio mal.
  //
  // Todo lo que puede fallar se resuelve aqui dentro: codigo de error, red
  // caida, JSON ilegible. Quien llama solo tiene que comprobar si le llego algo.
  private async pedirATrace(trackingNumber: string): Promise<Record<string, unknown> | null> {
    try {
      const respuesta = await this.http(URL_DE_TRACE, {
        method: 'POST',
        headers: {
          // La clave viaja en la CABECERA, nunca dentro de la direccion: las
          // direcciones quedan apuntadas en los registros de los servidores y
          // las veria cualquiera.
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tracking_number: trackingNumber,
          // Se le dice la paqueteria para que no tenga que adivinarla.
          carrier_code: this.name,
        }),
      });

      if (!respuesta.ok) return null;

      const datos: unknown = await respuesta.json();
      return typeof datos === 'object' && datos !== null
        ? (datos as Record<string, unknown>)
        : null;
    } catch {
      // Red caida, nombre no resuelto, tiempo agotado, JSON ilegible... da igual
      // el motivo: para el bot todo esto es "no lo se".
      return null;
    }
  }
}

// Las paqueterias de Trace que nos interesan.
//
// El nombre es lo que se escribe en /add y lo que se guarda en la base de
// datos. Se eligieron segun las prioridades del PLAN.md 1.3: primero las
// mexicanas, luego las internacionales que acaban entrando por Correos o J&T
// (Shein, Temu, AliExpress).
//
// Anadir otra es anadir una linea aqui. Nada mas cambia.
const PAQUETERIAS_DE_TRACE = [
  'estafeta',
  'redpack',
  'dhl',
  'fedex',
  'ups',
  'jtexpress',
  'yunexpress',
  '4px',
  'cainiao',
  'yanwen',
];

// Crea un adaptador por paqueteria, todos con la misma clave.
// La llama index.ts al arrancar, y solo si hay clave configurada.
export function crearAdaptadoresDeTrace(apiKey: string): TraceApiAdapter[] {
  return PAQUETERIAS_DE_TRACE.map((nombre) => new TraceApiAdapter(nombre, apiKey));
}
