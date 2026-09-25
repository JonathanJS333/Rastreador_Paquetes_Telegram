// CAPA DE PRESENTACION
//
// Aqui NO va logica de negocio: el bot recibe mensajes, los entiende y delega en
// los servicios. Por eso este archivo no importa nada de "repositories/" ni
// adaptadores concretos de paqueteria (ver la regla de dependencias, PLAN.md 2.4).

import { Bot } from 'grammy';
import { env } from '../config/env.js';
import type { NormalizedStatus } from '../carriers/carrier.interface.js';
import type { Avisar, CambioDeEstado } from '../services/sync.service.js';
import type { TrackingService } from '../services/tracking.service.js';

// Como se le muestra cada estado al usuario. Esto es presentacion, por eso vive
// aqui y no en el servicio: el servicio no deberia saber de palabras en espanol.
const ETIQUETAS: Record<NormalizedStatus, string> = {
  unknown: 'Sin informacion todavia',
  created: 'Guia creada, todavia sin salir',
  in_transit: 'En transito',
  customs: 'Retenido en revision aduanal',
  at_branch: 'En sucursal, listo para recoger',
  out_for_delivery: 'En reparto',
  delivered: 'Entregado',
  exception: 'Incidencia en la entrega',
  returned: 'Devuelto al remitente',
};

const AYUDA =
  'Comandos disponibles:\n\n' +
  '/add <paqueteria> <guia> [alias]  -  Guardar un paquete\n' +
  '/list  -  Ver tus paquetes guardados\n' +
  '/estado <paqueteria> <guia>  -  Consultar un paquete ahora mismo\n' +
  '/help  -  Ver esta ayuda\n\n' +
  'Ejemplos:\n' +
  '/add fake FAKE000123 Tenis\n' +
  '/estado demo DEMO000999';

const USO_ADD = 'Uso: /add <paqueteria> <guia> [alias]\n\nEjemplo: /add fake FAKE000123 Tenis';

