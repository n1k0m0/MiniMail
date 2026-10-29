import test from "node:test";
import assert from "node:assert/strict";
import {
  accountCredentials,
  AccountInputError,
} from "../server/accountCredentials.js";
import { encrypt } from "../server/security.js";

const settings = {
  imap_host: "imap.example.test",
  imap_port: 993,
  imap_secure: true,
  smtp_host: "smtp.example.test",
  smtp_port: 465,
  smtp_secure: true,
  username: "owner",
  smtp_username: "smtp-owner",
  vpn_profile: "",
};
const existing = {
  ...settings,
  password_enc: encrypt("imap-secret"),
  smtp_password_enc: encrypt("smtp-secret"),
};
test("stored mailbox passwords are scoped to their authentication targets", () => {
  assert.deepEqual(accountCredentials(settings, existing), {
    password: "imap-secret",
    smtp_password: "smtp-secret",
  });
  assert.equal(
    accountCredentials(
      { ...settings, imap_host: "IMAP.EXAMPLE.TEST " },
      existing,
    ).password,
    "imap-secret",
  );
  for (const change of [
    { imap_host: "outside.example.test" },
    { imap_port: 143 },
    { imap_secure: false },
    { username: "someone-else" },
    { smtp_host: "outside.example.test" },
    { smtp_port: 587 },
    { smtp_secure: false },
    { smtp_username: "someone-else" },
    { vpn_profile: "another-route" },
  ])
    assert.throws(
      () => accountCredentials({ ...settings, ...change }, existing),
      AccountInputError,
    );
  assert.deepEqual(
    accountCredentials(
      {
        ...settings,
        imap_host: "new.example.test",
        smtp_host: "new.example.test",
        password: "new-imap",
        smtp_password: "new-smtp",
      },
      existing,
    ),
    { password: "new-imap", smtp_password: "new-smtp" },
  );
});
test("SMTP password fallback cannot forward an old IMAP secret to a changed SMTP target", () => {
  const inherited = {
    ...existing,
    smtp_username: null,
    smtp_password_enc: null,
  };
  const body = {
    ...settings,
    smtp_username: "",
    smtp_host: "outside.example.test",
  };
  assert.throws(() => accountCredentials(body, inherited), AccountInputError);
  assert.equal(
    accountCredentials({ ...body, smtp_password: "explicit-smtp" }, inherited)
      .smtp_password,
    "explicit-smtp",
  );
  assert.equal(
    accountCredentials({ ...body, password: "explicit-fallback" }, inherited)
      .password,
    "explicit-fallback",
  );
});
