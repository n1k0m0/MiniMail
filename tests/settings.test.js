import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { settingsPage, settingsPages } from "../src/settingsPages.js";

test("settings navigation limits administration to admins and rejects unknown pages", () => {
  assert.deepEqual(
    settingsPages("user").map((page) => page.id),
    ["mailboxes", "filters", "contacts", "appearance", "security", "ai"],
  );
  assert.equal(settingsPages("admin").at(-1).id, "users");
  assert.equal(settingsPage("user", "users").id, "mailboxes");
  assert.equal(settingsPage("admin", "unknown").id, "mailboxes");
});

test("settings pages render separately for each role without exposing admin controls", async () => {
  const vite = await createServer({
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  try {
    const { default: Settings } = await vite.ssrLoadModule(
      "/src/SettingsModal.jsx",
    );
    const props = {
      accounts: [
        {
          id: 1,
          name: "Personal mailbox",
          email: "own@example.test",
          is_primary: true,
          check_interval_minutes: 5,
        },
      ],
      setError() {},
    };
    for (const role of ["user", "admin"]) {
      for (const page of settingsPages(role)) {
        const html = renderToStaticMarkup(
          React.createElement(Settings, {
            ...props,
            page: page.id,
            auth: {
              user: { username: "review", role, twoFactorEnabled: true },
            },
          }),
        );
        assert.ok(
          html.includes(`id="settings-page-${page.id}"`),
          `${role}: ${page.id} is visible`,
        );
        assert.equal(
          (html.match(/class="settings-page"/g) || []).length,
          1,
          "unvisited pages must not mount or request their data",
        );
        assert.ok(html.includes('role="dialog" aria-modal="true"'));
        if (role === "user") {
          assert.ok(
            !html.includes('aria-controls="settings-page-users"'),
            "user-management navigation is hidden",
          );
          assert.ok(
            !html.includes('class="new-user-form"'),
            "user-management form is not rendered",
          );
          assert.ok(
            !html.includes('class="ai-settings-form"'),
            "global AI configuration is not rendered",
          );
        }
        if (page.id === "mailboxes")
          assert.ok(html.includes("own@example.test"));
        if (page.id === "appearance")
          assert.ok(
            html.includes(
              'aria-label="Gelesene E-Mails ausblenden" aria-pressed="false"',
            ),
          );
        if (page.id === "users")
          assert.ok(html.includes('class="new-user-form"'));
      }
    }
    const forged = renderToStaticMarkup(
      React.createElement(Settings, {
        ...props,
        page: "users",
        auth: { user: { username: "member", role: "user" } },
      }),
    );
    assert.ok(forged.includes('id="settings-page-mailboxes"'));
    assert.ok(!forged.includes('class="new-user-form"'));
  } finally {
    await vite.close();
  }
});
