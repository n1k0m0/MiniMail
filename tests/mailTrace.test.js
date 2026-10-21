import assert from "node:assert/strict";
import test from "node:test";
import { traceFromSource } from "../server/mailTrace.js";

test("mail trace orders public relay IPs from oldest to newest", () => {
  const source = Buffer.from(
    [
      "Received: from relay.example (relay.example [1.1.1.1])\r\n",
      " by mailbox.example ([8.8.8.8]) with ESMTPS; Wed, 21 Oct 2026 12:00:00 +0000\r\n",
      "Received: from sender.example ([9.9.9.9])\r\n",
      " by relay.example ([1.1.1.1]); Wed, 21 Oct 2026 11:59:00 +0000\r\n",
      "Received: from local ([192.168.1.5]) by sender.example ([9.9.9.9]);\r\n",
      "Subject: Example\r\n\r\n",
      "Received: from forged ([4.4.4.4])\r\n",
    ].join(""),
  );
  const trace = traceFromSource(source, (ip) =>
    ip === "1.1.1.1"
      ? {
          city: { names: { de: "Beispielstadt", en: "Example City" } },
          country: { iso_code: "DE", names: { de: "Deutschland" } },
          location: { latitude: 51, longitude: 7 },
        }
      : null,
  );
  assert.equal(trace.receivedHeaders, 3);
  assert.deepEqual(
    trace.hops.map((hop) => hop.ip),
    ["9.9.9.9", "1.1.1.1", "8.8.8.8"],
  );
  assert.equal(trace.hops[1].city, "Beispielstadt");
  assert.equal(trace.hops[1].latitude, 51);
  assert.equal(trace.hops[0].latitude, null);
});

test("mail trace excludes private, reserved, and invalid addresses", () => {
  const trace = traceFromSource(
    "Received: from [IPv6:2001:4860:4860::8888] by [10.0.0.1]\n" +
      "Received: from [2001:db8::1] by [999.1.2.3]\n\nBody",
  );
  assert.deepEqual(
    trace.hops.map((hop) => hop.ip),
    ["2001:4860:4860::8888"],
  );
});
