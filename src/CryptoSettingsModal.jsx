import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { api } from "./mailUi.js";
import { t } from "./i18n.js";
import { useModalFocus } from "./useModalFocus.js";

export default function CryptoSettingsModal({
  account,
  onClose,
  onChanged,
  setError,
}) {
  const dialog = useModalFocus(onClose, "select");
  const [state, setState] = useState({
    mode: account.crypto_mode || "none",
    sign: !!account.cryptoSignDefault,
    encrypt: !!account.cryptoEncryptDefault,
    hasPgpKey: !!account.hasPgpKey,
    hasSmimeCertificate: !!account.hasSmimeCertificate,
    smimeCertificateExpired: !!account.smimeCertificateExpired,
  });
  const [pgpPrivate, setPgpPrivate] = useState("");
  const [pgpPassphrase, setPgpPassphrase] = useState("");
  const [smimeFile, setSmimeFile] = useState(null);
  const [smimeCert, setSmimeCert] = useState("");
  const [smimeKey, setSmimeKey] = useState("");
  const [smimePassphrase, setSmimePassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api(`/accounts/${account.id}/crypto`)
      .then(setState)
      .catch((error) => setError(error.message));
  }, [account.id, setError]);
  async function perform(action) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      setState(await api(`/accounts/${account.id}/crypto`));
      await onChanged();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function importSmime() {
    let pkcs12Base64;
    if (smimeFile) {
      pkcs12Base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(smimeFile);
      });
    }
    await api(`/accounts/${account.id}/crypto/smime`, {
      method: "PUT",
      body: pkcs12Base64
        ? { pkcs12Base64, passphrase: smimePassphrase }
        : {
            certificate: smimeCert,
            privateKey: smimeKey,
            passphrase: smimePassphrase,
          },
    });
    setSmimeFile(null);
    setSmimeCert("");
    setSmimeKey("");
    setSmimePassphrase("");
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal crypto-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mailbox-crypto-title"
        ref={dialog}
      >
        <div className="modal-header">
          <div>
            <div className="eyebrow">{account.email}</div>
            <h2 id="mailbox-crypto-title">
              {t("Verschlüsselung und Schlüssel")}
            </h2>
            <p>
              {t("Private Schlüssel bleiben verschlüsselt auf deinem Server.")}
            </p>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label={t("Schließen")}
          >
            <X size={20} />
          </button>
        </div>
        <div className="crypto-scroll">
          <section>
            <h3>{t("Standard beim Schreiben")}</h3>
            <label>
              {t("Verfahren")}
              <select
                value={state.mode}
                onChange={(event) =>
                  setState((current) => ({
                    ...current,
                    mode: event.target.value,
                    sign: false,
                    encrypt: event.target.value !== "none",
                  }))
                }
              >
                <option value="none">{t("Aus")}</option>
                <option value="pgp">OpenPGP</option>
                <option value="smime">S/MIME</option>
              </select>
            </label>
            <div className="crypto-checks">
              <label>
                <input
                  type="checkbox"
                  checked={state.sign}
                  disabled={state.mode === "none"}
                  onChange={(event) =>
                    setState((current) => ({
                      ...current,
                      sign: event.target.checked,
                    }))
                  }
                />{" "}
                {t("Neue Nachrichten automatisch signieren")}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={state.encrypt}
                  disabled={state.mode === "none"}
                  onChange={(event) =>
                    setState((current) => ({
                      ...current,
                      encrypt: event.target.checked,
                    }))
                  }
                />{" "}
                {t(
                  "Automatisch verschlüsseln, wenn alle Empfänger Schlüssel haben",
                )}
              </label>
            </div>
            <p>
              {t(
                "Fehlt ein Empfängerschlüssel, wird ohne Verschlüsselung gesendet. Die Signatur bleibt aktiv, falls sie eingeschaltet ist.",
              )}
            </p>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() =>
                perform(() =>
                  api(`/accounts/${account.id}/crypto`, {
                    method: "PATCH",
                    body: {
                      mode: state.mode,
                      sign: state.sign,
                      encrypt: state.encrypt,
                    },
                  }),
                )
              }
            >
              {t("Standard speichern")}
            </button>
          </section>
          <section>
            <h3>OpenPGP</h3>
            <p>
              {state.hasPgpKey
                ? t("Privatschlüssel eingerichtet")
                : t("Kein Privatschlüssel eingerichtet")}
            </p>
            <label>
              {t("Armierter Privatschlüssel")}
              <textarea
                value={pgpPrivate}
                onChange={(event) => setPgpPrivate(event.target.value)}
                placeholder="-----BEGIN PGP PRIVATE KEY BLOCK-----"
                rows={4}
              />
            </label>
            <input
              type="file"
              accept=".asc,.pgp,.txt"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (file) setPgpPrivate(await file.text());
              }}
              aria-label={t("OpenPGP-Schlüsseldatei auswählen")}
            />
            <label>
              {t("Schlüsselpassphrase")}
              <input
                type="password"
                value={pgpPassphrase}
                onChange={(event) => setPgpPassphrase(event.target.value)}
                autoComplete="new-password"
              />
            </label>
            <div className="crypto-actions">
              <button
                className="primary-button"
                disabled={busy || !pgpPrivate}
                onClick={() =>
                  perform(async () => {
                    await api(`/accounts/${account.id}/crypto/pgp`, {
                      method: "PUT",
                      body: {
                        privateKey: pgpPrivate,
                        passphrase: pgpPassphrase,
                      },
                    });
                    setPgpPrivate("");
                    setPgpPassphrase("");
                  })
                }
              >
                {t("Schlüssel importieren")}
              </button>
              {state.hasPgpKey && (
                <button
                  disabled={busy}
                  onClick={() =>
                    perform(() =>
                      api(`/accounts/${account.id}/crypto/pgp`, {
                        method: "DELETE",
                      }),
                    )
                  }
                >
                  {t("Schlüssel entfernen")}
                </button>
              )}
            </div>
          </section>
          <section>
            <h3>S/MIME</h3>
            <p>
              {state.hasSmimeCertificate
                ? t("Zertifikat eingerichtet")
                : t("Kein Zertifikat eingerichtet")}
            </p>
            {state.smimeCertificateExpired && (
              <p className="crypto-expired">
                {t(
                  "Zertifikat abgelaufen: nur ältere Nachrichten entschlüsseln",
                )}
              </p>
            )}
            <label>
              {t("PKCS#12-Datei (.p12/.pfx)")}
              <input
                type="file"
                accept=".p12,.pfx"
                onChange={(event) =>
                  setSmimeFile(event.target.files?.[0] || null)
                }
              />
            </label>
            <p>
              {t("Alternativ Zertifikat und Privatschlüssel als PEM einfügen.")}
            </p>
            <label>
              {t("Zertifikat (PEM)")}
              <textarea
                value={smimeCert}
                onChange={(event) => setSmimeCert(event.target.value)}
                rows={3}
                placeholder="-----BEGIN CERTIFICATE-----"
              />
            </label>
            <label>
              {t("Privatschlüssel (PEM)")}
              <textarea
                value={smimeKey}
                onChange={(event) => setSmimeKey(event.target.value)}
                rows={3}
                placeholder="-----BEGIN PRIVATE KEY-----"
              />
            </label>
            <label>
              {t("Datei- oder Schlüsselpassphrase")}
              <input
                type="password"
                value={smimePassphrase}
                onChange={(event) => setSmimePassphrase(event.target.value)}
                autoComplete="new-password"
              />
            </label>
            <div className="crypto-actions">
              <button
                className="primary-button"
                disabled={busy || (!smimeFile && (!smimeCert || !smimeKey))}
                onClick={() => perform(importSmime)}
              >
                {t("Zertifikat importieren")}
              </button>
              {state.hasSmimeCertificate && (
                <button
                  disabled={busy}
                  onClick={() =>
                    perform(() =>
                      api(`/accounts/${account.id}/crypto/smime`, {
                        method: "DELETE",
                      }),
                    )
                  }
                >
                  {t("Zertifikat entfernen")}
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
