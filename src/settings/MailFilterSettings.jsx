import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api } from "../mailUi.js";
import { t } from "../i18n.js";

const fields = {
  from: "Absender",
  to: "An",
  cc: "Cc",
  recipients: "An oder Cc",
  subject: "Betreff",
  body: "Nachrichtentext",
  seen: "Gelesen",
  flagged: "Markiert",
  attachment: "Anhang",
};
const operators = {
  contains: "enthält",
  notContains: "enthält nicht",
  equals: "ist",
  notEquals: "ist nicht",
  startsWith: "beginnt mit",
  endsWith: "endet mit",
};
const booleanField = (field) =>
  ["seen", "flagged", "attachment"].includes(field);
const newCondition = (field = "from") => ({
  field,
  operator: booleanField(field) ? "is" : "contains",
  value: booleanField(field) ? "yes" : "",
});
const newRule = () => ({
  name: "",
  enabled: true,
  match: "all",
  conditions: [newCondition()],
  actions: { moveTo: null, seen: null, flagged: null },
  stop: true,
});

export default function MailFilterSettings({ accounts, accountId, visible }) {
  const [selected, setSelected] = useState(accountId || accounts[0]?.id || "");
  const current = accounts.some(
    (account) => String(account.id) === String(selected),
  )
    ? selected
    : accounts[0]?.id || "";
  return (
    <div className="mail-filter-settings">
      <label>
        {t("Postfach")}
        <select
          value={current}
          onChange={(event) => setSelected(event.target.value)}
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name || account.email}
            </option>
          ))}
        </select>
      </label>
      {current ? (
        <MailboxFilters key={current} accountId={current} visible={visible} />
      ) : (
        <p>{t("Bitte zuerst ein Postfach einrichten.")}</p>
      )}
    </div>
  );
}

