import fs from "node:fs";
// Schema 2 only adds nullable mailbox-local filter state. This reader can
// preserve it unchanged, allowing a compatible image rollback after upgrade.
export const schemaSupport = { schema: 2, readSchemaMin: 1, readSchemaMax: 2 };
let info;
try {
  info = JSON.parse(
    fs.readFileSync(new URL("../build-info.json", import.meta.url), "utf8"),
  );
} catch {
  info = {
    version: JSON.parse(
      fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ).version,
    revision: "development",
  };
}
export const buildInfo = Object.freeze({
  version: String(info.version),
  revision: String(info.revision),
  builtAt: String(info.builtAt || ""),
  ...schemaSupport,
});
