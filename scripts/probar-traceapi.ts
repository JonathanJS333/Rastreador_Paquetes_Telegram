// PRUEBA A MANO CONTRA LA API DE TRACE
//
// Sirve para tres cosas:
//   1. Comprobar que la clave del archivo .env funciona de verdad.
//   2. Ver la RESPUESTA REAL de la API, en crudo, antes de escribir el adaptador.
//      Programar contra una API sin haberla llamado nunca es pedir problemas:
//      la documentacion se equivoca, sobre todo en los nombres de los campos.
//   3. Averiguar como se le dice a Trace QUE paqueteria es la guia.
//
// Ese ultimo dato es el motivo principal de este archivo. La documentacion de
// Trace dice que "acepta un override de paqueteria", pero NO dice como se llama
// ese campo. Y para Estafeta hace falta: sus guias son numericas y no se
// autodetectan. En vez de adivinarlo, se lo preguntamos a la API.
//
// Uso:
//   npx tsx scripts/probar-traceapi.ts 1234567890
//   npx tsx scripts/probar-traceapi.ts 1234567890 estafeta
//   npx tsx scripts/probar-traceapi.ts 1234567890 estafeta carrier
//
// El 1er argumento es la guia (obligatorio).
// El 2o es la paqueteria (opcional).
// El 3o es el NOMBRE DEL CAMPO a probar (opcional). Por defecto "carrier_code",
//   que es el nombre mas habitual. Si sale error, prueba otro nombre.

import { env } from '../src/config/env.js';

const argumentos = process.argv.slice(2);
const guia = argumentos[0];
const paqueteria = argumentos[1];
const nombreDelCampo = argumentos[2] ?? 'carrier_code';

if (!guia) {
  console.error('Falta la guia.');
  console.error('Uso: npx tsx scripts/probar-traceapi.ts 1234567890 [paqueteria] [campo]');
  process.exit(1);
}

if (!env.TRACE_API_KEY) {
  console.error('Falta TRACE_API_KEY en el archivo .env');
  console.error('Anade una linea asi:  TRACE_API_KEY=trc_live_tuclave');
  process.exit(1);
}

// El cuerpo de la peticion. Si se indica paqueteria, se anade el campo con el
// nombre que estemos probando.
const cuerpo: Record<string, string> = { tracking_number: guia };

if (paqueteria) {
  cuerpo[nombreDelCampo] = paqueteria;
}

console.log('--- PETICION ---');
console.log(`POST https://api.traceapi.dev/v1/track`);
console.log(JSON.stringify(cuerpo, null, 2));
console.log('');

const respuesta = await fetch('https://api.traceapi.dev/v1/track', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${env.TRACE_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(cuerpo),
});

const texto = await respuesta.text();

console.log('--- RESPUESTA ---');
console.log(`Codigo HTTP: ${respuesta.status}`);
console.log('');

// Se imprime el JSON "bonito" si se puede; si no, el texto tal cual.
try {
  console.log(JSON.stringify(JSON.parse(texto), null, 2));
} catch {
  console.log(texto);
}

console.log('');

if (respuesta.status === 401) {
  console.error('La clave no es valida. Revisa TRACE_API_KEY en el .env.');
} else if (respuesta.status === 400) {
  console.error('La peticion esta mal formada. Si has pasado una paqueteria,');
  console.error(`puede que "${nombreDelCampo}" no sea el nombre correcto del campo.`);
  console.error('Prueba otro:  npx tsx scripts/probar-traceapi.ts ' + guia + ' ' + (paqueteria ?? 'estafeta') + ' carrier');
} else if (respuesta.status === 402) {
  console.error('Se agoto la cuota mensual gratuita (1.000 consultas).');
} else if (respuesta.status === 429) {
  console.error('Demasiadas peticiones seguidas. El plan gratuito permite 10 por minuto.');
} else if (respuesta.status === 503) {
  console.error('Trace no encontro datos utilizables para esa guia.');
  console.error('No significa que la guia este mal: puede que la fuente no responda.');
}