function MailboxFilters({ accountId, visible }) {
  const [config, setConfig] = useState(null),
    [folders, setFolders] = useState([]);
  const [editor, setEditor] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [source, setSource] = useState("INBOX"),
    [runConfirmation, setRunConfirmation] = useState(false),
    [deleteId, setDeleteId] = useState(null);
  const base = `/accounts/${accountId}`;
  useEffect(() => {
    if (!visible) return;
    let active = true;
    const load = async () => {
      try {
        const value = await api(`${base}/filters`);
        if (active) setConfig(value);
      } catch (err) {
        if (active) setError(err.message);
      }
    };
    load();
    api(`${base}/folders`)
      .then((value) => {
        if (active) setFolders(value);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    const timer = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [base, visible]);
  async function change(path, method, body) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api(`${base}${path}`, {
        method,
        body: { revision: config.revision, ...body },
      });
      setConfig(await api(`${base}/filters`));
      return result;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  const locked =
    busy ||
    config?.pendingFolder ||
    config?.pendingMessage ||
    ["running", "failed"].includes(config?.job?.state);
  const updateCondition = (index, update) =>
    setEditor((rule) => ({
      ...rule,
      conditions: rule.conditions.map((condition, i) =>
        i === index ? { ...condition, ...update } : condition,
      ),
    }));
  const updateAction = (property, value) =>
    setEditor((rule) => ({
      ...rule,
      actions: { ...rule.actions, [property]: value },
    }));
  if (!config) return <p role="status">{error || t("Laden …")}</p>;
  return (
    <>
      <p className="filter-hint">
        {t(
          "Aktive Filter werden der Reihe nach auf neue Nachrichten im Posteingang angewendet. Vorhandene Nachrichten bleiben unverändert, bis du einen Filterlauf startest.",
        )}
      </p>
      {error && (
        <p className="filter-error" role="alert">
          {error}
        </p>
      )}
      {config.lastError && (
        <div className="filter-error" role="status">
          <p>{t(config.lastError)}</p>
          <button
            disabled={busy}
            onClick={() => change("/filters/resume", "POST")}
          >
            {t("Erneut versuchen")}
          </button>
          <button
            disabled={busy}
            onClick={() => change("/filters/cancel", "POST")}
          >
            {t("Filterlauf abbrechen")}
          </button>
        </div>
      )}
      {config.pendingFolder && (
        <button
          disabled={busy}
          onClick={() => change("/folders/reconcile", "POST")}
        >
          {t("Ordneränderung prüfen")}
        </button>
      )}
      <div className="filter-toolbar">
        <label className="filter-check">
          <input
            type="checkbox"
            checked={config.automatic}
            disabled={locked}
            onChange={(event) =>
              change("/filters/settings", "PATCH", {
                automatic: event.target.checked,
              })
            }
          />
          {t("Neue Nachrichten automatisch filtern")}
        </label>
        <button
          disabled={locked || !!editor}
          onClick={() => {
            setEditor({ ...newRule(), revision: config.revision });
            setDeleteId(null);
          }}
        >
          <Plus size={15} />
          {t("Neuer Filter")}
        </button>
      </div>
      <ol className="filter-rule-list">
        {config.rules.map((rule, index) => (
          <li key={rule.id}>
            <label className="filter-check">
              <input
                type="checkbox"
                checked={rule.enabled}
                disabled={locked || !!editor}
                aria-label={`${t("Aktiv")}: ${rule.name}`}
                onChange={(event) =>
                  change(`/filters/${rule.id}`, "PUT", {
                    ...rule,
                    enabled: event.target.checked,
                  })
                }
              />
              <strong>{rule.name}</strong>
            </label>
            <div className="filter-rule-buttons">
              {[
                [-1, ArrowUp, "Nach oben"],
                [1, ArrowDown, "Nach unten"],
              ].map(([step, Icon, label]) => (
                <button
                  key={step}
                  title={t(label)}
                  aria-label={`${t(label)}: ${rule.name}`}
                  disabled={
                    locked ||
                    !!editor ||
                    index + step < 0 ||
                    index + step >= config.rules.length
                  }
                  onClick={() => {
                    const ids = config.rules.map((item) => item.id);
                    [ids[index], ids[index + step]] = [
                      ids[index + step],
                      ids[index],
                    ];
                    change("/filters/reorder", "POST", { ids });
                  }}
                >
                  <Icon size={15} />
                </button>
              ))}
              <button
                disabled={locked}
                onClick={() => {
                  setEditor({
                    ...structuredClone(rule),
                    revision: config.revision,
                  });
                  setDeleteId(null);
                }}
              >
                {t("Bearbeiten")}
              </button>
              <button
                disabled={locked || !!editor}
                aria-label={`${t("Löschen")}: ${rule.name}`}
                onClick={() => setDeleteId(rule.id)}
              >
                <Trash2 size={15} />
              </button>
            </div>
            {deleteId === rule.id && (
              <div className="filter-confirm">
                <span>{t("Diesen Filter löschen?")}</span>
                <button disabled={busy} onClick={() => setDeleteId(null)}>
                  {t("Abbrechen")}
                </button>
                <button
                  disabled={locked}
                  onClick={async () => {
                    if (await change(`/filters/${rule.id}`, "DELETE"))
                      setDeleteId(null);
                  }}
                >
                  {t("Filter löschen")}
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
      {!config.rules.length && (
        <p className="filter-hint">
          {t("Noch keine Filter in diesem Postfach.")}
        </p>
      )}
      {editor && (
        <form
          className="filter-editor"
          onSubmit={async (event) => {
            event.preventDefault();
            if (
              await change(
                `/filters${editor.id ? `/${editor.id}` : ""}`,
                editor.id ? "PUT" : "POST",
                editor,
              )
            )
              setEditor(null);
          }}
        >
          <label>
            {t("Filtername")}
            <input
              autoFocus
              required
              maxLength={120}
              value={editor.name}
              disabled={locked}
              onChange={(event) =>
                setEditor({ ...editor, name: event.target.value })
              }
            />
          </label>
          <label>
            {t("Bedingungen")}
            <select
              value={editor.match}
              disabled={locked}
              onChange={(event) =>
                setEditor({ ...editor, match: event.target.value })
              }
            >
              <option value="all">{t("Alle Bedingungen erfüllen")}</option>
              <option value="any">
                {t("Mindestens eine Bedingung erfüllen")}
              </option>
            </select>
          </label>
          {editor.conditions.map((condition, index) => (
            <div className="filter-condition" key={index}>
              <select
                aria-label={`${t("Feld")} ${index + 1}`}
                value={condition.field}
                disabled={locked}
                onChange={(event) =>
                  updateCondition(index, newCondition(event.target.value))
                }
              >
                {Object.entries(fields).map(([field, label]) => (
                  <option key={field} value={field}>
                    {t(label)}
                  </option>
                ))}
              </select>
              {booleanField(condition.field) ? (
                <select
                  aria-label={t("Wert")}
                  value={condition.value}
                  disabled={locked}
                  onChange={(event) =>
                    updateCondition(index, { value: event.target.value })
                  }
                >
                  <option value="yes">{t("Ja")}</option>
                  <option value="no">{t("Nein")}</option>
                </select>
              ) : (
                <>
                  <select
                    aria-label={t("Vergleich")}
                    value={condition.operator}
                    disabled={locked}
                    onChange={(event) =>
                      updateCondition(index, { operator: event.target.value })
                    }
                  >
                    {Object.entries(operators)
                      .filter(
                        ([op]) =>
                          condition.field !== "body" ||
                          ["contains", "notContains"].includes(op),
                      )
                      .map(([op, label]) => (
                        <option key={op} value={op}>
                          {t(label)}
                        </option>
                      ))}
                  </select>
                  <input
                    aria-label={t("Vergleichstext")}
                    required
                    maxLength={500}
                    value={condition.value}
                    disabled={locked}
                    onChange={(event) =>
                      updateCondition(index, { value: event.target.value })
                    }
                  />
                </>
              )}
              <button
                type="button"
                aria-label={t("Bedingung entfernen")}
                disabled={locked || editor.conditions.length === 1}
                onClick={() =>
                  setEditor({
                    ...editor,
                    conditions: editor.conditions.filter((_, i) => i !== index),
                  })
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={locked || editor.conditions.length >= 12}
            onClick={() =>
              setEditor({
                ...editor,
                conditions: [...editor.conditions, newCondition()],
              })
            }
          >
            <Plus size={15} />
            {t("Bedingung hinzufügen")}
          </button>
          <fieldset disabled={locked}>
            <legend>{t("Aktionen")}</legend>
            <label>
              {t("Verschieben nach")}
              <select
                value={editor.actions.moveTo || ""}
                onChange={(event) =>
                  updateAction("moveTo", event.target.value || null)
                }
              >
                <option value="">{t("Nicht verschieben")}</option>
                {folders.map((folder) => (
                  <option key={folder.path} value={folder.path}>
                    {folder.path}
                  </option>
                ))}
              </select>
            </label>
            {[
              [
                "seen",
                "Lesestatus",
                "Als gelesen markieren",
                "Als ungelesen markieren",
              ],
              ["flagged", "Markierung", "Markieren", "Markierung entfernen"],
            ].map(([property, label, yes, no]) => (
              <label key={property}>
                {t(label)}
                <select
                  value={
                    editor.actions[property] === null
                      ? ""
                      : String(editor.actions[property])
                  }
                  onChange={(event) =>
                    updateAction(
                      property,
                      event.target.value === ""
                        ? null
                        : event.target.value === "true",
                    )
                  }
                >
                  <option value="">{t("Unverändert lassen")}</option>
                  <option value="true">{t(yes)}</option>
                  <option value="false">{t(no)}</option>
                </select>
              </label>
            ))}
          </fieldset>
          <label className="filter-check">
            <input
              type="checkbox"
              checked={editor.stop}
              disabled={locked}
              onChange={(event) =>
                setEditor({ ...editor, stop: event.target.checked })
              }
            />
            {t("Nach Treffer keine weiteren Filter anwenden")}
          </label>
          <p className="filter-hint">
            {t(
              "Nach dem Verschieben endet die Verarbeitung dieser Nachricht immer.",
            )}
          </p>
          <div className="filter-toolbar">
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditor(null)}
            >
              {t("Abbrechen")}
            </button>
            <button type="submit" disabled={locked}>
              {t("Speichern")}
            </button>
          </div>
        </form>
      )}
      {config.job && (
        <div className="filter-job" role="status">
          <strong>
            {t(
              {
                running: "Filterlauf läuft …",
                completed: "Filterlauf abgeschlossen",
                failed: "Filterlauf fehlgeschlagen",
                cancelled: "Filterlauf abgebrochen",
              }[config.job.state] || "Filterlauf",
            )}
          </strong>
          <p>
            {config.job.folder}: {config.job.processed} {t("geprüft")},{" "}
            {config.job.matched} {t("Treffer")}, {config.job.moved}{" "}
            {t("verschoben")}
          </p>
          {config.job.state === "running" && (
            <button
              disabled={busy}
              onClick={() => change("/filters/cancel", "POST")}
            >
              {t("Filterlauf abbrechen")}
            </button>
          )}
        </div>
      )}
      <div className="filter-run">
        <h4>{t("Vorhandene Nachrichten filtern")}</h4>
        <label>
          {t("Quellordner")}
          <select
            value={source}
            disabled={locked}
            onChange={(event) => {
              setSource(event.target.value);
              setRunConfirmation(false);
            }}
          >
            {folders.map((folder) => (
              <option key={folder.path} value={folder.path}>
                {folder.path}
              </option>
            ))}
          </select>
        </label>
        {runConfirmation ? (
          <div className="filter-confirm">
            <p>
              {t(
                "Alle aktivierten Filter werden auf die vorhandenen Nachrichten dieses Ordners angewendet. Nachrichten können dabei verschoben und markiert werden.",
              )}
            </p>
            <button disabled={busy} onClick={() => setRunConfirmation(false)}>
              {t("Abbrechen")}
            </button>
            <button
              disabled={locked || !!editor}
              onClick={async () => {
                if (
                  await change("/filters/run", "POST", {
                    folder: source,
                    confirmation: true,
                  })
                )
                  setRunConfirmation(false);
              }}
            >
              <RefreshCw size={15} />
              {t("Jetzt anwenden")}
            </button>
          </div>
        ) : (
          <button
            disabled={
              locked ||
              !!editor ||
              !config.rules.some((rule) => rule.enabled) ||
              !folders.some((folder) => folder.path === source)
            }
            onClick={() => setRunConfirmation(true)}
          >
            {t("Filterlauf vorbereiten")}
          </button>
        )}
      </div>
    </>
  );
}
