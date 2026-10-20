import test from "node:test";
import assert from "node:assert/strict";
import { isTrashFolder } from "../server/folderTypes.js";

test("nur Papierkorb-Ordner werden als solche erkannt", () => {
  assert.equal(isTrashFolder({ name: "Bin", specialUse: "\\Trash" }), true);
  assert.equal(isTrashFolder({ name: "Papierkorb" }), true);
  assert.equal(isTrashFolder({ name: "Deleted Items" }), true);
  assert.equal(isTrashFolder({ name: "Posteingang" }), false);
  assert.equal(
    isTrashFolder({ name: "Archiv", specialUse: "\\Archive" }),
    false,
  );
  assert.equal(
    isTrashFolder({ name: "Trash", specialUse: "\\Archive" }),
    false,
  );
  assert.equal(isTrashFolder(null), false);
});
