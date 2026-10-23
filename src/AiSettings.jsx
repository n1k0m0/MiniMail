import React, { useEffect, useState } from "react";
import { KeyRound, LoaderCircle } from "lucide-react";
import { t } from "./i18n.js";

export default function AiSettings({ request, isAdmin, setError }) {
  const [settings, setSettings] = useState(null);
  const [model, setModel] = useState("gpt-4.1-mini");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    request("/settings/ai")
      .then((value) => {
        setSettings(value);
        setModel(value.model);
      })
      .catch((error) => setError(error.message));
  }, [request, setError]);
  async function save(removeKey = false) {
    setBusy(true);
    try {
      const next = await request("/settings/ai", {
        method: "PUT",
        body: {
          model: model.trim(),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          removeKey,
        },
      });
      setSettings(next);
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
              ? t("OpenAI ist eingerichtet.")
              : t("OpenAI ist noch nicht eingerichtet.")}
          </span>
          <span>{t("Nur auf Klick wird Mailtext an OpenAI gesendet.")}</span>
        </div>
        <KeyRound size={19} />
      </div>
      {isAdmin && (
        <div className="ai-settings-form">
          <label>
            {t("Modell")}
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              maxLength={80}
            />
          </label>
          <label>
            {t("OpenAI API-Schlüssel")}
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={
                settings?.configured
                  ? t("Schlüssel unverändert lassen")
                  : "sk-…"
              }
              autoComplete="off"
            />
          </label>
          <div className="ai-settings-actions">
            <button type="button" disabled={busy} onClick={() => save(false)}>
              {busy ? <LoaderCircle size={14} className="spin" /> : null}
              {t("Speichern")}
            </button>
            {settings?.configured && (
              <button type="button" disabled={busy} onClick={() => save(true)}>
                {t("API-Schlüssel entfernen")}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
