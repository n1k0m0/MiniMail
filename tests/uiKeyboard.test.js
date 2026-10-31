import test from "node:test";
import assert from "node:assert/strict";
import { handleMessageRowKeydown } from "../src/messageRowKeyboard.js";
import { handleModalKeydown } from "../src/useModalFocus.js";

test("message row keyboard actions ignore nested buttons", () => {
  const selected = [];
  const contexts = [];
  const row = {};
  const button = {};
  const select = (uid) => selected.push(uid);
  const context = (_event, uid) => contexts.push(uid);
  handleMessageRowKeydown(
    { key: "Enter", target: button, currentTarget: row },
    42,
    select,
    context,
  );
  handleMessageRowKeydown(
    { key: "Enter", target: row, currentTarget: row },
    42,
    select,
    context,
  );
  handleMessageRowKeydown(
    { key: "F10", shiftKey: true, target: row, currentTarget: row },
    42,
    select,
    context,
  );
  assert.deepEqual(selected, [42]);
  assert.deepEqual(contexts, [42]);
});

test("modal keyboard handling traps focus and closes on Escape", () => {
  const focused = [];
  const first = {
    getClientRects: () => [1],
    focus: () => focused.push("first"),
  };
  const last = { getClientRects: () => [1], focus: () => focused.push("last") };
  const dialog = {
    querySelectorAll: () => [first, last],
    contains: (element) => element === first || element === last,
  };
  let prevented = 0;
  let stopped = 0;
  let closed = 0;
  const event = (key, shiftKey = false) => ({
    key,
    shiftKey,
    preventDefault: () => prevented++,
    stopPropagation: () => stopped++,
  });
  handleModalKeydown(event("Tab"), dialog, () => closed++, last);
  handleModalKeydown(event("Tab", true), dialog, () => closed++, first);
  handleModalKeydown(event("Tab"), dialog, () => closed++, {});
  handleModalKeydown(event("Escape"), dialog, () => closed++, first);
  assert.deepEqual(focused, ["first", "last", "first"]);
  assert.equal(prevented, 4);
  assert.equal(stopped, 1);
  assert.equal(closed, 1);
});
