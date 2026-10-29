import http from "node:http";
import net from "node:net";
import { pathToFileURL } from "node:url";
import { loadTargets } from "./config.mjs";

export function createProxy(targets) {
  const server = http.createServer((_request, response) =>
    response.writeHead(405).end(),
  );
  server.headersTimeout = 10000;
  server.requestTimeout = 10000;
  server.maxHeadersCount = 50;
  server.maxConnections = 64;
  server.on("clientError", (_error, socket) => socket.destroy());
  server.on("connect", (request, client, head) => {
    const match = /^([a-zA-Z0-9.-]{1,253}):(\d{1,5})$/.exec(request.url || "");
    const port = Number(match?.[2]);
    const target =
      match &&
      targets.find(
        (item) =>
          item.host === match[1].toLowerCase() && item.ports.includes(port),
      );
    if (!target || head.length) {
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    const upstream = net.connect({ host: target.ip, port });
    upstream.setTimeout(15000);
    client.setTimeout(60000);
    upstream.once("connect", () => {
      upstream.setTimeout(60000);
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      client.pipe(upstream);
      upstream.pipe(client);
    });
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
    upstream.on("timeout", () => upstream.destroy());
    client.on("timeout", () => client.destroy());
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => client.destroy());
  });
  return server;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const targets = loadTargets();
  if (process.argv.includes("--ips"))
    console.log([...new Set(targets.map(({ ip }) => ip))].join("\n"));
  else createProxy(targets).listen(3128, "0.0.0.0");
}
