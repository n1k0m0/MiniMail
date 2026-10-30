import crypto from "node:crypto";
import {
  loadMailRules,
  changeMailRules,
  changeMailRuleState,
  mailboxOperation,
  assertNoFolderOperation,
  MailRuleError,
  assertCurrentMailbox,
} from "./mailRuleStore.js";
import { validateMailRule } from "./mailFilterRules.js";
import { initializeFilterCursor, startFilterJob } from "./mailFilterEngine.js";
import {
  allRemoteFolders,
  createRemoteFolder,
  folderDeletePlan,
  folderTrashDestination,
  moveRemoteFolderToTrash,
  reconcileFolderDelete,
  sameFolder,
} from "./folderActions.js";

const publicConfig = (config) => ({
  rules: config.rules,
  automatic: config.automatic,
  revision: config.revision,
  job: config.job,
  lastRun: config.lastRun,
  lastError: config.lastError,
  pendingFolder: !!config.pendingFolder,
  pendingMessage: !!config.pendingMessage,
});
function editable(config, revision) {
  assertNoFolderOperation(config);
  if (revision !== undefined && revision !== config.revision)
    throw new MailRuleError(
      "Die Filter wurden zwischenzeitlich geändert. Bitte die Ansicht aktualisieren und erneut bearbeiten.",
      409,
    );
  if (
    ["running", "failed"].includes(config.job?.state) ||
    config.pendingMessage
  )
    throw new MailRuleError(
      "Bitte den laufenden oder begonnenen Filterlauf zuerst beenden oder abbrechen.",
      409,
    );
}
function validateBodyLimit(rules) {
  if (
    new Set(
      rules.flatMap((rule) =>
        rule.conditions
          .filter((condition) => condition.field === "body")
          .map((condition) => condition.value),
      ),
    ).size > 20
  )
    throw new MailRuleError(
      "Pro Postfach sind höchstens 20 unterschiedliche Textinhalt-Bedingungen möglich.",
    );
}
export function registerMailRuleRoutes(
  app,
  db,
  { accountFor, withImap, kickFilters },
) {
  const tickets = new Map();
  setInterval(() => {
    for (const [id, item] of tickets)
      if (item.expires < Date.now()) tickets.delete(id);
  }, 30000).unref();
  const route = (callback) => async (req, res, next) => {
    try {
      const account = await accountFor(req, res);
      if (!account) return;
      await callback(req, res, account);
    } catch (error) {
      if (error instanceof MailRuleError)
        return res.status(error.status).json({ error: error.message });
      next(error);
    }
  };
  const connected = async (account, callback) => {
    await assertCurrentMailbox(db, account);
    return withImap(account, callback, { timeout: 45000 });
  };
  app.get(
    "/api/accounts/:id/filters",
    route(async (req, res, account) =>
      res.json(publicConfig(await loadMailRules(db, account.id))),
    ),
  );
  async function saveRule(req, res, account, updating) {
    await mailboxOperation(account.id, async () => {
      const config = await loadMailRules(db, account.id);
      editable(config, req.body?.revision);
      if (
        updating &&
        !config.rules.some((rule) => rule.id === req.params.ruleId)
      )
        throw new MailRuleError("Filter nicht gefunden.", 404);
      if (!updating && config.rules.length >= 100)
        throw new MailRuleError(
          "Pro Postfach sind höchstens 100 Filter möglich.",
        );
      const rule = validateMailRule(req.body, {
        id: updating ? req.params.ruleId : crypto.randomUUID(),
      });
      validateBodyLimit([
        ...config.rules.filter((item) => item.id !== rule.id),
        rule,
      ]);
      let cursor = config.cursor;
      if (rule.enabled && (rule.actions.moveTo || !cursor))
        await connected(account, async (client) => {
          if (
            rule.actions.moveTo &&
            !(await allRemoteFolders(client)).some(
              (folder) =>
                folder.selectable &&
                sameFolder(folder.path, rule.actions.moveTo),
            )
          )
            throw new MailRuleError(
              "Der Zielordner wurde nicht gefunden. Bitte einen vorhandenen Ordner auswählen.",
            );
          if (!cursor) cursor = await initializeFilterCursor(client);
        });
      const saved = await changeMailRules(db, account.id, (current) => {
        editable(current, req.body?.revision);
        if (updating)
          current.rules = current.rules.map((item) =>
            item.id === rule.id ? rule : item,
          );
        else current.rules.push(rule);
        current.revision++;
        current.cursor = cursor;
        current.lastError = "";
      });
      res.status(updating ? 200 : 201).json(publicConfig(saved));
    });
  }
  app.post(
    "/api/accounts/:id/filters",
    route((req, res, account) => saveRule(req, res, account, false)),
  );
  app.put(
    "/api/accounts/:id/filters/:ruleId",
    route((req, res, account) => saveRule(req, res, account, true)),
  );
  app.delete(
    "/api/accounts/:id/filters/:ruleId",
    route(async (req, res, account) =>
      mailboxOperation(account.id, async () => {
        const saved = await changeMailRules(db, account.id, (current) => {
          editable(current, req.body?.revision);
          if (!current.rules.some((rule) => rule.id === req.params.ruleId))
            throw new MailRuleError("Filter nicht gefunden.", 404);
          current.rules = current.rules.filter(
            (rule) => rule.id !== req.params.ruleId,
          );
          current.revision++;
        });
        res.json(publicConfig(saved));
      }),
    ),
  );
  app.post(
    "/api/accounts/:id/filters/reorder",
    route(async (req, res, account) =>
      mailboxOperation(account.id, async () => {
        const ids = req.body?.ids;
        const saved = await changeMailRules(db, account.id, (current) => {
          editable(current, req.body?.revision);
          if (
            !Array.isArray(ids) ||
            ids.length !== current.rules.length ||
            new Set(ids).size !== ids.length ||
            ids.some((id) => !current.rules.some((rule) => rule.id === id))
          )
            throw new MailRuleError("Ungültige Filterreihenfolge.");
          const byId = new Map(current.rules.map((rule) => [rule.id, rule]));
          current.rules = ids.map((id) => byId.get(id));
          current.revision++;
        });
        res.json(publicConfig(saved));
      }),
    ),
  );
  app.patch(
    "/api/accounts/:id/filters/settings",
    route(async (req, res, account) =>
      mailboxOperation(account.id, async () => {
        if (typeof req.body?.automatic !== "boolean")
          throw new MailRuleError("Ungültige Filtereinstellung.");
        const config = await loadMailRules(db, account.id);
        editable(config, req.body?.revision);
        const cursor =
          config.cursor ||
          (req.body.automatic
            ? await connected(account, initializeFilterCursor)
            : null);
        res.json(
          publicConfig(
            await changeMailRules(db, account.id, (current) => {
              editable(current, req.body?.revision);
              current.automatic = req.body.automatic;
              current.cursor = cursor;
              current.revision++;
            }),
          ),
        );
      }),
    ),
  );
  app.post(
    "/api/accounts/:id/filters/run",
    route(async (req, res, account) => {
      if (req.body?.confirmation !== true)
        throw new MailRuleError(
          "Bitte die Anwendung auf vorhandene Nachrichten bestätigen.",
        );
      const saved = await mailboxOperation(account.id, () =>
        connected(account, (client) =>
          startFilterJob(
            db,
            account,
            client,
            req.body?.folder,
            req.body?.ruleIds,
          ),
        ),
      );
      res.json(publicConfig(saved));
      kickFilters(account.id);
    }),
  );
  app.post(
    "/api/accounts/:id/filters/resume",
    route(async (req, res, account) => {
      await mailboxOperation(account.id, async () => {
        const config = await loadMailRules(db, account.id);
        assertNoFolderOperation(config);
        if (
          config.job?.state !== "failed" &&
          !config.pendingMessage &&
          !(
            config.lastError &&
            config.automatic &&
            config.rules.some((rule) => rule.enabled)
          )
        )
          throw new MailRuleError(
            "Es gibt keinen fehlgeschlagenen Filterlauf.",
          );
        await changeMailRuleState(db, account.id, (current) => {
          if (current.job?.state === "failed")
            current.job = { ...current.job, state: "running", error: "" };
          current.lastError = "";
        });
      });
      res.json(publicConfig(await loadMailRules(db, account.id)));
      kickFilters(account.id);
    }),
  );
  app.post(
    "/api/accounts/:id/filters/cancel",
    route(async (req, res, account) =>
      mailboxOperation(account.id, async () => {
        const config = await loadMailRules(db, account.id);
        assertNoFolderOperation(config);
        await changeMailRuleState(db, account.id, (current) => {
          if (current.pendingMessage && !current.pendingMessage.jobId)
            current.cursor = {
              validity: current.pendingMessage.validity,
              lastUid: current.pendingMessage.uid,
            };
          current.pendingMessage = null;
          if (current.job)
            current.job = {
              ...current.job,
              state: "cancelled",
              finishedAt: Date.now(),
            };
          current.lastError = "";
        });
        res.json(publicConfig(await loadMailRules(db, account.id)));
      }),
    ),
  );
  app.post(
    "/api/accounts/:id/folders",
    route(async (req, res, account) =>
      mailboxOperation(account.id, () =>
        connected(account, async (client) => {
          const config = await loadMailRules(db, account.id);
          assertNoFolderOperation(config);
          res
            .status(201)
            .json(
              await createRemoteFolder(
                db,
                client,
                req.body?.parent ?? "",
                req.body?.name,
              ),
            );
        }),
      ),
    ),
  );
  app.get(
    "/api/accounts/:id/folders/delete-preview",
    route(async (req, res, account) =>
      mailboxOperation(account.id, () =>
        connected(account, async (client) => {
          await reconcileFolderDelete(db, account, client);
          const plan = await folderDeletePlan(
            db,
            account,
            client,
            req.query.path,
          );
          const ticket = crypto.randomBytes(32).toString("hex"),
            destination = folderTrashDestination(plan);
          if (tickets.size >= 256)
            throw new MailRuleError(
              "Zu viele offene Ordnerbestätigungen. Bitte kurz warten.",
              429,
            );
          tickets.set(ticket, {
            accountId: account.id,
            userId: req.user.id,
            session: req.sessionHash,
            path: plan.path,
            hash: plan.hash,
            destination,
            expires: Date.now() + 300000,
          });
          res.json({
            path: plan.path,
            name: plan.name,
            destination,
            subfolderCount: plan.subfolderCount,
            messageCount: plan.messageCount,
            filters: plan.filters,
            ticket,
          });
        }),
      ),
    ),
  );
  app.post(
    "/api/accounts/:id/folders/trash",
    route(async (req, res, account) => {
      const ticket = tickets.get(req.body?.ticket);
      tickets.delete(req.body?.ticket);
      if (
        !ticket ||
        ticket.accountId !== account.id ||
        ticket.userId !== req.user.id ||
        ticket.session !== req.sessionHash ||
        ticket.path !== req.body?.path ||
        ticket.expires < Date.now()
      )
        throw new MailRuleError(
          "Die Ordnerbestätigung ist abgelaufen. Bitte erneut bestätigen.",
          403,
        );
      await mailboxOperation(account.id, () =>
        connected(account, async (client) => {
          const plan = await folderDeletePlan(db, account, client, ticket.path);
          if (plan.hash !== ticket.hash)
            throw new MailRuleError(
              "Ordner oder Filter haben sich geändert. Bitte die aktualisierte Vorschau erneut bestätigen.",
              409,
            );
          res.json(
            await moveRemoteFolderToTrash(
              db,
              account,
              client,
              plan,
              ticket.destination,
            ),
          );
        }),
      );
    }),
  );
  app.post(
    "/api/accounts/:id/folders/reconcile",
    route(async (req, res, account) =>
      mailboxOperation(account.id, () =>
        connected(account, async (client) =>
          res.json(await reconcileFolderDelete(db, account, client)),
        ),
      ),
    ),
  );
}
