import test from "node:test";
import assert from "node:assert/strict";
import { mailDestination } from "../server/mailNetwork.js";

test("mail connections reject private and mixed DNS answers and preserve TLS hostname when pinning", async () => {
  const account = {
    imap_host: "IMAP.EXAMPLE.TEST",
    smtp_host: "smtp.example.test",
  };
  const lookup = (addresses) => async () =>
    addresses.map((address) => ({
      address,
      family: address.includes(":") ? 6 : 4,
    }));
  for (const address of [
    "127.0.0.1",
    "10.0.0.2",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "fe80::1",
    "fc00::1",
    "0.0.0.0",
  ])
    await assert.rejects(
      mailDestination(account, "imap", lookup([address])),
      /MAIL_ALLOWED_HOSTS/,
    );
  await assert.rejects(
    mailDestination(account, "imap", lookup(["93.184.216.34", "127.0.0.1"])),
    /MAIL_ALLOWED_HOSTS/,
  );
  assert.deepEqual(
    await mailDestination(account, "imap", lookup(["93.184.216.34"])),
    { host: "93.184.216.34", servername: "imap.example.test" },
  );
  assert.equal(
    (
      await mailDestination(
        account,
        "imap",
        lookup(["2606:4700:4700::1111", "93.184.216.34"]),
      )
    ).host,
    "93.184.216.34",
  );
  assert.equal(
    (await mailDestination(account, "imap", lookup(["2606:4700:4700::1111"])))
      .host,
    "2606:4700:4700::1111",
  );
  await assert.rejects(
    mailDestination(
      { imap_host: "https://outside.example.test" },
      "imap",
      lookup([]),
    ),
    /Hostname/,
  );
});
test("private mail destinations require an exact administrator allowlist entry", async () => {
  const previous = process.env.MAIL_ALLOWED_HOSTS;
  process.env.MAIL_ALLOWED_HOSTS = "imap.internal.example";
  try {
    const lookup = async () => [{ address: "10.0.0.5", family: 4 }];
    assert.equal(
      (
        await mailDestination(
          { imap_host: "imap.internal.example" },
          "imap",
          lookup,
        )
      ).host,
      "10.0.0.5",
    );
    await assert.rejects(
      mailDestination(
        { imap_host: "sub.imap.internal.example" },
        "imap",
        lookup,
      ),
      /MAIL_ALLOWED_HOSTS/,
    );
  } finally {
    if (previous === undefined) delete process.env.MAIL_ALLOWED_HOSTS;
    else process.env.MAIL_ALLOWED_HOSTS = previous;
  }
});
