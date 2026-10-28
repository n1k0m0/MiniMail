import test from "node:test";
import assert from "node:assert/strict";
import { attachmentFile, encodeAttachments } from "../src/draftFiles.js";

test("saved draft attachments round-trip binary content, Unicode filenames and empty files", async () => {
  const bytes = Uint8Array.from({ length: 20000 }, (_, index) => index % 256);
  const files = [new File([bytes], "Grüße.bin"), new File([], "empty.txt")];
  const encoded = await encodeAttachments(files);
  const restored = encoded.map(attachmentFile);
  assert.deepEqual(
    restored.map((file) => file.name),
    ["Grüße.bin", "empty.txt"],
  );
  assert.deepEqual(new Uint8Array(await restored[0].arrayBuffer()), bytes);
  assert.equal(restored[1].size, 0);
});
