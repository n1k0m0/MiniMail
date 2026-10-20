import test from "node:test";
import assert from "node:assert/strict";
import { buildFolderTree, visibleFolderNodes } from "../src/folderTree.js";

test("folder tree shows nested and selectable folders correctly", () => {
  const folders = [
    { path: "INBOX/Projekte/Alt", name: "Alt", delimiter: "/" },
    { path: "INBOX", name: "INBOX", delimiter: "/" },
    {
      path: "Gesendet",
      name: "Gesendet",
      delimiter: "/",
      specialUse: "\\Sent",
    },
    { path: "Archiv.2024", name: "2024", delimiter: "." },
  ];
  const tree = buildFolderTree(folders);
  assert.equal(tree[0].path, "INBOX");
  assert.equal(tree[1].path, "Gesendet");
  assert.equal(tree[0].children[0].path, "INBOX/Projekte");
  assert.equal(tree[0].children[0].folder, null);
  assert.equal(tree[0].children[0].children[0].folder, folders[0]);
  assert.equal(
    tree.find((node) => node.path === "Archiv").children[0].path,
    "Archiv.2024",
  );

  const collapsed = new Set(["INBOX"]);
  assert.deepEqual(
    visibleFolderNodes(tree, collapsed).map(({ node }) => node.path),
    ["INBOX", "Gesendet", "Archiv", "Archiv.2024"],
  );
  assert.deepEqual(
    visibleFolderNodes(tree, collapsed, "Alt").map(({ node }) => node.path),
    ["INBOX", "INBOX/Projekte", "INBOX/Projekte/Alt"],
  );
});
