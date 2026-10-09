"use strict";

// Genera el hash de la contraseña para cambiar roles (secreto ROL_CLAVE_HASH).
// Pide la clave sin mostrarla y escribe solo el hash en la salida estándar:
//   node functions/herramientas/hash-clave-rol.js > %TEMP%\h.txt
//   firebase functions:secrets:set ROL_CLAVE_HASH --data-file %TEMP%\h.txt
// Luego borra h.txt. La clave nunca se guarda en un archivo ni en el repo.

const readline = require("readline");
const {generarHash} = require("../clave-rol");

const clave = process.env.ROL_CLAVE;
if (clave) {
  process.stdout.write(generarHash(clave));
} else {
  const rl = readline.createInterface({input: process.stdin, output: process.stderr, terminal: true});
  rl._writeToOutput = () => {}; // no repetir lo que se escribe
  process.stderr.write("Contraseña para cambiar roles: ");
  rl.question("", (respuesta) => {
    rl.close();
    process.stderr.write("\n");
    if (!respuesta) {
      process.stderr.write("No se escribió ninguna contraseña.\n");
      process.exit(1);
    }
    process.stdout.write(generarHash(respuesta));
  });
}
