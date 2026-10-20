import test from "node:test";
import assert from "node:assert/strict";

test("language selection translates UI text and persists the choice", async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  globalThis.document = { documentElement: { lang: "de" } };
  try {
    const { choose, dateLocale, getLanguage, setLanguage, t } =
      await import("../src/i18n.js");
    assert.equal(getLanguage(), "de");
    assert.equal(t("Abmelden"), "Abmelden");
    setLanguage("en");
    assert.equal(getLanguage(), "en");
    assert.equal(document.documentElement.lang, "en");
    assert.equal(storage.get("minimail-language"), "en");
    assert.equal(t("Abmelden"), "Sign out");
    assert.equal(t("\n  Neue Nachricht\n"), "\n  New message\n");
    assert.equal(t("imap_host fehlt."), "imap_host is required.");
    assert.equal(choose("Deutsch", "English"), "English");
    assert.equal(dateLocale(), "en-US");
    setLanguage("de");
    assert.equal(t("Abmelden"), "Abmelden");
    assert.equal(dateLocale(), "de-DE");
  } finally {
    delete globalThis.localStorage;
    delete globalThis.document;
  }
});
