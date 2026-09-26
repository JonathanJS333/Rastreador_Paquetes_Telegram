// PRUEBAS DEL ADAPTADOR DE TRACE API
//
// Estas pruebas NO llaman a internet. Se le da al adaptador una respuesta
// INVENTADA, con la misma forma que devuelve Trace, y se comprueba que la
// traduce bien a nuestras reglas.
//
// Por que asi: una prueba que depende de internet falla cuando la red va mal,
// cuando la API cambia o cuando se agota la cuota gratuita. Y entonces deja de
// servir, porque ya no sabes si el fallo es tuyo o de fuera.
//
// La forma de la respuesta inventada esta copiada de la documentacion de Trace
// (traceapi.dev/docs, consultada el 2026-09-26).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { NormalizedStatus } from './carrier.interface.js';
import { TraceApiAdapter, type PeticionHttp } from './traceapi.carrier.js';

const CLAVE_FALSA = 'trc_live_de_prueba';

// Fabrica una respuesta HTTP falsa con la forma que usa Trace.
function respuesta(cuerpo: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => cuerpo,
  };
}

// Un "transporte" falso que siempre devuelve lo mismo.
function httpQueDevuelve(cuerpo: unknown, status = 200): PeticionHttp {
  return async () => respuesta(cuerpo, status);
}

// Una respuesta valida y minima de Trace, para no repetirla en cada prueba.
function respuestaDeTrace(status: string, eventos: unknown[] = []) {
  return {
    tracking_number: '1234567890',
    carrier: { code: 'estafeta', name: 'Estafeta', type: 'domestic' },
    status,
    estimated_delivery: null,
    events: eventos,
  };
}

test('traduce los estados de Trace a los nuestros', async () => {
  // Trace usa 6 estados; nosotros tenemos 9. Esta es la traduccion.
  const equivalencias: Array<[string, NormalizedStatus]> = [
    ['pending', 'created'],
    ['in_transit', 'in_transit'],
    ['customs', 'customs'],
    ['out_for_delivery', 'out_for_delivery'],
    ['delivered', 'delivered'],
    ['exception', 'exception'],
  ];

  for (const [estadoDeTrace, esperado] of equivalencias) {
    const adaptador = new TraceApiAdapter(
      'estafeta',
      CLAVE_FALSA,
      httpQueDevuelve(respuestaDeTrace(estadoDeTrace)),
    );

    const resultado = await adaptador.track('1234567890');

    assert.equal(
      resultado.status,
      esperado,
      `"${estadoDeTrace}" deberia traducirse como "${esperado}"`,
    );
  }
});

test('un estado que no conocemos se convierte en unknown', async () => {
  // Trace puede anadir estados nuevos cuando quiera. Si eso pasa, preferimos
  // decir "no lo se" antes que inventarnos una traduccion equivocada.
  const adaptador = new TraceApiAdapter(
    'estafeta',
    CLAVE_FALSA,
    httpQueDevuelve(respuestaDeTrace('estado_que_no_existe')),
  );

  const resultado = await adaptador.track('1234567890');

  assert.equal(resultado.status, 'unknown');
});

test('convierte los eventos al formato del proyecto', async () => {
  const adaptador = new TraceApiAdapter(
    'estafeta',
    CLAVE_FALSA,
    httpQueDevuelve(
      respuestaDeTrace('in_transit', [
        {
          status: 'in_transit',
          description: 'Salio de la sucursal de origen',
          location: 'CDMX, Mexico',
          timestamp: '2026-07-03T09:30:00.000Z',
        },
      ]),
    ),
  );

  const resultado = await adaptador.track('1234567890');
  const evento = resultado.events[0];

  assert.ok(evento, 'deberia haber convertido el evento');
  assert.equal(evento.status, 'in_transit');
  assert.equal(evento.description, 'Salio de la sucursal de origen');
  assert.equal(evento.location, 'CDMX, Mexico');
  // Trace lo llama "timestamp"; nosotros lo llamamos "occurredAt".
  assert.equal(evento.occurredAt, '2026-07-03T09:30:00.000Z');
});

test('omite la ubicacion cuando Trace no la manda', async () => {
  // Trace manda "location": null cuando no la tiene. En nuestro tipo la
  // ubicacion es opcional, asi que la clave debe DESAPARECER, no quedarse
  // como undefined (con exactOptionalPropertyTypes eso seria un error de tipos).
  const adaptador = new TraceApiAdapter(
    'estafeta',
    CLAVE_FALSA,
    httpQueDevuelve(
      respuestaDeTrace('in_transit', [
        {
          status: 'in_transit',
          description: 'En camino',
          location: null,
          timestamp: '2026-07-03T09:30:00.000Z',
        },
      ]),
    ),
  );

  const resultado = await adaptador.track('1234567890');
  const evento = resultado.events[0];

  assert.ok(evento);
  assert.equal('location' in evento, false, 'no deberia existir la clave location');
});

