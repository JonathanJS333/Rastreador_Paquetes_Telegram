// PRUEBAS DE LA FABRICA
//
// La fabrica tiene dos trabajos: armar el catalogo de paqueterias y encontrar
// una por su nombre. Nada mas. Por eso estas pruebas son cortas.
//
// Lo importante que se comprueba aqui: que las paqueterias reales de Trace
// aparecen SOLO si hay clave. Si aparecieran sin clave, el bot intentaria hablar
// con internet sin credenciales y todo saldria "unknown" sin explicacion.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buscarAdaptador,
  crearCatalogo,
  listarPaqueterias,
  paqueteriasDeDesarrollo,
} from './carrier.factory.js';

const CLAVE_FALSA = 'trc_live_de_prueba';

test('las paqueterias de desarrollo son siempre las mismas', () => {
  assert.deepEqual(
    paqueteriasDeDesarrollo().map((adaptador) => adaptador.name),
    ['fake', 'demo', 'secuencia'],
  );
});

test('sin clave, el catalogo solo trae las de desarrollo', () => {
  // Sin clave no se puede rastrear de verdad, asi que no tiene sentido ofrecer
  // "estafeta" en el catalogo.
  const nombres = listarPaqueterias(crearCatalogo());
  assert.deepEqual(nombres, ['fake', 'demo', 'secuencia']);
});

test('con clave, el catalogo suma las paqueterias reales', () => {
  const nombres = listarPaqueterias(crearCatalogo(CLAVE_FALSA));

  assert.ok(nombres.includes('estafeta'), 'deberia estar Estafeta');
  assert.ok(nombres.includes('redpack'), 'deberia estar Redpack');
  assert.ok(nombres.includes('fake'), 'las de desarrollo NO deben desaparecer');
});

test('buscarAdaptador encuentra por nombre exacto', () => {
  const adaptador = buscarAdaptador(crearCatalogo(), 'fake');
  assert.equal(adaptador.name, 'fake');
});

test('buscarAdaptador lanza un error claro si la paqueteria no existe', () => {
  // El mensaje importa: es el que el bot le ensena al usuario.
  assert.throws(
    () => buscarAdaptador(crearCatalogo(), 'paqueteria-inexistente'),
    /Paqueteria no soportada: paqueteria-inexistente/,
  );
});
