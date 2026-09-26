// PRUEBA A MANO CONTRA LA API DE TRACE
//
// Sirve para dos cosas:
//   1. Comprobar que la clave del archivo .env funciona de verdad.
//   2. Ver la RESPUESTA REAL de la API, en crudo. Programar contra una API sin
//      haberla llamado nunca es pedir problemas: la documentacion se equivoca,
//      sobre todo en los nombres de los campos.
//
// HISTORIA (2026-09-26): este archivo nacio para averiguar como se le dice a
// Trace QUE paqueteria es la guia. La documentacion normal solo decia "acepta
// un override de paqueteria", sin dar el nombre del campo. La respuesta se
// encontro en su especificacion tecnica (https://traceapi.dev/openapi.json):
// el campo se llama "carrier". Se deja la herramienta porque seguira haciendo
// falta para probar guias reales.
//
// OJO: si el nombre del campo esta mal, Trace NO da error: lo ignora en
// silencio y contesta 503, como si la guia no existiera. Por eso conviene
// probar tambien con una paqueteria inventada: si contesta 400, es que SI esta
// leyendo el campo.
//
// Uso:
//   npx tsx scripts/probar-traceapi.ts 1234567890
//   npx tsx scripts/probar-traceapi.ts 1234567890 estafeta
//   npx tsx scripts/probar-traceapi.ts 1234567890 estafeta carrier
//
// El 1er argumento es la guia (obligatorio).
// El 2o es la paqueteria (opcional).
// El 3o es el NOMBRE DEL CAMPO a probar (opcional). Por defecto "carrier", que
//   es el nombre confirmado en la especificacion de Trace.
//
// Para comprobar la LISTA de paqueterias (no una guia concreta) hay otro script:
//   npx tsx scripts/verificar-paquetes.ts

import { env } from '../src/config/env.js';

const argumentos = process.argv.slice(2);
const guia = argumentos[0];
const paqueteria = argumentos[1];
const nombreDelCampo = argumentos[2] ?? 'carrier';

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
  // Buena senal, aunque lo parezca: significa que Trace SI leyo el campo y lo
  // rechazo. Un nombre de campo desconocido no da 400, da 503 (lo ignora).
  //
  // Desde el 2026-09-26 sabemos que el nombre del campo ("carrier") es
  // correcto, asi que la causa casi seguro es la PAQUETERIA.
  console.error('Trace leyo el campo de paqueteria y lo rechazo.');
  console.error(`La paqueteria "${paqueteria ?? '(ninguna)'}" no esta en su catalogo.`);
  console.error('');
  console.error('Comprueba TODAS las nuestras de una vez:');
  console.error('  npx tsx scripts/verificar-paquetes.ts');
  console.error('Catalogo:  https://traceapi.dev/docs  (seccion "Carrier codes")');
} else if (respuesta.status === 402) {
  console.error('Se agoto la cuota mensual gratuita (1.000 consultas).');
} else if (respuesta.status === 429) {
  console.error('Demasiadas peticiones seguidas. El plan gratuito permite 10 por minuto.');
} else if (respuesta.status === 503) {
  console.error('Trace no encontro datos utilizables para esa guia.');
  console.error('');
  console.error('Cuidado: este error tiene DOS causas y se ven igual.');
  console.error('  a) La guia no existe o su fuente no responde (lo normal).');
  console.error('  b) El nombre del campo de paqueteria esta mal: Trace lo ignora');
  console.error('     en silencio y contesta lo mismo.');
  console.error('Para distinguirlas, manda una paqueteria INVENTADA:');
  console.error(`  npx tsx scripts/probar-traceapi.ts ${guia} paqueteria_inventada`);
  console.error('  - Si sale 400 -> el campo se lee bien; el 503 era por la guia.');
  console.error('  - Si sale 503 -> el campo se esta ignorando.');
}