test('si la API responde con error, devuelve unknown en vez de lanzar', async () => {
  // Regla del proyecto (PLAN.md 6.3): que una API externa falle NO puede tumbar
  // el bot. Se devuelve "no lo se" y el sincronizador sigue con los demas.
  const adaptador = new TraceApiAdapter(
    'estafeta',
    CLAVE_FALSA,
    httpQueDevuelve({ error: { code: 'unauthorized', message: 'Invalid API key' } }, 401),
  );

  const resultado = await adaptador.track('1234567890');

  assert.equal(resultado.status, 'unknown');
  assert.deepEqual(resultado.events, []);
});

test('un error del servidor no se cree el cuerpo aunque parezca valido', async () => {
  // Esta prueba existe por un fallo que encontramos con una "mutacion"
  // (rompimos el codigo a proposito y las pruebas no lo detectaron).
  //
  // El caso trampa: Trace responde 500 (error del servidor) pero el cuerpo trae
  // un estado que reconocemos. NO podemos creernoslo. Un "delivered" falso haria
  // que el bot avisara al usuario de que su paquete llego... cuando no llego.
  const adaptador = new TraceApiAdapter(
    'estafeta',
    CLAVE_FALSA,
    httpQueDevuelve(
      respuestaDeTrace('delivered', [
        {
          status: 'delivered',
          description: 'Entregado',
          location: 'Oaxaca, Mexico',
          timestamp: '2026-07-03T09:30:00.000Z',
        },
      ]),
      500,
    ),
  );

  const resultado = await adaptador.track('1234567890');

  assert.equal(
    resultado.status,
    'unknown',
    'un error 500 nunca debe dar por bueno el estado que venga en el cuerpo',
  );
  assert.deepEqual(resultado.events, []);
});

test('si internet falla, devuelve unknown en vez de lanzar', async () => {
  const httpRoto: PeticionHttp = async () => {
    throw new Error('fetch failed');
  };
  const adaptador = new TraceApiAdapter('estafeta', CLAVE_FALSA, httpRoto);

  const resultado = await adaptador.track('1234567890');

  assert.equal(resultado.status, 'unknown');
  assert.deepEqual(resultado.events, []);
});

test('manda la guia, la paqueteria y la clave en la peticion', async () => {
  const peticiones: Array<{ url: string; opciones: Parameters<PeticionHttp>[1] }> = [];

  const httpEspia: PeticionHttp = async (url, opciones) => {
    peticiones.push({ url, opciones });
    return respuesta(respuestaDeTrace('in_transit'));
  };

  const adaptador = new TraceApiAdapter('estafeta', CLAVE_FALSA, httpEspia);
  await adaptador.track('1234567890');

  const peticion = peticiones[0];
  assert.ok(peticion, 'deberia haber hecho una peticion');

  assert.equal(peticion.url, 'https://api.traceapi.dev/v1/track');
  assert.equal(peticion.opciones.method, 'POST');

  // La clave va en la cabecera, NUNCA dentro de la direccion: las direcciones
  // quedan apuntadas en los registros de los servidores y las veria cualquiera.
  assert.equal(peticion.opciones.headers.Authorization, `Bearer ${CLAVE_FALSA}`);

  const cuerpo = JSON.parse(peticion.opciones.body) as Record<string, unknown>;
  assert.equal(cuerpo.tracking_number, '1234567890');
  // Hay que indicar la paqueteria: las guias de Estafeta son numericas y Trace
  // no puede adivinar de quien son (DHL tambien usa 10 digitos).
  //
  // El campo se llama "carrier", NO "carrier_code". Se comprobo en la
  // especificacion tecnica de Trace (https://traceapi.dev/openapi.json,
  // consultada el 2026-09-26): "Optional carrier override". La documentacion
  // normal no lo publicaba; adivinarlo habria dejado el override sin efecto
  // y Trace habria respondido 503 sin explicar por que.
  assert.equal(cuerpo.carrier, 'estafeta');
  assert.equal(cuerpo.carrier_code, undefined, 'no debe mandarse el nombre viejo');
});

test('no intenta adivinar la paqueteria por el numero', () => {
  // DHL y Estafeta usan ambos 10 digitos: distinguirlas es imposible. Por eso
  // "supports" siempre dice que no, y la paqueteria se indica a mano en /add.
  const adaptador = new TraceApiAdapter('estafeta', CLAVE_FALSA, httpQueDevuelve({}));

  assert.equal(adaptador.supports('1234567890'), false);
});
