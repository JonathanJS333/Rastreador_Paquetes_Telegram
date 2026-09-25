import 'dotenv/config';
import { z } from 'zod';

// En el archivo .env, una variable sin valor llega como cadena vacia ("") en lugar de
// undefined. La quitamos para que los valores por defecto de zod si se apliquen.
const rawEnv = Object.fromEntries(
  Object.entries(process.env).filter(([, valor]) => valor !== ''),
);

// Aqui se declara QUE variables necesita el proyecto y COMO deben ser.
// Si una no cumple, el bot no arranca: es mejor fallar aqui que a mitad de un rastreo.
const schema = z.object({
  BOT_TOKEN: z
    .string({ error: 'Falta BOT_TOKEN. Pegalo en el archivo .env' })
    .min(10, 'El BOT_TOKEN parece incompleto'),
  DATABASE_PATH: z.string().default('./data/bot.sqlite'),
  COUNTRY: z.string().default('MX'),
  DEFAULT_STATE: z.string().default('Oaxaca'),
  TZ: z.string().default('America/Mexico_City'),
  TRACKING_PROVIDER: z.string().default('aftership'),
  TRACKING_API_KEY: z.string().optional(),
  MERCADOLIBRE_ACCESS_TOKEN: z.string().optional(),
  POLL_INTERVAL_MINUTES: z.coerce.number().int().positive().default(30),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const parsed = schema.safeParse(rawEnv);

if (!parsed.success) {
  console.error('Configuracion invalida. Revisa tu archivo .env:\n');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`);
  }
  process.exit(1);
}

// Esta es la unica puerta de entrada a la configuracion del proyecto.
// Ninguna otra parte del codigo debe leer process.env directamente.
export const env = parsed.data;
