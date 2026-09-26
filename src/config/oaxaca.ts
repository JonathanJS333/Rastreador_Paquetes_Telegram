// CAPA TRANSVERSAL (config)
//
// Aqui viven las reglas propias de ESTE proyecto (Mexico / Oaxaca). No son
// logica de negocio complicada: son funciones puras, sin dependencias, que
// cualquier capa puede usar y que se prueban en un suspiro.

// Los codigos postales de Oaxaca van del 68000 al 71999 (prefijos 68, 69, 70 y 71).
// Oaxaca de Juarez, la capital, es el 68000.
const CP_OAXACA_MIN = 68000;
const CP_OAXACA_MAX = 71999;

// El resultado de validar un CP es una "union discriminada": o sale bien, o sale
// mal CON un motivo. Al mirar "ok", TypeScript ya sabe si "motivo" existe. Asi es
// imposible olvidarse de comprobar el error: si intentas leer "motivo" sin
// comprobar "ok", el compilador te avisa.
export type ResultadoCp = { ok: true } | { ok: false; motivo: string };

// Comprueba que un texto sea un CP valido de Oaxaca.
//
// Un CP puede fallar por DOS motivos distintos, y hay que decirle al usuario cual
// de los dos es: no es lo mismo equivocarse al teclear (4 digitos) que intentar
// registrar un paquete que va a otro estado. El mensaje cambia.
export function validarCp(cp: string): ResultadoCp {
  // En Telegram es facil escribir " 68000 " sin querer. No castigamos por un
  // espacio de mas: lo quitamos y seguimos.
  const limpio = cp.trim();

  // Cinco digitos exactos, ni uno mas ni uno menos.
  if (!/^\d{5}$/.test(limpio)) {
    return { ok: false, motivo: 'El CP debe tener 5 digitos.' };
  }

  const numero = Number(limpio);

  if (numero < CP_OAXACA_MIN || numero > CP_OAXACA_MAX) {
    return {
      ok: false,
      motivo: 'Ese CP no es de Oaxaca. Revisa el codigo postal de entrega.',
    };
  }

  return { ok: true };
}
