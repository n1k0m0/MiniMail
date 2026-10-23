import React, { useEffect, useState } from "react";
import { KeyRound, LoaderCircle } from "lucide-react";
import { t } from "./i18n.js";

export default function AiSettings({ request, isAdmin, setError }) {
  const [settings, setSettings] = useState(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [rewriteMaxTokens, setRewriteMaxTokens] = useState("8192");
  const [summaryMaxTokens, setSummaryMaxTokens] = useState("4096");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    request("/settings/ai")
      .then((value) => {
        setSettings(value);
        setBaseUrl(value.baseUrl);
        setModel(value.model);
        setRewriteMaxTokens(value.rewriteMaxTokens?.toString() || "");
        setSummaryMaxTokens(value.summaryMaxTokens?.toString() || "");
      })
      .catch((error) => setError(error.message));
  }, [request, setError]);
  async function save({ removeKey = false, disable = false } = {}) {
    const tokenLimit = (value) =>
      value.trim() === ""
        ? null
        : /^[1-9]\d*$/.test(value.trim())
          ? Number(value.trim())
          : NaN;
    const rewriteLimit = tokenLimit(rewriteMaxTokens);
    const summaryLimit = tokenLimit(summaryMaxTokens);
    if (
      !disable &&
      ((rewriteLimit !== null && !Number.isSafeInteger(rewriteLimit)) ||
        (summaryLimit !== null && !Number.isSafeInteger(summaryLimit)))
    ) {
      setError(t("Bitte eine positive ganze Zahl oder leer eingeben."));
      return;
    }
    setBusy(true);
    try {
      const next = await request("/settings/ai", {
        method: "PUT",
        body: {
          baseUrl: baseUrl.trim(),
          model: model.trim(),
          rewriteMaxTokens: rewriteLimit,
          summaryMaxTokens: summaryLimit,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          removeKey,
          disable,
        },
      });
      setSettings(next);
      setBaseUrl(next.baseUrl);
      setModel(next.model);
      setRewriteMaxTokens(next.rewriteMaxTokens?.toString() || "");
      setSummaryMaxTokens(next.summaryMaxTokens?.toString() || "");
      setApiKey("");
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h3>{t("KI-Funktionen")}</h3>
      <div className="settings-row">
        <div>
          <strong>{t("Text überarbeiten und Mails zusammenfassen")}</strong>
          <span>
            {settings?.configured
              ? t("Eigene KI ist eingerichtet.")
              : t("Eigene KI ist noch nicht eingerichtet.")}
          </span>
          <span>
            {t("Nur auf Klick wird Mailtext an deinen KI-Server gesendet.")}
          </span>
        </div>
        <KeyRound size={19} />
      </div>
      {isAdmin && (
        <div className="ai-settings-form">
          <label>
            {t("OpenAI-kompatible Basis-URL")}
            <input
              type="url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="http://host.docker.internal:11434/v1"
              maxLength={500}
              autoComplete="off"
            />
          </label>
          <label>
            {t("Modell")}
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              maxLength={128}
              placeholder={t("Modell-ID deiner eigenen KI")}
            />
          </label>
          <label>
            {t("API-Schlüssel (falls erforderlich)")}
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={
                settings?.hasKey
                  ? t("Schlüssel unverändert lassen")
                  : t("Optional bei lokaler KI")
              }
              autoComplete="off"
            />
          </label>
          <div className="ai-token-grid">
            <label>
              {t("Ausgabetokens: Text überarbeiten")}
              <input
                type="number"
                min="1"
                step="1"
                value={rewriteMaxTokens}
                onChange={(event) => setRewriteMaxTokens(event.target.value)}
                placeholder={t("Kein MiniMail-Limit")}
              />
            </label>
            <label>
              {t("Ausgabetokens: Zusammenfassen")}
              <input
                type="number"
                min="1"
                step="1"
                value={summaryMaxTokens}
                onChange={(event) => setSummaryMaxTokens(event.target.value)}
                placeholder={t("Kein MiniMail-Limit")}
              />
            </label>
          </div>
          <p className="ai-token-hint">
            {t(
              "Leer lassen: MiniMail setzt kein Tokenlimit. Dein KI-Server kann eigene Grenzen haben.",
            )}
          </p>
          <div className="ai-settings-actions">
            <button type="button" disabled={busy} onClick={() => save()}>
              {busy ? <LoaderCircle size={14} className="spin" /> : null}
              {t("Speichern")}
            </button>
            {settings?.hasKey && (
              <button
                type="button"
                disabled={busy}
                onClick={() => save({ removeKey: true })}
              >
                {t("API-Schlüssel entfernen")}
              </button>
            )}
            {settings?.configured && (
              <button
                type="button"
                disabled={busy}
                onClick={() => save({ disable: true })}
              >
                {t("KI deaktivieren")}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
