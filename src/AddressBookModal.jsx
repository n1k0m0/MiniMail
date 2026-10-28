import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { KeyRound, Mail, PenLine, Search, Trash2, X } from "lucide-react";
import { api } from "./mailUi.js";
import { t, choose } from "./i18n.js";

function ContactCryptoModal({ contact, onClose, onChanged, setError }) {
  const [pgp, setPgp] = useState("");
  const [certificate, setCertificate] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [discoveries, setDiscoveries] = useState([]);
  const [busy, setBusy] = useState(false);
  const loadDiscoveries = () =>
    api(`/contacts/${contact.id}/crypto/discoveries`).then(setDiscoveries);
  useEffect(() => {
    loadDiscoveries().catch((error) => setError(error.message));
  }, [contact.id, setError]);
  async function perform(kind, method, body) {
    setBusy(true);
    try {
      const result = await api(`/contacts/${contact.id}/crypto/${kind}`, {
        method,
        ...(body ? { body } : {}),
      });
      setFingerprint(result.fingerprint || "");
      await onChanged();
      await loadDiscoveries();
      if (kind === "pgp") setPgp("");
      else setCertificate("");
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function acceptDiscovery(item) {
    setBusy(true);
    try {
      const result = await api(
        `/contacts/${contact.id}/crypto/discoveries/${item.id}/accept`,
        { method: "POST" },
      );
      setFingerprint(result.fingerprint);
      await onChanged();
      await loadDiscoveries();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function readCertificate(file) {
    if (!file) return;
    const raw = await file.text();
    if (raw.includes("BEGIN CERTIFICATE")) {
      setCertificate(raw);
      return;
    }
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    setCertificate(
      `-----BEGIN CERTIFICATE-----\n${base64.match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----`,
    );
  }
  return createPortal(
    <div
      className="modal-backdrop contact-crypto-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal crypto-modal">
        <div className="modal-header">
          <div>
            <div className="eyebrow">{contact.email}</div>
            <h2>{t("Schlüssel und Zertifikate")}</h2>
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
            <h3>OpenPGP</h3>
            <p>
              {contact.hasPgpKey
                ? contact.pgpVerified
                  ? t("Öffentlicher Schlüssel vorhanden")
                  : t("Schlüssel automatisch gefunden – Fingerabdruck prüfen")
                : t("Kein öffentlicher Schlüssel vorhanden")}
            </p>
            <label>
              {t("Öffentlicher Schlüssel")}
              <textarea
                rows={5}
                value={pgp}
                onChange={(event) => setPgp(event.target.value)}
                placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----"
              />
            </label>
            <input
              type="file"
              accept=".asc,.pgp,.txt"
              aria-label={t("OpenPGP-Schlüsseldatei auswählen")}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (file) setPgp(await file.text());
              }}
            />
            <div className="crypto-actions">
              <button
                className="primary-button"
                disabled={busy || !pgp}
                onClick={() => perform("pgp", "PUT", { publicKey: pgp })}
              >
                {t("Schlüssel speichern")}
              </button>
              {contact.hasPgpKey && (
                <button
                  disabled={busy}
                  onClick={() => perform("pgp", "DELETE")}
                >
                  {t("Schlüssel entfernen")}
                </button>
              )}
            </div>
          </section>
          <section>
            <h3>S/MIME</h3>
            <p>
              {contact.hasSmimeCertificate
                ? contact.smimeVerified
                  ? t("Zertifikat vorhanden")
                  : t("Zertifikat automatisch gefunden – Fingerabdruck prüfen")
                : t("Kein Zertifikat vorhanden")}
            </p>
            <label>
              {t("Öffentliches Zertifikat (PEM oder DER)")}
              <textarea
                rows={5}
                value={certificate}
                onChange={(event) => setCertificate(event.target.value)}
                placeholder="-----BEGIN CERTIFICATE-----"
              />
            </label>
            <input
              type="file"
              accept=".pem,.crt,.cer,.der"
              aria-label={t("S/MIME-Zertifikatdatei auswählen")}
              onChange={(event) => readCertificate(event.target.files?.[0])}
            />
            <div className="crypto-actions">
              <button
                className="primary-button"
                disabled={busy || !certificate}
                onClick={() => perform("smime", "PUT", { certificate })}
              >
                {t("Zertifikat speichern")}
              </button>
              {contact.hasSmimeCertificate && (
                <button
                  disabled={busy}
                  onClick={() => perform("smime", "DELETE")}
                >
                  {t("Zertifikat entfernen")}
                </button>
              )}
            </div>
          </section>
          {discoveries.length > 0 && (
            <section className="key-discoveries">
              <h3>{t("Automatisch gefundene Schlüssel")}</h3>
              <p>
                {t(
                  "Prüfe den Fingerabdruck über einen zweiten Kanal, bevor du einen Schlüssel bestätigst oder ersetzt.",
                )}
              </p>
              {discoveries.map((item) => {
                const verified =
                  item.kind === "pgp"
                    ? contact.pgpVerified
                    : contact.smimeVerified;
                return (
                  <div className="discovered-key" key={item.id}>
                    <div>
                      <strong>
                        {item.kind === "pgp" ? "OpenPGP" : "S/MIME"}
                      </strong>
                      <span>{item.source}</span>
                      <code>{item.fingerprint}</code>
                      <small>
                        {item.active
                          ? verified
                            ? t("Aktiv und bestätigt")
                            : t("Gesammelt, noch nicht bestätigt")
                          : t(
                              "Weiterer Schlüssel – aktiven Schlüssel nicht ersetzt",
                            )}
                      </small>
                    </div>
                    {(!item.active || !verified) && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => acceptDiscovery(item)}
                      >
                        {t("Fingerabdruck bestätigt – verwenden")}
                      </button>
                    )}
                  </div>
                );
              })}
            </section>
          )}
          {fingerprint && (
            <p className="crypto-fingerprint">
              {t("Fingerabdruck")}: {fingerprint}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function AddressBookModal({ onClose, setError }) {
  const [contacts, setContacts] = useState([]);
  const [cryptoContact, setCryptoContact] = useState(null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api("/contacts")
      .then(setContacts)
      .catch((error) => setError(error.message));
  }, [setError]);
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await api(editing ? `/contacts/${editing}` : "/contacts", {
        method: editing ? "PUT" : "POST",
        body: { name, email },
      });
      setContacts(await api("/contacts"));
      setEditing(null);
      setName("");
      setEmail("");
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(contact) {
    if (
      !window.confirm(
        choose(
          `Kontakt „${contact.email}“ löschen?`,
          `Delete contact “${contact.email}”?`,
        ),
      )
    )
      return;
    try {
      await api(`/contacts/${contact.id}`, { method: "DELETE" });
      setContacts((current) =>
        current.filter((item) => item.id !== contact.id),
      );
      if (editing === contact.id) {
        setEditing(null);
        setName("");
        setEmail("");
      }
    } catch (error) {
      setError(error.message);
    }
  }
  const visible = contacts.filter((contact) =>
    `${contact.name} ${contact.email}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase()),
  );
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal contacts-modal">
        <div className="modal-header">
          <div>
            <div className="eyebrow">MINIMAIL</div>
            <h2>{t("Adressbuch")}</h2>
            <p>
              {choose(
                `${contacts.length} Kontakte`,
                `${contacts.length} contacts`,
              )}
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
        <div className="contacts-content">
          <div className="contacts-search">
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("Kontakte suchen …")}
              aria-label={t("Kontakte suchen …")}
            />
          </div>
          <div className="contacts-list">
            {visible.map((contact) => (
              <div className="contact-row" key={contact.id}>
                <div className="contact-avatar">
                  {(contact.name || contact.email)[0]?.toUpperCase()}
                </div>
                <div className="contact-info">
                  <strong>{contact.name || contact.email}</strong>
                  <span>{contact.email}</span>
                </div>
                {(contact.hasPgpKey || contact.hasSmimeCertificate) && (
                  <span className="contact-key-badges">
                    {contact.hasPgpKey && <small>PGP</small>}
                    {contact.hasSmimeCertificate && <small>S/MIME</small>}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setCryptoContact(contact)}
                  title={t("Schlüssel und Zertifikate")}
                >
                  <KeyRound size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(contact.id);
                    setName(contact.name);
                    setEmail(contact.email);
                  }}
                  title={t("Bearbeiten")}
                >
                  <PenLine size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => remove(contact)}
                  title={t("Entfernen")}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {!visible.length && (
              <div className="contacts-empty">
                {t("Keine Kontakte gefunden.")}
              </div>
            )}
          </div>
          <form className="contact-form" onSubmit={save}>
            <strong>
              {editing ? t("Kontakt bearbeiten") : t("Kontakt hinzufügen")}
            </strong>
            <div className="contact-form-fields">
              <label>
                {t("Name")}
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={200}
                />
              </label>
              <label>
                {t("E-Mail-Adresse")}
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  required
                  maxLength={254}
                />
              </label>
            </div>
            <div className="contact-form-actions">
              {editing && (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null);
                    setName("");
                    setEmail("");
                  }}
                >
                  {t("Abbrechen")}
                </button>
              )}
              <button className="primary-button" disabled={busy}>
                {t("Speichern")}
              </button>
            </div>
          </form>
        </div>
        {cryptoContact && (
          <ContactCryptoModal
            contact={cryptoContact}
            onClose={() => setCryptoContact(null)}
            onChanged={async () => {
              const next = await api("/contacts");
              setContacts(next);
              setCryptoContact(
                next.find((item) => item.id === cryptoContact.id) || null,
              );
            }}
            setError={setError}
          />
        )}
      </div>
    </div>
  );
}
