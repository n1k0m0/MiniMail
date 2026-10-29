import { t, dateLocale } from "./i18n.js";

export const PAGE_SIZE = 60;

export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-MiniMail-Request": "1" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(t(payload.error || `HTTP ${response.status}`));
  return payload;
}
export const fmtAddress = (list) =>
  list?.map((item) => item.name || item.address).join(", ") || t("Unbekannt");
export const fullAddress = (list) =>
  list
    ?.map((item) =>
      item.name ? `${item.name} <${item.address}>` : item.address,
    )
    .join(", ") || "";
export function dateLabel(value) {
  if (!value) return "";
  const date = new Date(value),
    today = new Date();
  if (date.toDateString() === today.toDateString())
    return new Intl.DateTimeFormat(dateLocale(), {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  return new Intl.DateTimeFormat(dateLocale(), {
    day: "2-digit",
    month: "short",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  }).format(date);
}
