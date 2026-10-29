export async function untilAborted(promise, signal) {
  signal.throwIfAborted();
  let abort;
  const stopped = new Promise((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([promise, stopped]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export async function limitedJson(response, maxBytes = 2 * 1024 * 1024) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing JSON response body");
  const chunks = [];
  let bytes = 0,
    complete = false;
  try {
    if (Number(response.headers.get("content-length")) > maxBytes)
      throw new Error("JSON response exceeds size limit");
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("JSON response exceeds size limit");
      chunks.push(Buffer.from(value));
    }
    complete = true;
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
