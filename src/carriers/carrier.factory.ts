// LA FABRICA
//
// Su unico trabajo: dado el nombre de una paqueteria, devolver su adaptador.
//
// Antes esta lista era fija (estaba escrita aqui dentro). Ahora el catalogo se
// CONSTRUYE con crearCatalogo(), porque los adaptadores reales de Trace
// necesitan una clave que solo se conoce al arrancar. Una lista fija escrita en
// el archivo no puede saberla.
//
// Quien decide cual se usa es index.ts (el "composition root"), como manda la
// seccion 2 del PLAN: aqui solo se ofrece el catalogo y se busca dentro de el.
//
// Cuando alguien del equipo anada una paqueteria nueva, solo tiene que hacer dos
// cosas: crear el archivo del adaptador y anadirlo a paqueteriasDeDesarrollo().
// Ningun otro archivo del proyecto necesita cambiar.

import { DemoAdapter } from './demo.carrier.js';

import type { CarrierAdapter } from './carrier.interface.js';
import { FakeAdapter } from './fake.carrier.js';
import { SecuenciaAdapter } from './secuencia.carrier.js';
import { crearAdaptadoresDeTrace } from './traceapi.carrier.js';

// Las paqueterias de mentira, para desarrollar sin internet ni clave.
// Estan SIEMPRE disponibles: son las que se usan en las pruebas y en el dia a
// dia mientras no haya una clave real.
export function paqueteriasDeDesarrollo(): CarrierAdapter[] {
  return [new FakeAdapter(), new DemoAdapter(), new SecuenciaAdapter()];
}

// Arma el catalogo completo.
//
// Si hay clave de Trace, se suman las paqueterias reales (estafeta, redpack,
// dhl...). Si no la hay, el bot sigue funcionando con las de desarrollo: no
// queremos que el bot se niegue a arrancar solo porque falta una clave.
export function crearCatalogo(apiKeyDeTrace?: string): CarrierAdapter[] {
  const catalogo = paqueteriasDeDesarrollo();

  if (apiKeyDeTrace) {
    catalogo.push(...crearAdaptadoresDeTrace(apiKeyDeTrace));
  }

  return catalogo;
}

// Busca un adaptador por su nombre DENTRO del catalogo que le den.
export function buscarAdaptador(catalogo: CarrierAdapter[], carrierName: string): CarrierAdapter {
  const encontrado = catalogo.find((adapter) => adapter.name === carrierName);

  if (!encontrado) {
    throw new Error(`Paqueteria no soportada: ${carrierName}`);
  }

  return encontrado;
}

// Lista de nombres disponibles, util para mensajes de ayuda y para las pruebas.
export function listarPaqueterias(catalogo: CarrierAdapter[]): string[] {
  return catalogo.map((adapter) => adapter.name);
}
