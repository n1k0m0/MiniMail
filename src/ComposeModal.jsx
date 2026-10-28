import { useState, useEffect, useRef } from "react";
import {
  LoaderCircle,
  LockKeyhole,
  Paperclip,
  Send,
  Sparkles,
  Undo2,
  X,
  Save,
} from "lucide-react";
import { api, fmtAddress, fullAddress } from "./mailUi.js";
import { t, choose, dateLocale } from "./i18n.js";
import { attachmentFile, encodeAttachments } from "./draftFiles.js";
import { replyRecipients } from "./replyRecipients.js";
import AiRewriteModal from "./AiRewriteModal.jsx";

function RecipientInput({ value, onChange, contacts, placeholder, label }) {
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const token = value.split(/[,;]/).at(-1)?.trim().toLocaleLowerCase() || "";
  const suggestions =
    focused && token.length >= 1
      ? contacts
          .filter((item) =>
            `${item.name} ${item.email}`.toLocaleLowerCase().includes(token),
          )
          .slice(0, 6)
      : [];
  function chooseContact(contact) {
    const start = Math.max(value.lastIndexOf(","), value.lastIndexOf(";"));
    onChange(
      `${start < 0 ? "" : `${value.slice(0, start + 1).trim()} `}${contact.email}, `,
    );
    setActive(0);
  }
  return (
    <div className="recipient-input">
      <input
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setActive(0);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setFocused(false);
          if (!suggestions.length) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setActive(
              (current) =>
                (current +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  suggestions.length) %
                suggestions.length,
            );
          }
          if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            chooseContact(suggestions[active] || suggestions[0]);
          }
        }}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
      />
      {!!suggestions.length && (
        <div className="recipient-suggestions" role="listbox">
          {suggestions.map((contact, index) => (
            <button
              type="button"
              role="option"
              aria-selected={index === active}
              className={index === active ? "selected" : ""}
              key={contact.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseContact(contact)}
            >
              <strong>{contact.name || contact.email}</strong>
              {contact.name && <span>{contact.email}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ComposeModal({
  account,
  accounts,
  initial,
  draft,
  onClose,
  onSent,
  setError,
}) {
  const composeType = draft?.type || initial?.type || "compose";
  const [draftId] = useState(() => draft?.id || crypto.randomUUID());
  const replyAll = composeType === "reply-all",
    reply = composeType === "reply" || replyAll,
    forward = composeType === "forward",
    original = initial?.message;
  const initialRecipients =
    reply && original
      ? replyRecipients(
          original,
          accounts.map((item) => item.email),
          replyAll,
        )
      : { to: "", cc: "" };
  const [to, setTo] = useState(draft?.to ?? initialRecipients.to);
  const [cc, setCc] = useState(draft?.cc ?? initialRecipients.cc);
  const [bcc, setBcc] = useState(draft?.bcc ?? "");
  const [contacts, setContacts] = useState([]);
  useEffect(() => {
    api("/contacts")
      .then(setContacts)
      .catch((error) => setError(error.message));
  }, [setError]);
  const [subject, setSubject] = useState(
    draft?.subject ??
      (original
        ? `${reply ? "Re" : "Fwd"}: ${original.subject.replace(/^(Re|Fwd):\s*/i, "")}`
        : ""),
  );
  const [body, setBody] = useState(
    draft?.text ??
      (forward
        ? choose(
            `\n\n---------- Weitergeleitete Nachricht ----------\nVon: ${fullAddress(original.from)}\nDatum: ${original.date ? new Date(original.date).toLocaleString(dateLocale()) : ""}\nBetreff: ${original.subject}\n\n${original.text || ""}`,
            `\n\n---------- Forwarded message ----------\nFrom: ${fullAddress(original.from)}\nDate: ${original.date ? new Date(original.date).toLocaleString(dateLocale()) : ""}\nSubject: ${original.subject}\n\n${original.text || ""}`,
          )
        : reply
          ? choose(
              `\n\nAm ${original.date ? new Date(original.date).toLocaleString(dateLocale()) : ""} schrieb ${fmtAddress(original.from)}:\n`,
              `\n\nOn ${original.date ? new Date(original.date).toLocaleString(dateLocale()) : ""}, ${fmtAddress(original.from)} wrote:\n`,
            ) +
            (original.text || "")
              .split("\n")
              .map((line) => `> ${line}`)
              .join("\n")
          : ""),
  );
  const [files, setFiles] = useState(() =>
    (draft?.attachments || []).map(attachmentFile),
  );
  const [aiOpen, setAiOpen] = useState(false);
  const [aiHistory, setAiHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [showCc, setShowCc] = useState(Boolean(initialRecipients.cc));
  const [showBcc, setShowBcc] = useState(false);
  const [senderAccountId, setSenderAccountId] = useState(
    draft?.accountId ??
      (account && !account.needsCredentials
        ? account.id
        : accounts.find((item) => !item.needsCredentials)?.id ||
          account?.id ||
          null),
  );
  const senderAccount = accounts.find((item) => item.id === senderAccountId);
  function cryptoForSender(selectedAccount) {
    const mode = selectedAccount?.crypto_mode || "none";
    const replyMode =
      original?.security?.encrypted &&
      ["pgp", "smime"].includes(original.security.kind)
        ? original.security.kind
        : null;
    const selectedMode =
      replyMode &&
      (replyMode === "pgp"
        ? selectedAccount?.hasPgpKey
        : selectedAccount?.hasSmimeCertificate &&
          !selectedAccount?.smimeCertificateExpired)
        ? replyMode
        : mode;
    return {
      mode: selectedMode,
      sign: selectedMode === mode && !!selectedAccount?.cryptoSignDefault,
      encrypt:
        !!replyMode && selectedMode === replyMode
          ? true
          : selectedMode === mode && !!selectedAccount?.cryptoEncryptDefault
            ? "auto"
            : false,
    };
  }
  const [cryptoOptions, setCryptoOptions] = useState(
    () => draft?.crypto || cryptoForSender(senderAccount),
  );
  const previousSender = useRef(senderAccountId);
  useEffect(() => {
    if (previousSender.current === senderAccountId) return;
    previousSender.current = senderAccountId;
    setCryptoOptions(cryptoForSender(senderAccount));
  }, [senderAccountId]);
  const [encryptionStatus, setEncryptionStatus] = useState(null);
  useEffect(() => {
    if (
      cryptoOptions.encrypt !== "auto" ||
      cryptoOptions.mode === "none" ||
      !senderAccount
    ) {
      setEncryptionStatus(null);
      return;
    }
    const controller = new AbortController();
    setEncryptionStatus({ checking: true });
    const timer = setTimeout(() => {
      api(`/accounts/${senderAccount.id}/crypto/availability`, {
        method: "POST",
        body: { to, cc, bcc, mode: cryptoOptions.mode },
        signal: controller.signal,
      })
        .then(setEncryptionStatus)
        .catch((error) => {
          if (error.name !== "AbortError")
            setEncryptionStatus({ available: false, reason: error.message });
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [senderAccountId, cryptoOptions.mode, cryptoOptions.encrypt, to, cc, bcc]);
  const signature = senderAccount?.signature?.trim() || "";
  const signatureText = signature
    ? `${signature.startsWith("-- ") ? "" : "-- \n"}${signature}`
    : "";
  const replyHeaders = draft
    ? {
        ...(draft.inReplyTo ? { inReplyTo: draft.inReplyTo } : {}),
        ...(draft.references ? { references: draft.references } : {}),
      }
    : reply && original?.messageId
      ? {
          inReplyTo: original.messageId,
          references: [
            ...(original.references || []),
            original.messageId,
          ].slice(-30),
        }
      : {};
  const snapshot = JSON.stringify({
    to,
    cc,
    bcc,
    subject,
    body,
    senderAccountId,
    cryptoOptions,
    files: files.map((file) => [file.name, file.size, file.lastModified]),
  });
  const initialSnapshot = useRef(draft ? snapshot : "");
  const [savedSnapshot, setSavedSnapshot] = useState(initialSnapshot.current);
  const [saved, setSaved] = useState(false);
  const dirty =
    snapshot !== savedSnapshot &&
    !!(to || cc || bcc || subject || body || files.length || draft || saved);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    function beforeUnload(event) {
      if (!dirty && !busy) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, busy]);
  function requestClose() {
    if (busy) return;
    if (dirty) setClosing(true);
    else onClose();
  }
  async function saveDraft(closeAfter = false) {
    if (busy || !senderAccount) return;
    setBusy(true);
    try {
      await api(`/drafts/${draftId}`, {
        method: "PUT",
        body: {
          accountId: senderAccountId,
          type: composeType,
          to,
          cc,
          bcc,
          subject,
          text: body,
          attachments: await encodeAttachments(files),
          crypto: cryptoOptions,
          ...replyHeaders,
        },
      });
      setSavedSnapshot(snapshot);
      setSaved(true);
      if (closeAfter) onClose();
      else setClosing(false);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (!senderAccount || senderAccount.needsCredentials) {
      setError(t("Bitte zuerst ein Postfach verbinden."));
      return;
    }
    setBusy(true);
    try {
      const attachments = await encodeAttachments(files);
      const result = await api(`/accounts/${senderAccount.id}/send`, {
        method: "POST",
        body: {
          to,
          cc,
          bcc,
          subject,
          text: signatureText ? `${body.trimEnd()}\n\n${signatureText}` : body,
          attachments,
          crypto:
            cryptoOptions.sign || cryptoOptions.encrypt
              ? cryptoOptions
              : { mode: "none", sign: false, encrypt: false },
          ...replyHeaders,
          draftId,
        },
      });
      onSent(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div
        className="modal-backdrop compose-backdrop"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            requestClose();
          }
        }}
      >
        <div
          className="modal compose-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="compose-title"
        >
          <div className="compose-header">
            <div>
              <h2 id="compose-title">
                {reply
                  ? replyAll
                    ? t("Allen antworten")
                    : t("Antworten")
                  : forward
                    ? t("Weiterleiten")
                    : t("Neue Nachricht")}
              </h2>
            </div>
            <button
              className="icon-button"
              onClick={requestClose}
              disabled={busy}
              aria-label={t("Schließen")}
            >
              <X size={20} />
            </button>
          </div>
          <form onSubmit={submit}>
            <fieldset disabled={busy || closing} className="compose-editor">
              <div className="compose-fields">
                <div className="compose-field">
                  <span>{t("Von")}</span>
                  <select
                    aria-label={t("Absenderadresse")}
                    value={senderAccountId || ""}
                    onChange={(event) =>
                      setSenderAccountId(Number(event.target.value))
                    }
                  >
                    {!senderAccount && (
                      <option value={senderAccountId || ""} disabled>
                        {t("Bitte Absender wählen")}
                      </option>
                    )}
                    {accounts.map((item) => (
                      <option
                        key={item.id}
                        value={item.id}
                        disabled={item.needsCredentials}
                      >
                        {item.email}
                        {item.needsCredentials
                          ? ` (${t("Passwort fehlt")})`
                          : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="compose-field">
                  <span>{t("An")}</span>
                  <RecipientInput
                    value={to}
                    onChange={setTo}
                    contacts={contacts}
                    placeholder={t("Empfänger-Adresse")}
                    label={t("An")}
                  />
                  <button type="button" onClick={() => setShowCc(!showCc)}>
                    Cc
                  </button>
                  <button type="button" onClick={() => setShowBcc(!showBcc)}>
                    Bcc
                  </button>
                </div>
                {(showCc || !!cc.trim()) && (
                  <div className="compose-field">
                    <span>{t("Cc")}</span>
                    <RecipientInput
                      value={cc}
                      onChange={setCc}
                      contacts={contacts}
                      placeholder={t("Kopie an")}
                      label="Cc"
                    />
                  </div>
                )}
                {(showBcc || !!bcc.trim()) && (
                  <div className="compose-field">
                    <span>Bcc</span>
                    <RecipientInput
                      value={bcc}
                      onChange={setBcc}
                      contacts={contacts}
                      placeholder={t("Blindkopie an")}
                      label="Bcc"
                    />
                  </div>
                )}
                <div className="compose-field">
                  <span>{t("Betreff")}</span>
                  <input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder={t("Worum geht es?")}
                  />
                </div>
              </div>
              <div className="compose-tools">
                <div className="compose-security">
                  <LockKeyhole size={15} />
                  <select
                    aria-label={t("Verschlüsselungsverfahren")}
                    value={cryptoOptions.mode}
                    onChange={(event) =>
                      setCryptoOptions({
                        mode: event.target.value,
                        sign: false,
                        encrypt: event.target.value === "none" ? false : "auto",
                      })
                    }
                  >
                    <option value="none">
                      {t("Ohne Ende-zu-Ende-Schutz")}
                    </option>
                    <option value="pgp">OpenPGP</option>
                    <option value="smime">S/MIME</option>
                  </select>
                  <label>
                    <input
                      type="checkbox"
                      disabled={cryptoOptions.mode === "none"}
                      checked={cryptoOptions.sign}
                      onChange={(event) =>
                        setCryptoOptions((current) => ({
                          ...current,
                          sign: event.target.checked,
                        }))
                      }
                    />{" "}
                    {t("Signieren")}
                  </label>
                  <label>
                    {t("Verschlüsselung")}
                    <select
                      aria-label={t("Verschlüsselung")}
                      disabled={cryptoOptions.mode === "none"}
                      value={
                        cryptoOptions.encrypt === "auto"
                          ? "auto"
                          : cryptoOptions.encrypt
                            ? "on"
                            : "off"
                      }
                      onChange={(event) =>
                        setCryptoOptions((current) => ({
                          ...current,
                          encrypt:
                            event.target.value === "auto"
                              ? "auto"
                              : event.target.value === "on",
                        }))
                      }
                    >
                      <option value="off">{t("Aus")}</option>
                      <option value="auto">{t("Automatisch")}</option>
                      <option value="on">{t("Erzwingen")}</option>
                    </select>
                  </label>
                  {cryptoOptions.encrypt === "auto" && (
                    <span
                      className={`compose-encryption-status${encryptionStatus?.available ? " available" : encryptionStatus && !encryptionStatus.checking ? " unavailable" : ""}`}
                      aria-live="polite"
                    >
                      {encryptionStatus?.checking
                        ? t("Empfängerschlüssel werden geprüft …")
                        : encryptionStatus?.available
                          ? t(
                              "Alle Empfänger haben passende Schlüssel: Verschlüsselung aktiv.",
                            )
                          : encryptionStatus?.unconfirmed?.length
                            ? `${t("Ohne Verschlüsselung: Schlüssel noch nicht bestätigt für: ")}${encryptionStatus.unconfirmed.join(", ")}`
                            : encryptionStatus?.missing?.length
                              ? `${t("Ohne Verschlüsselung: Für diese Empfänger fehlen passende Schlüssel: ")}${encryptionStatus.missing.join(", ")}`
                              : encryptionStatus?.reason
                                ? `${t("Ohne Verschlüsselung: ")}${t(encryptionStatus.reason)}`
                                : t("Empfängerschlüssel werden geprüft …")}
                    </span>
                  )}
                </div>
                <div className="compose-ai-actions">
                  <button type="button" onClick={() => setAiOpen(true)}>
                    <Sparkles size={15} />
                    {t("Mit KI überarbeiten")}
                  </button>
                  {aiHistory.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setBody(aiHistory.at(-1));
                        setAiHistory((current) => current.slice(0, -1));
                      }}
                    >
                      <Undo2 size={15} />
                      {t("KI-Änderung rückgängig")}
                    </button>
                  )}
                </div>
              </div>
              <textarea
                className="compose-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={t("Schreibe deine Nachricht …")}
                required
              />
              <div className="compose-signature" aria-live="polite">
                <strong>
                  {t("Signatur für")} {senderAccount?.email || ""}
                </strong>
                {signatureText ? (
                  <pre>{signatureText}</pre>
                ) : (
                  <span>{t("Keine Signatur")}</span>
                )}
              </div>
              {files.length > 0 && (
                <div className="compose-files">
                  {files.map((file, index) => (
                    <span key={index}>
                      <Paperclip size={14} />
                      {file.name}
                      <button
                        type="button"
                        onClick={() =>
                          setFiles((current) =>
                            current.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <X size={13} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="compose-footer">
                <div>
                  <button
                    className="primary-button"
                    disabled={
                      busy || !senderAccount || senderAccount.needsCredentials
                    }
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : (
                      <Send size={17} />
                    )}{" "}
                    {t("\n                Senden\n              ")}
                  </button>
                  <label
                    className="attachment-button"
                    title={t("Dateien anhängen")}
                  >
                    <Paperclip size={19} />
                    <input
                      type="file"
                      multiple
                      hidden
                      onChange={(e) => {
                        const next = [...files, ...Array.from(e.target.files)];
                        e.target.value = "";
                        if (next.length > 8) {
                          setError(t("Höchstens acht Anhänge sind erlaubt."));
                          return;
                        }
                        if (
                          next.reduce((sum, file) => sum + file.size, 0) >
                          8 * 1024 * 1024
                        ) {
                          setError(
                            t(
                              "Anhänge dürfen zusammen höchstens 8 MB groß sein.",
                            ),
                          );
                          return;
                        }
                        setFiles(next);
                      }}
                    />
                  </label>
                </div>
                <div>
                  <button
                    type="button"
                    className="save-draft-button"
                    onClick={() => saveDraft()}
                    disabled={busy || !senderAccount}
                  >
                    <Save size={17} /> {t("Entwurf speichern")}
                  </button>
                  <span role="status">
                    {saved && !dirty ? t("Entwurf gespeichert.") : ""}
                  </span>
                </div>
                <span>
                  {t("Gesendet über ")}
                  {senderAccount?.name || "MiniMail"}
                </span>
              </div>
            </fieldset>
          </form>
          {closing && (
            <div
              className="draft-close-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="draft-close-title"
            >
              <h3 id="draft-close-title">{t("Ungespeicherte Nachricht")}</h3>
              <p>
                {t("Möchtest du den aktuellen Stand als Entwurf speichern?")}
              </p>
              <div className="draft-close-actions">
                <button
                  type="button"
                  autoFocus
                  disabled={busy}
                  onClick={() => setClosing(false)}
                >
                  {t("Weiter bearbeiten")}
                </button>
                <button type="button" disabled={busy} onClick={onClose}>
                  {t("Änderungen verwerfen")}
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={busy || !senderAccount}
                  onClick={() => saveDraft(true)}
                >
                  {t("Speichern und schließen")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {aiOpen && (
        <AiRewriteModal
          body={body}
          senderAccountId={senderAccountId}
          to={to}
          cc={cc}
          subject={subject}
          recipientNameHints={
            original
              ? [
                  ...(original.from || []),
                  ...(original.replyTo || []),
                  ...(original.to || []),
                  ...(original.cc || []),
                ].slice(0, 50)
              : []
          }
          onClose={() => setAiOpen(false)}
          onApply={(next) => {
            setAiHistory((current) => [...current, body].slice(-10));
            setBody(next);
            setAiOpen(false);
          }}
        />
      )}
    </>
  );
}
