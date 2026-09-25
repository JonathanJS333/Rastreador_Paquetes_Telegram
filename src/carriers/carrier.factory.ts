// LA FABRICA
//
// Su unico trabajo: dado el nombre de una paqueteria, devolver su adaptador.
//
// Cuando alguien del equipo anada una paqueteria nueva, solo tiene que hacer dos
// cosas: crear el archivo del adaptador y anadirlo a la lista de abajo.
// Ningun otro archivo del proyecto necesita cambiar.
import { DemoAdapter } from './demo.carrier.js';

import type { CarrierAdapter } from './carrier.interface.js';
import { FakeAdapter } from './fake.carrier.js';
import { SecuenciaAdapter } from './secuencia.carrier.js';

// El catalogo de paqueterias disponibles.
// Aqui se iran anadiendo Estafeta, MercadoLibre, DHL...
const adapters: CarrierAdapter[] = [
  new FakeAdapter(),
  new DemoAdapter(),
  new SecuenciaAdapter(),
];


export function getAdapter(carrierName: string): CarrierAdapter {
  const encontrado = adapters.find((adapter) => adapter.name === carrierName);

  if (!encontrado) {
    throw new Error(`Paqueteria no soportada: ${carrierName}`);
  }

  return encontrado;
}

// Lista de nombres disponibles, util para mensajes de ayuda y para las pruebas.
export function listarPaqueterias(): string[] {
  return adapters.map((adapter) => adapter.name);
}
