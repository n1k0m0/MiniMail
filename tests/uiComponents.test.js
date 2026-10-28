import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("extracted dialogs render and saved drafts retain all compose modes", async () => {
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
  });
  const noop = () => {};
  const account = {
    id: 1,
    email: "review@example.test",
    name: "Review",
    crypto_mode: "none",
  };
  try {
    const { default: Compose } = await vite.ssrLoadModule(
      "/src/ComposeModal.jsx",
    );
    for (const type of ["compose", "reply", "reply-all", "forward"]) {
      const html = renderToStaticMarkup(
        React.createElement(Compose, {
          account,
          accounts: [account],
          onClose: noop,
          onSent: noop,
          setError: noop,
          draft: {
            id: "saved",
            type,
            accountId: 1,
            to: "recipient@example.test",
            cc: "",
            bcc: "",
            subject: "Saved subject",
            text: "Saved message body",
            attachments: [{ name: "saved.txt", data: "aGVsbG8=" }],
            crypto: { mode: "pgp", sign: true, encrypt: true },
            inReplyTo: "<original@example.test>",
            references: ["<original@example.test>"],
          },
        }),
      );
      assert.ok(html.includes("Saved message body"), type);
      assert.ok(html.includes("saved.txt"), type);
      assert.ok(html.includes("Mit KI überarbeiten"), type);
    }
    for (const [name, props] of [
      ["AccountModal", {}],
      ["EmptyAccount", {}],
      ["EmptyTrashModal", { path: "Trash" }],
      [
        "SettingsModal",
        { accounts: [], auth: { user: { role: "admin", username: "review" } } },
      ],
      ["AddressBookModal", {}],
      ["CryptoSettingsModal", { account }],
      ["SourceModal", { accountId: 1, folder: "INBOX", uid: 1 }],
      ["AiSummaryModal", { accountId: 1, folder: "INBOX", uid: 1 }],
      [
        "AiRewriteModal",
        { body: "Draft", to: "", cc: "", subject: "", recipientNameHints: [] },
      ],
      ["DraftsModal", {}],
    ]) {
      const component = (await vite.ssrLoadModule(`/src/${name}.jsx`)).default;
      assert.ok(
        renderToStaticMarkup(
          React.createElement(component, {
            onClose: noop,
            setError: noop,
            ...props,
          }),
        ),
        name,
      );
    }
  } finally {
    await vite.close();
  }
});
