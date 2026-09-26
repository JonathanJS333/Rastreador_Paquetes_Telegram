// VERIFICAR NUESTRA LISTA DE PAQUETERIAS CONTRA LA DE TRACE
//
// Por que existe este archivo:
//
// En src/carriers/traceapi.carrier.ts hay 10 codigos de paqueteria escritos a
// mano (estafeta, redpack, dhl...). Si uno se escribe mal, NO PASA NADA
// VISIBLE: Trace responde 400 "invalid_carrier", el adaptador lo traduce a
// "unknown" y el bot dice "no lo se" para siempre, sin explicar por que.
//
// Es exactamente el tipo de fallo silencioso que ya nos costo una tarde con el
// nombre del campo (carrier_code en vez de carrier). Este script lo cierra:
// le pregunta a Trace su catalogo real y lo compara con el nuestro.
//
// Cuando ejecutarlo:
//   - Cuando alguien anade una paqueteria nueva.
//   - De vez en cuando, por si Trace retira alguna.
//
// NO necesita clave. Comprobado el 2026-09-26: el catalogo se puede consultar
// sin credenciales (la especificacion dice que hace falta, pero no lo exige).
// Si hay clave en el .env se manda igualmente, por si algun dia la piden.
//
// Uso:
//   npx tsx scripts/verificar-paquetes.ts
//
// Sale con codigo 0 si todo cuadra y con 1 si hay alguna desconocida, para que
// se pueda encadenar en un script si algun dia hace falta.

import { env } from '../src/config/env.js';
import { PAQUETERIAS_DE_TRACE } from '../src/carriers/traceapi.carrier.js';

// Saca la lista de codigos de la respuesta, sin fiarse de su forma: si Trace
// cambia el formato, queremos enterarnos por un mensaje claro y no por un
// error raro de JavaScript.
function extraerCodigos(datos: unknown): string[] {
  if (typeof datos !== 'object' || datos === null) return [];

  const lista = (datos as Record<string, unknown>)['carriers'];
  if (!Array.isArray(lista)) return [];

  return lista
    .map((elemento) =>
      typeof elemento === 'object' && elemento !== null
        ? (elemento as Record<string, unknown>)['code']
        : undefined,
    )
    .filter((codigo): codigo is string => typeof codigo === 'string');
}

const cabeceras: Record<string, string> = {};
if (env.TRACE_API_KEY) {
  cabeceras['Authorization'] = `Bearer ${env.TRACE_API_KEY}`;
}

const respuesta = await fetch('https://api.traceapi.dev/v1/carriers', {
  headers: cabeceras,
});

if (!respuesta.ok) {
  console.error(`Trace respondio ${respuesta.status}. No se pudo verificar.`);
  if (respuesta.status === 401) {
    console.error('Pide una clave. Anade a tu .env:  TRACE_API_KEY=trc_live_tuclave');
  }
  process.exit(1);
}

const codigosDeTrace = new Set(extraerCodigos(await respuesta.json()));

console.log(`Trace acepta ${codigosDeTrace.size} paqueterias.`);
console.log('');

const nuestras = [...PAQUETERIAS_DE_TRACE];
const desconocidas = nuestras.filter((codigo) => !codigosDeTrace.has(codigo));

for (const codigo of nuestras) {
  const estado = codigosDeTrace.has(codigo) ? 'OK' : 'NO LA RECONOCE';
  console.log(`  ${estado.padEnd(14)} ${codigo}`);
}

console.log('');

if (desconocidas.length === 0) {
  console.log(`Todo bien: las ${nuestras.length} paqueterias estan en el catalogo de Trace.`);
  process.exit(0);
}

console.error(`PROBLEMA: Trace NO reconoce ${desconocidas.length} de nuestras paqueterias.`);
console.error('Mientras sigan asi, el bot respondera "no lo se" para esos paquetes.');
console.error('Arreglalo en src/carriers/traceapi.carrier.ts (PAQUETERIAS_DE_TRACE).');
console.error('Catalogo completo: https://traceapi.dev/docs  (seccion "Carrier codes")');
process.exit(1);
