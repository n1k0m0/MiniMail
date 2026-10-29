import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import { once } from "node:events";
import { validateTargets } from "../vpn/config.mjs";
import { createProxy } from "../vpn/proxy.mjs";

test("VPN destinations require explicit unique hostnames, pinned IPs and allowed ports", () => {
  assert.deepEqual(
    validateTargets([
      {
        host: "MAIL.PRIVATE.EXAMPLE",
        ip: "192.0.2.10",
        ports: [993, 587, 993],
      },
    ]),
    [{ host: "mail.private.example", ip: "192.0.2.10", ports: [993, 587] }],
  );
  for (const invalid of [
    [],
    [{ host: "mail.private.example", ip: "127.0.0.1", ports: [993] }],
    [{ host: "mail.private.example", ip: "not-an-ip", ports: [993] }],
    [{ host: "mail.private.example", ip: "192.0.2.10", ports: ["993"] }],
    [{ host: "mail.private.example", ip: "192.0.2.10", ports: [0] }],
    [{ host: "mail/private.example", ip: "192.0.2.10", ports: [993] }],
  ])
    assert.throws(() => validateTargets(invalid));
  const target = {
    host: "mail.private.example",
    ip: "192.0.2.10",
    ports: [993],
  };
  assert.throws(() => validateTargets([target, target]));
});

test("VPN CONNECT proxy pins its configured destination and rejects other hosts and ports", async () => {
  const upstream = net.createServer((socket) =>
    socket.on("data", (data) => socket.write(data)),
  );
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const port = upstream.address().port;
  // Loopback is a test fixture only: deployment configuration rejects it.
  const proxy = createProxy([
    { host: "mail.private.example", ip: "127.0.0.1", ports: [port] },
  ]);
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  async function connect(host, destinationPort) {
    const socket = net.connect(proxy.address().port, "127.0.0.1");
    await once(socket, "connect");
    socket.write(
      `CONNECT ${host}:${destinationPort} HTTP/1.1\r\nHost: proxy\r\n\r\n`,
    );
    const [reply] = await once(socket, "data");
    return { socket, reply: reply.toString() };
  }
  try {
    for (const [host, destinationPort] of [
      ["other.private.example", port],
      ["mail.private.example", port === 65535 ? 1 : port + 1],
    ]) {
      const { socket, reply } = await connect(host, destinationPort);
      assert.match(reply, /^HTTP\/1.1 403/);
      socket.destroy();
    }
    const { socket, reply } = await connect("mail.private.example", port);
    assert.match(reply, /^HTTP\/1.1 200/);
    const echoed = once(socket, "data");
    socket.write("synthetic TLS payload");
    assert.equal((await echoed)[0].toString(), "synthetic TLS payload");
    socket.destroy();
    const status = await new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${proxy.address().port}`, (response) => {
          response.resume();
          resolve(response.statusCode);
        })
        .on("error", reject);
    });
    assert.equal(status, 405);
  } finally {
    await new Promise((resolve) => proxy.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  }
});
