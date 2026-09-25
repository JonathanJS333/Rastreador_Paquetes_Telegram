// PRUEBAS DEL SINCRONIZADOR (Paso 10)
//
// Estas pruebas usan la base de datos REAL y el adaptador "fake" REAL. La base
// de datos vive en memoria (":memory:"), asi que cada prueba empieza limpia y no
// deja archivos tirados.
//
// Lo unico que sustituimos es el envio del mensaje de Telegram: en vez de hablar
// con Telegram, anotamos los avisos en un arreglo para poder revisarlos.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ShipmentRepository } from '../repositories/shipment.repository.js';
import { SyncService, type CambioDeEstado } from './sync.service.js';
import { TrackingService } from './tracking.service.js';

test('syncAll avisa cuando el estado del paquete cambio', async () => {
  const repo = new ShipmentRepository(':memory:');
  const tracking = new TrackingService(repo);

  // El adaptador "fake" SIEMPRE responde "in_transit", asi que al guardar el
  // paquete queda ya en ese estado.
  const guardado = await tracking.agregar(111, 111, 'fake', 'FAKE000123');

  // Simulamos que en la revision anterior el estado era "unknown".
  repo.actualizarEstado(guardado.id, 'unknown');

  // Sustituto del envio por Telegram: solo anotamos lo que se habria enviado.
  const avisos: CambioDeEstado[] = [];
  const sync = new SyncService(repo, tracking, async (cambio) => {
    avisos.push(cambio);
  });

  const avisados = await sync.syncAll();

  assert.equal(avisados, 1, 'deberia haber avisado exactamente una vez');
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0]?.chatId, 111, 'el aviso debe ir al chat del usuario');
  assert.equal(avisos[0]?.trackingNumber, 'FAKE000123');
  assert.equal(avisos[0]?.anterior, 'unknown', 'debe decir de donde venia');
  assert.equal(avisos[0]?.nuevo, 'in_transit', 'debe decir a donde llego');
  assert.equal(
    repo.listarPorUsuario(111)[0]?.status,
    'in_transit',
    'el estado guardado debe quedar actualizado',
  );
});

test('syncAll no avisa cuando el estado sigue igual', async () => {
  const repo = new ShipmentRepository(':memory:');
  const tracking = new TrackingService(repo);

  // El paquete queda guardado YA con el estado "in_transit" que devuelve "fake".
  await tracking.agregar(222, 222, 'fake', 'FAKE000999');

  const avisos: CambioDeEstado[] = [];
  const sync = new SyncService(repo, tracking, async (cambio) => {
    avisos.push(cambio);
  });

  const avisados = await sync.syncAll();

  assert.equal(avisados, 0, 'no deberia avisar si nada cambio');
  assert.equal(avisos.length, 0, 'no deberia haberse enviado ningun mensaje');
});

test('un paquete que falla no impide revisar los demas', async () => {
  const repo = new ShipmentRepository(':memory:');
  const tracking = new TrackingService(repo);

  // Paquete 1: de una paqueteria que NO existe. Consultarlo va a lanzar error.
  // Se guarda directo con el repositorio porque el servicio lo rechazaria.
  repo.registrarUsuario(333, 333);
  const roto = repo.agregar(333, 'paqueteria-inexistente', 'XXX000001');

  // Paquete 2: normal, con un cambio de estado pendiente de avisar.
  const bueno = await tracking.agregar(333, 333, 'fake', 'FAKE000111');
  repo.actualizarEstado(bueno.id, 'unknown');

  const avisos: CambioDeEstado[] = [];
  const sync = new SyncService(repo, tracking, async (cambio) => {
    avisos.push(cambio);
  });

  const avisados = await sync.syncAll();

  assert.equal(avisados, 1, 'el paquete bueno SI debe avisarse');
  assert.equal(avisos.length, 1);
  assert.equal(
    repo.listarPorUsuario(333).find((paquete) => paquete.id === roto.id)?.status,
    'unknown',
    'el paquete que fallo conserva su estado anterior',
  );
});

test('un aviso que falla no impide avisar a los demas', async () => {
  const repo = new ShipmentRepository(':memory:');
  const tracking = new TrackingService(repo);

  // Dos usuarios, cada uno con un paquete pendiente de aviso.
  const primero = await tracking.agregar(444, 444, 'fake', 'FAKE000444');
  repo.actualizarEstado(primero.id, 'unknown');

  const segundo = await tracking.agregar(555, 555, 'fake', 'FAKE000555');
  repo.actualizarEstado(segundo.id, 'unknown');

  // El usuario 444 bloqueo el bot: Telegram responde con un error.
  const entregados: number[] = [];
  const sync = new SyncService(repo, tracking, async (cambio) => {
    if (cambio.chatId === 444) {
      throw new Error('Telegram: bot bloqueado por el usuario');
    }
    entregados.push(cambio.chatId);
  });

  const avisados = await sync.syncAll();

  assert.deepEqual(entregados, [555], 'el otro usuario SI debe recibir su aviso');
  assert.equal(avisados, 1, 'solo cuenta el aviso que si se envio');
});
