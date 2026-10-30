import crypto from "node:crypto";
import { MailRuleError } from "./mailRuleStore.js";

export const textFields = ["from", "to", "cc", "recipients", "subject"];
export const textOperators = [
  "contains",
  "notContains",
  "equals",
  "notEquals",
  "startsWith",
  "endsWith",
];
export function validateMailRule(input, { id = crypto.randomUUID() } = {}) {
  if (
    !input ||
    typeof input !== "object" ||
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.trim().length > 120 ||
    typeof input.enabled !== "boolean" ||
    !["all", "any"].includes(input.match) ||
    !Array.isArray(input.conditions) ||
    !input.conditions.length ||
    input.conditions.length > 12
  )
    throw new MailRuleError(
      "Bitte Filtername, Verknüpfung und mindestens eine gültige Bedingung angeben.",
    );
  const conditions = input.conditions.map((condition) => {
    if (
      !condition ||
      typeof condition.field !== "string" ||
      typeof condition.operator !== "string" ||
      typeof condition.value !== "string"
    )
      throw new MailRuleError("Ungültige Filterbedingung.");
    const { field, operator } = condition,
      value = condition.value.trim();
    if (value.length > 500 || /[\x00-\x1f\x7f]/.test(value))
      throw new MailRuleError("Ein Filterwert ist ungültig oder zu lang.");
    if (textFields.includes(field) && textOperators.includes(operator) && value)
      return { field, operator, value };
    if (
      field === "body" &&
      ["contains", "notContains"].includes(operator) &&
      value
    )
      return { field, operator, value };
    if (
      ["seen", "flagged", "attachment"].includes(field) &&
      operator === "is" &&
      ["yes", "no"].includes(value)
    )
      return { field, operator, value };
    throw new MailRuleError("Diese Filterbedingung wird nicht unterstützt.");
  });
  const actions = input.actions;
  if (
    !actions ||
    typeof actions !== "object" ||
    ![null, true, false].includes(actions.seen) ||
    ![null, true, false].includes(actions.flagged) ||
    (actions.moveTo !== null &&
      (typeof actions.moveTo !== "string" ||
        !actions.moveTo ||
        actions.moveTo.length > 700 ||
        /[\x00-\x1f\x7f]/.test(actions.moveTo)))
  )
    throw new MailRuleError("Ungültige Filteraktion.");
  if (
    actions.moveTo === null &&
    actions.seen === null &&
    actions.flagged === null
  )
    throw new MailRuleError("Bitte mindestens eine Filteraktion auswählen.");
  return {
    id,
    name: input.name.trim(),
    enabled: input.enabled,
    match: input.match,
    conditions,
    actions: {
      moveTo: actions.moveTo,
      seen: actions.seen,
      flagged: actions.flagged,
    },
    stop: input.stop !== false,
  };
}
const normalized = (value) =>
  String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("de");
function addresses(list) {
  return (list || []).map((item) => ({
    address: normalized(item.address),
    display: normalized(`${item.name || ""} <${item.address || ""}>`),
  }));
}
function hasAttachment(structure, depth = 0) {
  if (!structure || depth > 30) return false;
  if (String(structure.disposition || "").toLowerCase() === "attachment")
    return true;
  return (structure.childNodes || []).some((child) =>
    hasAttachment(child, depth + 1),
  );
}
export function conditionMatches(condition, message, bodyMatches = new Map()) {
  const { field, operator } = condition,
    value = normalized(condition.value);
  if (field === "body") {
    const matched = bodyMatches.get(condition.value)?.has(message.uid) || false;
    return operator === "contains" ? matched : !matched;
  }
  if (["seen", "flagged", "attachment"].includes(field)) {
    const bool =
      field === "attachment"
        ? hasAttachment(message.bodyStructure)
        : message.flags?.has(field === "seen" ? "\\Seen" : "\\Flagged") ||
          false;
    return bool === (condition.value === "yes");
  }
  const envelope = message.envelope || {};
  const list =
    field === "subject"
      ? [
          {
            address: normalized(envelope.subject),
            display: normalized(envelope.subject),
          },
        ]
      : addresses(
          field === "recipients"
            ? [...(envelope.to || []), ...(envelope.cc || [])]
            : envelope[field],
        );
  const positive =
    operator === "notContains"
      ? "contains"
      : operator === "notEquals"
        ? "equals"
        : operator;
  const matched = list.some((item) =>
    positive === "equals"
      ? item.address === value || item.display === value
      : positive === "contains"
        ? item.display.includes(value)
        : positive === "startsWith"
          ? item.display.startsWith(value) || item.address.startsWith(value)
          : positive === "endsWith"
            ? item.display.endsWith(value) || item.address.endsWith(value)
            : false,
  );
  return operator.startsWith("not") ? !matched : matched;
}
export function ruleMatches(rule, message, bodyMatches) {
  return rule.match === "all"
    ? rule.conditions.every((condition) =>
        conditionMatches(condition, message, bodyMatches),
      )
    : rule.conditions.some((condition) =>
        conditionMatches(condition, message, bodyMatches),
      );
}
