// PRUEBAS DE LA VALIDACION DE CP (Oaxaca)
//
// Esta es la primera prueba del proyecto sobre una funcion PURA: no toca la base
// de datos, ni la red, ni Telegram. Entra un texto, sale un resultado. Es el tipo
// de codigo mas facil de probar y el que menos sorpresas da.
//
// Los CP de Oaxaca van del 68000 al 71999 (prefijos 68, 69, 70 y 71).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validarCp } from './oaxaca.js';

test('acepta un CP de Oaxaca de Juarez', () => {
  const resultado = validarCp('68000');

  assert.equal(resultado.ok, true, 'el 68000 es el CP de Oaxaca de Juarez');
});

test('acepta el ultimo CP del rango', () => {
  const resultado = validarCp('71999');

  assert.equal(resultado.ok, true, 'el 71999 es el limite superior del rango');
});

test('rechaza el primer CP que queda fuera del rango', () => {
  const resultado = validarCp('72000');

  assert.equal(resultado.ok, false, 'el 72000 ya no es de Oaxaca');
});

test('rechaza un CP de otro estado, explicando el motivo', () => {
  const resultado = validarCp('06600');

  // assert.ok(!...) hace DOS cosas: comprueba que es invalido y, ademas, le dice
  // a TypeScript que a partir de aqui SI existe "motivo". Por eso no vale un
  // assert.equal: ese no estrecha el tipo y abajo no dejaria leer "motivo".
  assert.ok(!resultado.ok, 'el 06600 es de Ciudad de Mexico, no de Oaxaca');

  // El mensaje debe decir QUE pasa, no solo que esta mal. Aqui el formato es
  // correcto: lo que falla es que no es de Oaxaca. Son dos avisos distintos.
  assert.match(resultado.motivo, /Oaxaca/i, 'debe aclarar que ese CP no es de Oaxaca');
});

test('rechaza algo que no tiene 5 digitos', () => {
  const resultado = validarCp('6800');

  assert.ok(!resultado.ok, 'el 6800 tiene 4 digitos');
  // Se escribe "digitos" sin acento porque esa es la convencion del proyecto:
  // los mensajes del codigo van sin acentos, para que se vean igual en cualquier
  // terminal. Si alguien le mete un acento al mensaje, esta prueba se pone roja.
  assert.match(resultado.motivo, /5 digitos/i, 'debe explicar que el CP tiene 5 digitos');
});

test('rechaza un CP con letras', () => {
  const resultado = validarCp('6800A');

  assert.ok(!resultado.ok, 'el 6800A no son solo numeros');
  assert.match(resultado.motivo, /5 digitos/i);
});

test('tolera espacios alrededor', () => {
  // En Telegram es facil escribir " 68000 " sin querer. Al usuario no se le debe
  // castigar por un espacio de mas.
  const resultado = validarCp(' 68000 ');

  assert.equal(resultado.ok, true, 'los espacios de sobra no deberian invalidar el CP');
});
