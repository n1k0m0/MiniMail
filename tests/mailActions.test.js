import test from "node:test";
import assert from "node:assert/strict";
import {
  deleteMailboxMessage,
  MailOperationError,
} from "../server/mailActions.js";

function fixture(folders, moved = true) {
  const calls = [];
  return {
    calls,
    list: async () => folders,
    getMailboxLock: async (folder) => {
      calls.push(["lock", folder]);
      return { release: () => calls.push(["release"]) };
    },
    messageMove: async (...args) => {
      calls.push(["move", ...args]);
      return moved;
    },
    messageDelete: async (...args) => {
      calls.push(["delete", ...args]);
      return true;
    },
  };
}

test("deleting mail never permanently deletes when a selectable Trash is missing", async () => {
  for (const folders of [
    [],
    [{ name: "Trash", path: "Archive", specialUse: "\\Archive" }],
    [
      {
        name: "Trash",
        path: "Trash",
        specialUse: "\\Trash",
        flags: new Set(["\\Noselect"]),
      },
    ],
  ]) {
    const client = fixture(folders);
    await assert.rejects(
      deleteMailboxMessage(client, "INBOX", 42),
      MailOperationError,
    );
    assert.deepEqual(
      client.calls,
      [],
      "no move, expunge or mailbox selection is attempted",
    );
  }
});

test("mail deletion uses the provider Trash, recognizes localized names and releases the lock on failure", async () => {
  const client = fixture([
    { path: "Other", name: "Trash" },
    { path: "ProviderBin", name: "Bin", specialUse: "\\Trash" },
  ]);
  await deleteMailboxMessage(client, "INBOX", 42);
  assert.deepEqual(client.calls, [
    ["lock", "INBOX"],
    ["move", 42, "ProviderBin", { uid: true }],
    ["release"],
  ]);
  const permanent = fixture([{ path: "ProviderBin", specialUse: "\\Trash" }]);
  await deleteMailboxMessage(permanent, "ProviderBin", 42);
  assert.deepEqual(permanent.calls, [
    ["lock", "ProviderBin"],
    ["delete", 42, { uid: true }],
    ["release"],
  ]);
  const failed = fixture(
    [{ path: "Deleted Items", name: "Deleted Items" }],
    false,
  );
  await assert.rejects(
    deleteMailboxMessage(failed, "INBOX", 42),
    MailOperationError,
  );
  assert.deepEqual(failed.calls, [
    ["lock", "INBOX"],
    ["move", 42, "Deleted Items", { uid: true }],
    ["release"],
  ]);
});
