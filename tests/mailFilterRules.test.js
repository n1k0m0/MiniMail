import test from "node:test";
import assert from "node:assert/strict";
import {
  conditionMatches,
  ruleMatches,
  validateMailRule,
} from "../server/mailFilterRules.js";

const message = {
  uid: 7,
  envelope: {
    from: [{ address: "news@example.test", name: "Änne Example" }],
    to: [{ address: "one@example.test" }, { address: "two@example.test" }],
    cc: [{ address: "cc@example.test" }],
    subject: "ＴＥＳＴ: Invoice",
  },
  flags: new Set(["\\Flagged"]),
  bodyStructure: { childNodes: [{ disposition: "attachment" }] },
};
test("filter matching handles addresses, negative conditions, Unicode, booleans and AND/OR", () => {
  const c = (field, operator, value) =>
    conditionMatches({ field, operator, value }, message);
  assert.ok(c("from", "equals", "NEWS@example.test"));
  assert.ok(c("from", "contains", "ÄNNE"));
  assert.ok(c("from", "endsWith", "@example.test"));
  assert.ok(c("subject", "startsWith", "test:"));
  assert.ok(c("recipients", "equals", "cc@example.test"));
  assert.equal(c("to", "notEquals", "two@example.test"), false);
  assert.ok(c("to", "notContains", "absent"));
  assert.ok(c("seen", "is", "no"));
  assert.ok(c("flagged", "is", "yes"));
  assert.ok(c("attachment", "is", "yes"));
  const conditions = [
    { field: "from", operator: "contains", value: "absent" },
    { field: "seen", operator: "is", value: "no" },
  ];
  assert.equal(ruleMatches({ match: "all", conditions }, message), false);
  assert.equal(ruleMatches({ match: "any", conditions }, message), true);
  assert.ok(
    conditionMatches(
      { field: "body", operator: "contains", value: "Invoice" },
      message,
      new Map([["Invoice", new Set([7])]]),
    ),
  );
  assert.equal(
    conditionMatches(
      { field: "body", operator: "notContains", value: "Invoice" },
      message,
      new Map([["Invoice", new Set([7])]]),
    ),
    false,
  );
});
test("filter validation rejects arbitrary expressions, control characters and empty actions", () => {
  const rule = {
    name: "Invoices",
    enabled: true,
    match: "all",
    conditions: [{ field: "subject", operator: "contains", value: "Invoice" }],
    actions: { moveTo: "Invoices", seen: null, flagged: null },
  };
  assert.equal(validateMailRule(rule).stop, true);
  for (const patch of [
    { conditions: [] },
    { conditions: [{ field: "subject", operator: "regex", value: ".*" }] },
    { conditions: [{ field: "body", operator: "equals", value: "body" }] },
    {
      conditions: [
        { field: "from", operator: "contains", value: "bad\r\nvalue" },
      ],
    },
    { actions: { moveTo: null, seen: null, flagged: null } },
    { actions: { moveTo: "bad\nfolder", seen: null, flagged: null } },
    { enabled: "true" },
  ])
    assert.throws(() => validateMailRule({ ...rule, ...patch }));
});
