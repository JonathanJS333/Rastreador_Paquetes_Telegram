// Punto de entrada del bot.
//
// Este archivo es el "composition root": el UNICO sitio del proyecto donde se
// decide que implementacion concreta usa cada pieza. El resto del codigo recibe
// sus dependencias ya montadas y no las crea por su cuenta.

// Ojo: la extension ".js" es obligatoria aunque el archivo sea ".ts".
// Es una regla de Node cuando se trabaja con modulos modernos.
import { env } from './config/env.js';
import { crearAvisador, crearBot } from './bot/bot.js';
import { ShipmentRepository } from './repositories/shipment.repository.js';
import { SyncService } from './services/sync.service.js';
import { TrackingService } from './services/tracking.service.js';

console.log('Configuracion cargada correctamente:');
console.log(`  Region: ${env.COUNTRY} / ${env.DEFAULT_STATE}`);
console.log(`  Revisar paquetes cada: ${env.POLL_INTERVAL_MINUTES} minutos`);
console.log(`  Proveedor de rastreo: ${env.TRACKING_PROVIDER}`);

// Aqui se montan las piezas, de dentro hacia fuera:
//   repositorio (datos)  ->  servicio (logica)  ->  bot (Telegram)
const repositorio = new ShipmentRepository(env.DATABASE_PATH);
const tracking = new TrackingService(repositorio);
const bot = crearBot(tracking);

// El sincronizador recibe una funcion para avisar. Esa funcion la fabrica el
// bot, porque es quien sabe hablar con Telegram.
const sincronizador = new SyncService(repositorio, tracking, crearAvisador(bot));

console.log(`Base de datos lista: ${env.DATABASE_PATH}`);
console.log(`  Paquetes guardados: ${repositorio.contar()}`);
console.log('');

// EL SINCRONIZADOR AUTOMATICO
//
// setTimeout y setInterval vienen incluidos en Node. No hace falta instalar
// node-cron solo para repetir una tarea cada X minutos: seria una dependencia
// mas para una linea.
//
// Se usa setTimeout re-agendandose a si mismo, NO setInterval. Con setInterval,
// si una revision tarda mas que el intervalo, la siguiente empieza encima de la
// anterior y el usuario recibe el mismo aviso dos veces. Asi, la siguiente
// revision siempre espera a que la anterior haya terminado.
//
// ponytail: el reloj vive en memoria, asi que al reiniciar el bot empieza de
// cero. El dia que necesitemos que sobreviva reinicios, toca un cron del sistema
// (o el Programador de tareas de Windows).
const intervaloMs = env.POLL_INTERVAL_MINUTES * 60 * 1000;

async function revisarPaquetes(): Promise<void> {
  try {
    const avisados = await sincronizador.syncAll();
    const hora = new Date().toLocaleTimeString('es-MX');
    console.log(`[${hora}] Revision hecha. Avisos enviados: ${avisados}`);
  } catch (error) {
    // Una revision que falla NO debe tumbar el bot: el reloj vuelve a disparar.
    console.error('Fallo la revision automatica:', error);
  }
}

async function ciclo(): Promise<void> {
  await revisarPaquetes();
  setTimeout(() => void ciclo(), intervaloMs);
}

setTimeout(() => void ciclo(), intervaloMs);

// bot.start() abre una conexion permanente con Telegram y NO termina nunca:
// se queda escuchando mensajes hasta que lo detengas con Ctrl + C.
console.log('Conectando con Telegram...');

bot
  .start({
    onStart: (botInfo) => {
      console.log(`Bot conectado como @${botInfo.username}`);
      console.log(`Revisare los paquetes solo, cada ${env.POLL_INTERVAL_MINUTES} minutos.`);
      console.log('Abre Telegram y prueba:  /estado fake FAKE000123');
    },
  })
  .catch(() => {
    console.error('No se pudo conectar con Telegram.');
    console.error('Revisa que el BOT_TOKEN del archivo .env sea correcto.');
    process.exit(1);
  });