// El bot se construye RECIBIENDO sus dependencias, no creandolas el mismo.
// Asi queda claro que necesita un TrackingService para funcionar.
export function crearBot(tracking: TrackingService): Bot {
  const bot = new Bot(env.BOT_TOKEN);

  // /start: lo que Telegram envia cuando alguien abre el bot por primera vez.
  bot.command('start', async (ctx) => {
    const nombre = ctx.from?.first_name ?? '';
    const saludo = nombre ? `Hola, ${nombre}.` : 'Hola.';

    await ctx.reply(
      `${saludo}\n\n` +
        'Soy el rastreador de paquetes para Oaxaca.\n' +
        'Registro tus guias y te aviso cuando el estado cambie.\n\n' +
        'Escribe /help para ver lo que puedo hacer.',
    );
  });

  // /help: la lista de comandos disponibles.
  bot.command('help', async (ctx) => {
    await ctx.reply(AYUDA);
  });

  // /add <paqueteria> <guia> [alias]
  bot.command('add', async (ctx) => {
    const partes = ctx.match.trim().split(/\s+/).filter(Boolean);
    const paqueteria = partes[0];
    const guia = partes[1];
    const alias = partes.slice(2).join(' ');

    if (!paqueteria || !guia) {
      await ctx.reply(USO_ADD);
      return;
    }

    // ctx.from es quien escribe; ctx.chat es la conversacion. Los necesitamos
    // para saber a quien pertenece el paquete y a donde mandar los avisos.
    const telegramId = ctx.from?.id;
    const chatId = ctx.chat?.id;

    if (!telegramId || !chatId) {
      await ctx.reply('No pude identificar tu usuario de Telegram.');
      return;
    }

    try {
      const guardado = await tracking.agregar(
        telegramId,
        chatId,
        paqueteria,
        guia,
        alias || undefined,
      );

      const lineas = [
        'Paquete guardado.',
        '',
        `Alias: ${guardado.alias ?? '(sin alias)'}`,
        `Paqueteria: ${guardado.carrier}`,
        `Guia: ${guardado.trackingNumber}`,
      ];

      if (guardado.status === 'unknown') {
        lineas.push('', 'Todavia no pude consultar su estado. Prueba /estado mas tarde.');
      } else {
        lineas.push(`Estado: ${ETIQUETAS[guardado.status]}`);
      }

      lineas.push('', 'Escribe /list para ver todos tus paquetes.');

      await ctx.reply(lineas.join('\n'));
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : 'Error desconocido';
      await ctx.reply(`No pude guardar el paquete.\n\n${mensaje}`);
    }
  });

  // /list: los paquetes guardados de quien escribe.
  bot.command('list', async (ctx) => {
    const telegramId = ctx.from?.id;

    if (!telegramId) {
      await ctx.reply('No pude identificar tu usuario de Telegram.');
      return;
    }

    const paquetes = tracking.listar(telegramId);

    if (paquetes.length === 0) {
      await ctx.reply('No tienes paquetes guardados todavia.\n\nUsa /add para registrar uno.');
      return;
    }

    const bloques = paquetes.map((paquete, indice) => {
      const titulo = paquete.alias
        ? `${paquete.alias} (${paquete.trackingNumber})`
        : paquete.trackingNumber;

      return `${indice + 1}. ${titulo}\n   ${paquete.carrier} · ${ETIQUETAS[paquete.status]}`;
    });

    await ctx.reply(`Tus paquetes (${paquetes.length}):\n\n${bloques.join('\n\n')}`);
  });

  // /estado <paqueteria> <guia>: consulta puntual, sin guardar nada.
  bot.command('estado', async (ctx) => {
    // ctx.match es el texto que va despues del comando.
    const partes = ctx.match.trim().split(/\s+/).filter(Boolean);
    const paqueteria = partes[0];
    const guia = partes[1];

    if (!paqueteria || !guia) {
      await ctx.reply('Uso: /estado <paqueteria> <guia>\n\nEjemplo: /estado fake FAKE000123');
      return;
    }

    try {
      const resultado = await tracking.consultar(paqueteria, guia);
      const ultimo = resultado.events.at(-1);

      const lineas = [
        `Paquete: ${resultado.trackingNumber}`,
        `Paqueteria: ${resultado.carrier}`,
        `Estado: ${ETIQUETAS[resultado.status]}`,
      ];

      if (ultimo) {
        lineas.push(`Ultimo movimiento: ${ultimo.description}`);
        if (ultimo.location) {
          lineas.push(`Ubicacion: ${ultimo.location}`);
        }
        if (ultimo.occurredAt) {
          lineas.push(`Fecha: ${new Date(ultimo.occurredAt).toLocaleString('es-MX')}`);
        }
      }

      await ctx.reply(lineas.join('\n'));
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : 'Error desconocido';
      await ctx.reply(`No pude consultar el paquete.\n\n${mensaje}`);
    }
  });

  // Cualquier otro texto que no sea un comando conocido.
  bot.on('message:text', async (ctx) => {
    await ctx.reply('Todavia no entiendo ese mensaje. Escribe /help para ver los comandos.');
  });

  // Si algo falla dentro de un handler, lo registramos en pantalla
  // en lugar de dejar que el bot se caiga.
  bot.catch((error) => {
    console.error('Error atendiendo un mensaje:', error.error);
  });

  return bot;
}

// Convierte un cambio de estado en el mensaje que recibe el usuario.
// Vive aqui porque es presentacion: el servicio manda DATOS, no frases.
function formatearCambio(cambio: CambioDeEstado): string {
  const titulo = cambio.alias
    ? `${cambio.alias} (${cambio.trackingNumber})`
    : cambio.trackingNumber;

  return (
    'Tu paquete cambio de estado.\n\n' +
    `${titulo}\n` +
    `Paqueteria: ${cambio.carrier}\n` +
    `Antes: ${ETIQUETAS[cambio.anterior]}\n` +
    `Ahora: ${ETIQUETAS[cambio.nuevo]}`
  );
}

// El sincronizador necesita mandar mensajes, pero la capa de aplicacion no sabe
// de Telegram (lo exige la arquitectura). Aqui le entregamos la funcion ya
// "cableada" al bot, y asi el servicio solo ve una funcion cualquiera.
export function crearAvisador(bot: Bot): Avisar {
  return async (cambio) => {
    await bot.api.sendMessage(cambio.chatId, formatearCambio(cambio));
  };
}
