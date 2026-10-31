import test from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import https from "node:https";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { limitedJson, untilAborted } from "../server/networkLimits.js";
import { remoteRequest } from "../server/calendarRemote.js";

test("JSON responses have a streaming byte limit, including missing or misleading length headers", async () => {
  assert.deepEqual(await limitedJson(Response.json({ text: "safe" }), 100), {
    text: "safe",
  });
  for (const headers of [
    {},
    { "Content-Length": "1" },
    { "Content-Length": "100000" },
  ]) {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array(60));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { headers },
    );
    await assert.rejects(limitedJson(response, 100), /size limit/);
    assert.equal(cancelled, true);
  }
});
test("network deadlines also cancel stalled DNS resolution", async (t) => {
  t.mock.method(dns, "lookup", () => new Promise(() => {}));
  const controller = new AbortController();
  const pending = remoteRequest(
    { url: "https://calendar.example.test/" },
    "GET",
    null,
    {},
    undefined,
    0,
    controller.signal,
  );
  controller.abort(new Error("Synthetic deadline"));
  await assert.rejects(pending, { status: 502 });
  await assert.rejects(
    untilAborted(Promise.resolve(1), controller.signal),
    /Synthetic deadline/,
  );
});
test("calendar redirects share one total deadline instead of resetting it per hop", async (t) => {
  t.mock.method(dns, "lookup", async () => [
    { address: "93.184.216.34", family: 4 },
  ]);
  const signals = [];
  t.mock.method(https, "request", (_url, options, callback) => {
    signals.push(options.signal);
    const request = new EventEmitter();
    request.end = () =>
      queueMicrotask(() => {
        const response = new PassThrough();
        response.statusCode = signals.length === 1 ? 307 : 200;
        response.headers =
          signals.length === 1 ? { location: "/redirected" } : {};
        callback(response);
        response.end("calendar");
      });
    return request;
  });
  const result = await remoteRequest({ url: "https://calendar.example.test/" });
  assert.equal(result.status, 200);
  assert.equal(signals.length, 2);
  assert.ok(signals[0] instanceof AbortSignal);
  assert.equal(signals[0], signals[1]);
});

test("calendar write redirects are errors and are never replayed", async (t) => {
  t.mock.method(dns, "lookup", async () => [
    { address: "93.184.216.34", family: 4 },
  ]);
  let calls = 0;
  t.mock.method(https, "request", (_url, _options, callback) => {
    calls++;
    const request = new EventEmitter();
    request.end = () =>
      queueMicrotask(() => {
        const response = new PassThrough();
        response.statusCode = 307;
        response.headers = { location: "/redirected" };
        callback(response);
        response.end();
      });
    return request;
  });
  for (const method of ["PUT", "DELETE"]) {
    await assert.rejects(
      remoteRequest({ url: "https://calendar.example.test/" }, method),
      { status: 502 },
    );
  }
  assert.equal(calls, 2);
});
