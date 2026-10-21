import http from "node:http";
import net from "node:net";

const targetHost = "mail.private.example";
const targetIp = "192.0.2.10";
const allowedPorts = new Set([993, 587]);

const server = http.createServer((_request, response) => {
  response.writeHead(405).end();
});

server.on("connect", (request, client, head) => {
  const match = /^([^:]+):(\d+)$/.exec(request.url || "");
  const port = Number(match?.[2]);
  if (
    !match ||
    match[1].toLowerCase() !== targetHost ||
    !allowedPorts.has(port) ||
    head.length
  ) {
    client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    return;
  }

  const upstream = net.connect({ host: targetIp, port });
  upstream.setTimeout(15000);
  client.setTimeout(45000);
  upstream.once("connect", () => {
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    client.pipe(upstream);
    upstream.pipe(client);
  });
  upstream.on("error", () => client.destroy());
  client.on("error", () => upstream.destroy());
  upstream.on("timeout", () => upstream.destroy());
  client.on("timeout", () => client.destroy());
  client.on("close", () => upstream.destroy());
});

server.listen(3128, "0.0.0.0");
