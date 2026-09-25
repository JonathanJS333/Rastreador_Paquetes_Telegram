// Punto de entrada del bot.
//
// Este archivo es el "composition root": el UNICO sitio del proyecto donde se
// decide que implementacion concreta usa cada pieza. El resto del codigo recibe
// sus dependencias ya montadas y no las crea por su cuenta.

// Ojo: la extension ".js" es obligatoria aunque el archivo sea ".ts".
// Es una regla de Node cuando se trabaja con modulos modernos.
import { env } from './config/env.js';
import { crearBot } from './bot/bot.js';
import { TrackingService } from './services/tracking.service.js';

console.log('Configuracion cargada correctamente:');
console.log(`  Region: ${env.COUNTRY} / ${env.DEFAULT_STATE}`);
console.log(`  Base de datos: ${env.DATABASE_PATH}`);
console.log(`  Revisar paquetes cada: ${env.POLL_INTERVAL_MINUTES} minutos`);
console.log(`  Proveedor de rastreo: ${env.TRACKING_PROVIDER}`);
console.log('');

// Aqui se montan las piezas, de dentro hacia fuera.
const tracking = new TrackingService();
const bot = crearBot(tracking);

// bot.start() abre una conexion permanente con Telegram y NO termina nunca:
// se queda escuchando mensajes hasta que lo detengas con Ctrl + C.
console.log('Conectando con Telegram...');

bot
  .start({
    onStart: (botInfo) => {
      console.log(`Bot conectado como @${botInfo.username}`);
      console.log('Abre Telegram y prueba:  /estado fake FAKE000123');
    },
  })
  .catch(() => {
    console.error('No se pudo conectar con Telegram.');
    console.error('Revisa que el BOT_TOKEN del archivo .env sea correcto.');
    process.exit(1);
  });
