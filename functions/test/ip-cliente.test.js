// IP para el límite de registros (functions/ip-cliente.js): que no se pueda
// saltar escribiendo X-Forwarded-For, y que IPv6 cuente por bloque /64.
//   node test/ip-cliente.test.js

const assert = require("node:assert/strict");
const {ipDelCliente, claveDeLimite} = require("../ip-cliente");

const con = (xff, ip) => ({headers: xff === undefined ? {} : {"x-forwarded-for": xff}, ip});

// Sin nada inventado: la IP que agrega Google.
assert.equal(ipDelCliente(con("200.1.2.3")), "200.1.2.3");
// El cliente inventa valores: se ignoran, manda el último.
assert.equal(ipDelCliente(con("1.1.1.1, 200.1.2.3")), "200.1.2.3");
assert.equal(ipDelCliente(con("9.9.9.9,8.8.8.8 , 200.1.2.3")), "200.1.2.3");
assert.equal(ipDelCliente(con(["1.1.1.1", "200.1.2.3"])), "200.1.2.3");
// Sin cabecera.
assert.equal(ipDelCliente(con(undefined, "10.0.0.5")), "10.0.0.5");
assert.equal(ipDelCliente(con("", "")), "desconocida");
assert.equal(ipDelCliente(undefined), "desconocida");

// Dos intentos con distinto valor inventado cuentan como la misma persona.
const a = claveDeLimite(ipDelCliente(con("1.1.1.1, 200.1.2.3")));
const b = claveDeLimite(ipDelCliente(con("2.2.2.2, 200.1.2.3")));
assert.equal(a, b);

// IPv4 tal cual; IPv4 escrita como IPv6.
assert.equal(claveDeLimite("200.1.2.3"), "200.1.2.3");
assert.equal(claveDeLimite("::ffff:200.1.2.3"), "200.1.2.3");

// IPv6: todo el /64 es una sola clave, con o sin "::" y mayúsculas.
const bloque = "2803:2a00:a:b::/64";
assert.equal(claveDeLimite("2803:2a00:a:b:1:2:3:4"), bloque);
assert.equal(claveDeLimite("2803:2a00:000a:000b:ffff::1"), bloque);
assert.equal(claveDeLimite("2803:2A00:A:B::"), bloque);
assert.equal(claveDeLimite("[2803:2a00:a:b::9]"), bloque);
assert.equal(claveDeLimite("fe80::1%eth0"), "fe80:0:0:0::/64");
assert.notEqual(claveDeLimite("2803:2a00:a:c::1"), bloque);
// Lo que no es una IPv6 válida no se interpreta.
assert.equal(claveDeLimite("1::2::3"), "1::2::3");
assert.equal(claveDeLimite("zz::1"), "zz::1");
assert.equal(claveDeLimite(""), "desconocida");

console.log("ok");
