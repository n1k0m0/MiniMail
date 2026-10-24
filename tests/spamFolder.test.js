import test from "node:test";
import assert from "node:assert/strict";
import { findSpamFolder } from "../src/spamFolder.js";

test("spam folder prefers IMAP special use over a folder merely named Spam", () => {
  const folders = [
    { path: "Spam", name: "Spam" },
    { path: "INBOX.ProviderJunk", name: "Unwanted", specialUse: "\\Junk" },
  ];
  assert.equal(findSpamFolder(folders), folders[1]);
});

test("spam folder recognizes common German and English provider names and paths", () => {
  for (const name of [
    "Spam",
    "JUNK",
    "Junk E-mail",
    "Junk Email",
    "Junk-Mail",
    "Junk-E-Mail",
    "Unerwünscht",
    "Unerwünschte E-Mails",
  ]) {
    const folder = { path: `INBOX/${name}`, name };
    assert.equal(findSpamFolder([folder]), folder, name);
  }
  const nested = { path: "INBOX.Spam", delimiter: "." };
  assert.equal(findSpamFolder([nested]), nested);
});

test("spam folder does not select unrelated, nonselectable or conflicting folders", () => {
  assert.equal(findSpamFolder([]), undefined);
  assert.equal(
    findSpamFolder([
      { path: "INBOX", name: "Inbox", specialUse: "\\Inbox" },
      { path: "Spam reports", name: "Spam reports" },
      { path: "Not spam", name: "Not spam" },
      { path: "Archive", name: "Spam", specialUse: "\\Archive" },
      { path: "Junk", specialUse: "\\Junk", flags: new Set(["\\Noselect"]) },
    ]),
    undefined,
  );
});

test("spam folder resolution stays scoped to the respective mailbox", () => {
  const personal = [{ path: "Spam", name: "Spam" }];
  const work = [{ path: "INBOX.Junk", specialUse: "\\Junk" }];
  assert.equal(findSpamFolder(personal).path, "Spam");
  assert.equal(findSpamFolder(work).path, "INBOX.Junk");
  assert.equal(findSpamFolder([{ path: "INBOX" }]), undefined);
});
