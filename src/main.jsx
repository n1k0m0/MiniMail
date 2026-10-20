import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import LoginScreen from "./LoginScreen.jsx";
import UserManagement from "./UserManagement.jsx";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Inbox,
  LoaderCircle,
  LockKeyhole,
  Mail,
  MailOpen,
  Menu,
  Moon,
  Paperclip,
  PenLine,
  Plus,
  RefreshCw,
  Reply,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Star,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import "./style.css";
import { buildFolderTree, visibleFolderNodes } from "./folderTree.js";

const PAGE_SIZE = 60;
const SIDEBAR_WIDTH_KEY = "minimail-sidebar-width";
const MESSAGE_WIDTH_KEY = "minimail-message-width";

function storedWidth(key) {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function ResizeHandle({
  label,
  value,
  min,
  max,
  defaultWidth,
  onResize,
  onCommit,
}) {
  const drag = useRef(null);
  function finish(event) {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    onCommit(drag.current.width);
    document.body.style.userSelect = drag.current.userSelect;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
  }
  return (
    <div
      className="resize-handle"
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      title="Breite ziehen · Doppelklick setzt zurück"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          startWidth: value,
          width: value,
          userSelect: document.body.style.userSelect,
        };
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(event) => {
        if (!drag.current || drag.current.pointerId !== event.pointerId) return;
        const width = Math.min(
          max,
          Math.max(
            min,
            drag.current.startWidth + event.clientX - drag.current.x,
          ),
        );
        drag.current.width = width;
        onResize(width);
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onDoubleClick={() => {
        onResize(defaultWidth);
        onCommit(defaultWidth);
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const step = event.shiftKey ? 30 : 10;
        const next = Math.min(
          max,
          Math.max(min, value + (event.key === "ArrowRight" ? step : -step)),
        );
        onResize(next);
        onCommit(next);
      }}
    />
  );
}

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-MiniMail-Request": "1" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}
const fmtAddress = (list) =>
  list?.map((item) => item.name || item.address).join(", ") || "Unbekannt";
const fullAddress = (list) =>
  list
    ?.map((item) =>
      item.name ? `${item.name} <${item.address}>` : item.address,
    )
    .join(", ") || "";
function replyAllCc(message, accountEmail) {
  const excluded = new Set(
    [accountEmail, ...(message.from || []).map((item) => item.address)]
      .filter(Boolean)
      .map((address) => address.toLowerCase()),
  );
  return [...(message.to || []), ...(message.cc || [])]
    .map((item) => item.address)
    .filter((address) => {
      if (!address || excluded.has(address.toLowerCase())) return false;
      excluded.add(address.toLowerCase());
      return true;
    })
    .join(", ");
}
function dateLabel(value) {
  if (!value) return "";
  const date = new Date(value),
    today = new Date();
  if (date.toDateString() === today.toDateString())
    return new Intl.DateTimeFormat("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "short",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  }).format(date);
}
function folderMeta(folder) {
  const name = folder?.name || folder?.path || "Posteingang";
  const type = folder?.specialUse || "";
  if (type === "\\Sent" || /^(gesendet|sent|sent items|sent mail)$/i.test(name))
    return { icon: Send, label: "Gesendet" };
  if (type === "\\Drafts" || /^(entwürfe|entwurf|drafts?)$/i.test(name))
    return { icon: FileText, label: "Entwürfe" };
  if (
    type === "\\Trash" ||
    /^(papierkorb|trash|deleted items|gelöscht)$/i.test(name)
  )
    return { icon: Trash2, label: "Papierkorb" };
  if (type === "\\Archive" || /^(archiv|archive)$/i.test(name))
    return { icon: Archive, label: "Archiv" };
  if (folder?.path?.toUpperCase() === "INBOX")
    return { icon: Inbox, label: "Posteingang" };
  return { icon: Mail, label: name };
}

function PaginationControls({
  page,
  total,
  loading,
  onChange,
  compact = false,
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const [entry, setEntry] = useState(String(page + 1));
  useEffect(() => setEntry(String(page + 1)), [page]);
  function jump() {
    const target = Number(entry);
    if (Number.isInteger(target) && target >= 1 && target <= pages)
      onChange(target - 1);
    else setEntry(String(page + 1));
  }
  return (
    <div
      className={`page-controls ${compact ? "page-controls-compact" : ""}`}
      aria-label="Nachrichtenseiten"
    >
      {!compact && (
        <button
          type="button"
          title="Erste Seite"
          aria-label="Erste Seite"
          disabled={loading || page === 0}
          onClick={() => onChange(0)}
        >
          «
        </button>
      )}
      <button
        type="button"
        title="Neuere Nachrichten"
        aria-label="Neuere Nachrichten"
        disabled={loading || page === 0}
        onClick={() => onChange(page - 1)}
      >
        <ChevronLeft size={17} />
      </button>
      {compact ? (
        <span>
          {page + 1} / {pages}
        </span>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            jump();
          }}
        >
          <label htmlFor="mail-page">Seite</label>
          <input
            id="mail-page"
            type="number"
            min="1"
            max={pages}
            value={entry}
            onChange={(event) => setEntry(event.target.value)}
            onBlur={jump}
            aria-label="Seitennummer"
          />
          <span>von {pages}</span>
        </form>
      )}
      <button
        type="button"
        title="Ältere Nachrichten"
        aria-label="Ältere Nachrichten"
        disabled={loading || page >= pages - 1}
        onClick={() => onChange(page + 1)}
      >
        <ChevronRight size={17} />
      </button>
      {!compact && (
        <button
          type="button"
          title="Letzte Seite"
          aria-label="Letzte Seite"
          disabled={loading || page >= pages - 1}
          onClick={() => onChange(pages - 1)}
        >
          »
        </button>
      )}
    </div>
  );
}

function App() {
  const [auth, setAuth] = useState(null);
  const authIdentityRef = useRef(null);
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState(null);
  const accountsRef = useRef(accounts);
  const activeAccountIdRef = useRef(accountId);
  accountsRef.current = accounts;
  activeAccountIdRef.current = accountId;
  const [folders, setFolders] = useState([]);
  const [folderFilter, setFolderFilter] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState(new Set());
  const [folder, setFolder] = useState("INBOX");
  const activeFolderRef = useRef(folder);
  activeFolderRef.current = folder;
  const [messages, setMessages] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const contextMenuRef = useRef(null);
  const contextTriggerRef = useRef(null);
  const draggedMessageRef = useRef(null);
  const [draggingUid, setDraggingUid] = useState(null);
  const [dropFolder, setDropFolder] = useState(null);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [theme, setTheme] = useState(
    localStorage.getItem("minimail-theme") || "light",
  );
  const [refreshKey, setRefreshKey] = useState(0);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [sidebarPreference, setSidebarPreference] = useState(() =>
    storedWidth(SIDEBAR_WIDTH_KEY),
  );
  const [messagePreference, setMessagePreference] = useState(() =>
    storedWidth(MESSAGE_WIDTH_KEY),
  );
  const narrowDesktop = windowWidth <= 1060;
  const railWidth = narrowDesktop ? 58 : 72;
  const defaultSidebarWidth = narrowDesktop ? 210 : 247;
  const defaultMessageWidth = narrowDesktop ? 265 : 374;
  const sidebarMax = Math.max(
    180,
    Math.min(440, windowWidth - railWidth - 260 - 220),
  );
  const sidebarWidth = Math.min(
    sidebarMax,
    Math.max(180, sidebarPreference ?? defaultSidebarWidth),
  );
  const messageMax = Math.max(
    260,
    Math.min(900, windowWidth - railWidth - sidebarWidth - 220),
  );
  const messageWidth = Math.min(
    messageMax,
    Math.max(260, messagePreference ?? defaultMessageWidth),
  );
  const messageScrollRef = useRef(null);
  const contextMessage = contextMenu?.type === "message"
    ? messages.find((item) => item.uid === contextMenu.uid)
    : null;
  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);
  const visibleFolders = useMemo(
    () => visibleFolderNodes(folderTree, collapsedFolders, folderFilter),
    [folderTree, collapsedFolders, folderFilter],
  );
  const activeAccount = accounts.find((item) => item.id === accountId);
  function applyAuth(next) {
    const identity = next?.user?.username || null;
    if (authIdentityRef.current !== identity) {
      authIdentityRef.current = identity;
      setAccounts([]);
      setAccountId(null);
      setFolders([]);
      setFolderFilter("");
      setCollapsedFolders(new Set());
      setFolder("INBOX");
      setMessages([]);
      setTotal(0);
      setPage(0);
      setQuery("");
      setSearch("");
      setSelected(null);
      setDetail(null);
      setLoading(false);
      setDetailLoading(false);
      setModal(null);
      setContextMenu(null);
      draggedMessageRef.current = null;
      setDraggingUid(null);
      setDropFolder(null);
      setMobileSidebar(false);
      setRefreshKey(0);
      setError("");
    }
    setAuth(next);
  }
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("minimail-theme", theme);
  }, [theme]);
  useEffect(() => {
    const onWindowResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, []);
  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;
    const element = contextMenuRef.current;
    const bounds = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(contextMenu.x, window.innerWidth - bounds.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(contextMenu.y, window.innerHeight - bounds.height - 8))}px`;
    element.querySelector("button")?.focus();
  }, [contextMenu]);
  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = (event) => {
      if (!contextMenuRef.current?.contains(event.target)) setContextMenu(null);
    };
    const close = () => setContextMenu(null);
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("resize", close);
    messageScrollRef.current?.addEventListener("scroll", close);
    const scroll = messageScrollRef.current;
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", close);
      scroll?.removeEventListener("scroll", close);
    };
  }, [contextMenu]);
  useEffect(() => setContextMenu(null), [accountId, folder, page, search]);
  useEffect(() => {
    let cancelled = false;
    let retry;
    async function load(attempt = 0) {
      try {
        const result = await api("/auth/me");
        if (!cancelled) applyAuth(result);
      } catch (err) {
        if (cancelled) return;
        if (attempt < 5) retry = setTimeout(() => load(attempt + 1), 600);
        else {
          applyAuth({ user: null, adminSetupRequired: false });
          setError(err.message);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, []);
  useEffect(() => {
    if (!auth?.user?.twoFactorEnabled || auth.user.mustChangePassword) return;
    const identity = auth.user.username;
    let active = true;
    api("/accounts")
      .then((data) => {
        if (!active || authIdentityRef.current !== identity) return;
        setAccounts(data);
        setAccountId((current) => current ?? data[0]?.id ?? null);
      })
      .catch((err) => {
        if (active && authIdentityRef.current === identity)
          setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [auth]);
  useEffect(() => {
    if (!auth?.user?.twoFactorEnabled || auth.user.mustChangePassword) return;
    const identity = auth.user.username;
    let cancelled = false;
    let polling = false;
    async function pollAccounts() {
      if (polling || document.hidden) return;
      polling = true;
      try {
        const data = await api("/accounts");
        if (
          cancelled ||
          authIdentityRef.current !== identity ||
          JSON.stringify(data) === JSON.stringify(accountsRef.current)
        )
          return;
        const before = accountsRef.current.find(
          (item) => item.id === activeAccountIdRef.current,
        );
        const after = data.find(
          (item) => item.id === activeAccountIdRef.current,
        );
        accountsRef.current = data;
        setAccounts(data);
        if (
          before &&
          after?.last_checked_at !== before.last_checked_at &&
          !after.check_failed
        )
          setRefreshKey((value) => value + 1);
      } catch (err) {
        if (
          !cancelled &&
          authIdentityRef.current === identity &&
          err.message === "Bitte anmelden."
        )
          api("/auth/me")
            .then(applyAuth)
            .catch(() => {});
      } finally {
        polling = false;
      }
    }
    const timer = setInterval(pollAccounts, 15000);
    const onVisible = () => {
      if (!document.hidden) pollAccounts();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [auth]);
  useEffect(() => {
    if (!accountId || activeAccount?.needsCredentials) {
      setFolders([]);
      return;
    }
    let active = true;
    api(`/accounts/${accountId}/folders`)
      .then((data) => {
        if (!active) return;
        setFolders(data);
        setFolder((current) =>
          data.some((item) => item.path === current)
            ? current
            : data.find((item) => item.path.toUpperCase() === "INBOX")?.path ||
              data[0]?.path ||
              "INBOX",
        );
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [accountId, activeAccount?.needsCredentials, refreshKey]);
  useEffect(() => {
    if (!accountId || activeAccount?.needsCredentials) {
      setMessages([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    api(
      `/accounts/${accountId}/messages?folder=${encodeURIComponent(folder)}&q=${encodeURIComponent(search)}&page=${page}`,
    )
      .then((data) => {
        if (active) {
          setMessages(data.messages);
          setTotal(data.total);
        }
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    accountId,
    activeAccount?.needsCredentials,
    folder,
    search,
    page,
    refreshKey,
  ]);
  useEffect(() => {
    if (!accountId || !selected) {
      setDetail(null);
      return;
    }
    let active = true;
    setDetailLoading(true);
    api(
      `/accounts/${accountId}/messages/${selected}?folder=${encodeURIComponent(folder)}`,
    )
      .then((data) => {
        if (active) {
          setDetail(data);
          if (messages.some((item) => item.uid === selected && !item.seen))
            flag(selected, "seen", true);
        }
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [accountId, folder, selected]);
  const activeFolder = folders.find((item) => item.path === folder);
  function selectFolder(path) {
    setFolder(path);
    setPage(0);
    setSelected(null);
    setMobileSidebar(false);
  }
  function changePage(nextPage) {
    if (nextPage === page) return;
    setPage(nextPage);
    setSelected(null);
    if (messageScrollRef.current) messageScrollRef.current.scrollTop = 0;
  }
  function toggleFolder(path) {
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }
  function refresh() {
    setRefreshKey((value) => value + 1);
  }
  async function withAction(action) {
    try {
      await action();
      refresh();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }
  async function flag(uid, key, enabled) {
    const success = await withAction(() =>
      api(`/accounts/${accountId}/messages/${uid}/flags`, {
        method: "PATCH",
        body: { folder, flags: { [key]: enabled } },
      }),
    );
    if (success)
      setMessages((current) =>
        current.map((item) =>
          item.uid === uid ? { ...item, [key]: enabled } : item,
        ),
      );
  }
  async function markFolderAsRead(path) {
    const currentAccountId = accountId;
    const success = await withAction(() =>
      api(`/accounts/${currentAccountId}/folders/mark-read`, {
        method: "PATCH",
        body: { folder: path },
      }),
    );
    if (!success || activeAccountIdRef.current !== currentAccountId) return;
    setFolders((current) =>
      current.map((item) =>
        item.path === path ? { ...item, unseen: 0 } : item,
      ),
    );
    if (path === folder)
      setMessages((current) => current.map((item) => ({ ...item, seen: true })));
    if (path.toUpperCase() === "INBOX")
      setAccounts((current) =>
        current.map((item) =>
          item.id === currentAccountId ? { ...item, inbox_unseen: 0 } : item,
        ),
      );
  }
  async function remove(uid = selected) {
    if (!uid) return;
    const success = await withAction(() =>
      api(`/accounts/${accountId}/messages/${uid}`, {
        method: "DELETE",
        body: { folder },
      }),
    );
    if (success) {
      setSelected((current) => (current === uid ? null : current));
      setMessages((current) => current.filter((item) => item.uid !== uid));
    }
  }
  async function move(uid, destination, sourceFolder = folder) {
    if (!uid || !destination || destination === sourceFolder) return;
    const currentAccountId = accountId;
    const success = await withAction(() =>
      api(`/accounts/${currentAccountId}/messages/${uid}/move`, {
        method: "POST",
        body: { folder: sourceFolder, destination },
      }),
    );
    if (
      success &&
      activeAccountIdRef.current === currentAccountId &&
      activeFolderRef.current === sourceFolder
    ) {
      setSelected((current) => (current === uid ? null : current));
      setMessages((current) => current.filter((item) => item.uid !== uid));
    }
  }
  async function archive(uid = selected) {
    const target = folders.find(
      (item) =>
        item.specialUse === "\\Archive" || /archiv|archive/i.test(item.name),
    );
    if (!target || !uid) {
      setError("Kein Archivordner auf diesem Postfach gefunden.");
      return;
    }
    await move(uid, target.path);
  }
  function openContextMenu(event, uid) {
    event.preventDefault();
    contextTriggerRef.current = event.currentTarget;
    const bounds = event.currentTarget.getBoundingClientRect();
    setContextMenu({
      type: "message",
      uid,
      x: event.type === "contextmenu" ? event.clientX : bounds.left + 24,
      y: event.type === "contextmenu" ? event.clientY : bounds.top + 24,
    });
  }
  function openFolderContextMenu(event, path) {
    event.preventDefault();
    contextTriggerRef.current = event.currentTarget;
    const bounds = event.currentTarget.getBoundingClientRect();
    setContextMenu({
      type: "folder",
      path,
      x: event.type === "contextmenu" ? event.clientX : bounds.left + 24,
      y: event.type === "contextmenu" ? event.clientY : bounds.top + 24,
    });
  }
  async function composeFromMessage(uid, type) {
    setContextMenu(null);
    try {
      const message =
        selected === uid && detail?.uid === uid
          ? detail
          : await api(
              `/accounts/${accountId}/messages/${uid}?folder=${encodeURIComponent(folder)}`,
            );
      if (messages.some((item) => item.uid === uid && !item.seen))
        await flag(uid, "seen", true);
      setModal({ type, message });
    } catch (err) {
      setError(err.message);
    }
  }
  if (!auth)
    return (
      <div className="boot">
        <LoaderCircle className="spin" size={32} />
        <span>MiniMail startet …</span>
      </div>
    );
  if (!auth.user || auth.user.mustChangePassword || !auth.user.twoFactorEnabled)
    return (
      <LoginScreen
        auth={auth}
        onDone={() => api("/auth/me").then(applyAuth)}
        request={api}
        theme={theme}
        setTheme={setTheme}
        error={error}
        setError={setError}
      />
    );
  return (
    <div
      className="app-shell"
      style={{
        "--sidebar-width": `${sidebarWidth}px`,
        "--message-width": `${messageWidth}px`,
      }}
    >
      <div className="icon-rail">
        <div className="brand-mark">
          <Mail size={22} strokeWidth={2.5} />
        </div>
        <button className="rail-icon active" title="E-Mail">
          <Mail size={21} />
        </button>
        <div className="rail-spacer" />
        <button
          className="rail-icon"
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          title="Design wechseln"
        >
          {theme === "light" ? <Moon size={21} /> : <Sun size={21} />}
        </button>
        <button
          className="rail-icon"
          onClick={() => setModal("settings")}
          title="Einstellungen"
        >
          <Settings size={21} />
        </button>
        <div className="avatar" title={auth.user.username}>
          {auth.user.username.slice(0, 1).toUpperCase()}
        </div>
      </div>
      <aside className={`sidebar ${mobileSidebar ? "sidebar-open" : ""}`}>
        <div className="sidebar-top">
          <div className="logo-word">
            minimail<span className="logo-dot">.</span>
          </div>
          <button
            className="icon-button close-mobile"
            onClick={() => setMobileSidebar(false)}
          >
            <X size={19} />
          </button>
        </div>
        <button className="compose-button" onClick={() => setModal("compose")}>
          <PenLine size={18} />
          <span>Neue Nachricht</span>
          <Plus size={17} className="compose-plus" />
        </button>
        <div className="sidebar-content">
          <div className="section-label">POSTFÄCHER</div>
          {accounts.length ? (
            <div className="account-list">
              {accounts.map((account) => (
                <button
                  key={account.id}
                  className={`account-choice ${account.id === accountId ? "selected" : ""}`}
                  onClick={() => {
                    setAccountId(account.id);
                    setFolder("INBOX");
                    setFolderFilter("");
                    setCollapsedFolders(new Set());
                    setSelected(null);
                    setPage(0);
                  }}
                >
                  <div className="account-badge">
                    {account.name[0]?.toUpperCase()}
                  </div>
                  <span className="account-text">
                    <strong>{account.name}</strong>
                    <small>
                      {account.needsCredentials
                        ? "Passwort ergänzen"
                        : account.email}
                    </small>
                  </span>
                  {account.inbox_unseen > 0 && !account.needsCredentials && (
                    <b
                      className="account-unseen"
                      title={`${account.inbox_unseen} ungelesene Nachrichten im Posteingang`}
                    >
                      {account.inbox_unseen > 99 ? "99+" : account.inbox_unseen}
                    </b>
                  )}
                  {account.id === accountId && <ChevronDown size={15} />}
                </button>
              ))}
            </div>
          ) : (
            <button
              className="add-account-side"
              onClick={() => setModal("account")}
            >
              <Plus size={16} /> Postfach verbinden
            </button>
          )}
          {accountId && (
            <>
              <div className="section-label folder-heading">
                <span>
                  ORDNER <small>{folders.length}</small>
                </span>
                <button onClick={refresh} title="Ordner aktualisieren">
                  <RefreshCw size={14} />
                </button>
              </div>
              {folders.length > 8 && (
                <div className="folder-search">
                  <Search size={15} />
                  <input
                    value={folderFilter}
                    onChange={(event) => setFolderFilter(event.target.value)}
                    placeholder="Ordner finden …"
                    aria-label="Ordner finden"
                  />
                  {folderFilter && (
                    <button
                      onClick={() => setFolderFilter("")}
                      aria-label="Ordnerfilter löschen"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              )}
              <nav className="folder-list">
                {visibleFolders.map(({ node, depth }) => {
                  const item = node.folder;
                  const meta = folderMeta(item || node),
                    Icon = meta.icon;
                  return (
                    <div
                      key={node.path}
                      className={`folder-row ${folder === node.path ? "current" : ""} ${dropFolder === node.path ? "drop-target" : ""}`}
                      style={{
                        paddingLeft: `${8 + Math.min(depth, 6) * 14}px`,
                      }}
                      onContextMenu={(event) => {
                        if (item) openFolderContextMenu(event, node.path);
                      }}
                      onDragOver={(event) => {
                        const dragged = draggedMessageRef.current;
                        if (
                          !item ||
                          !dragged ||
                          dragged.accountId !== accountId ||
                          dragged.sourceFolder === node.path
                        )
                          return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        if (dropFolder !== node.path) setDropFolder(node.path);
                      }}
                      onDragLeave={(event) => {
                        const bounds = event.currentTarget.getBoundingClientRect();
                        if (
                          event.clientX < bounds.left ||
                          event.clientX >= bounds.right ||
                          event.clientY < bounds.top ||
                          event.clientY >= bounds.bottom
                        )
                          setDropFolder((current) =>
                            current === node.path ? null : current,
                          );
                      }}
                      onDrop={(event) => {
                        const dragged = draggedMessageRef.current;
                        if (
                          !item ||
                          !dragged ||
                          dragged.accountId !== accountId ||
                          dragged.sourceFolder === node.path
                        )
                          return;
                        event.preventDefault();
                        draggedMessageRef.current = null;
                        setDraggingUid(null);
                        setDropFolder(null);
                        move(dragged.uid, node.path, dragged.sourceFolder);
                      }}
                    >
                      <button
                        className="folder-item"
                        onClick={() =>
                          item
                            ? selectFolder(node.path)
                            : toggleFolder(node.path)
                        }
                        title={node.path}
                        onKeyDown={(event) => {
                          if (
                            item &&
                            (event.key === "ContextMenu" ||
                              (event.shiftKey && event.key === "F10"))
                          )
                            openFolderContextMenu(event, node.path);
                        }}
                      >
                        <Icon size={17} />
                        <span>{meta.label}</span>
                        {item?.unseen > 0 && <b>{item.unseen}</b>}
                      </button>
                      {node.children.length > 0 && (
                        <button
                          className="folder-toggle"
                          onClick={() => toggleFolder(node.path)}
                          title={
                            collapsedFolders.has(node.path)
                              ? "Unterordner anzeigen"
                              : "Unterordner ausblenden"
                          }
                          aria-label={`${node.path}: Unterordner ${collapsedFolders.has(node.path) ? "anzeigen" : "ausblenden"}`}
                        >
                          <ChevronDown
                            size={15}
                            className={
                              collapsedFolders.has(node.path) && !folderFilter
                                ? "collapsed"
                                : ""
                            }
                          />
                        </button>
                      )}
                    </div>
                  );
                })}
                {folderFilter && !visibleFolders.length && (
                  <p className="folder-no-results">Kein passender Ordner.</p>
                )}
              </nav>
            </>
          )}
        </div>
        <div className="sidebar-bottom">
          <button
            className="sidebar-settings"
            onClick={() => setModal("settings")}
          >
            <Settings size={17} /> Einstellungen
          </button>
        </div>
        <ResizeHandle
          label="Breite der Ordnerleiste"
          value={sidebarWidth}
          min={180}
          max={sidebarMax}
          defaultWidth={defaultSidebarWidth}
          onResize={setSidebarPreference}
          onCommit={(width) =>
            localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width))
          }
        />
      </aside>
      <main className="workspace">
        <header className="topbar">
          <button
            className="icon-button menu-mobile"
            onClick={() => setMobileSidebar(true)}
          >
            <Menu size={21} />
          </button>
          <div className="breadcrumb">
            <span>Mail</span>
            <ChevronRight size={16} />
            <strong>{folderMeta(activeFolder).label}</strong>
          </div>
          <form
            className="search-box"
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(query.trim());
              setPage(0);
              setSelected(null);
            }}
          >
            <Search size={19} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="E-Mails durchsuchen …"
              aria-label="E-Mails durchsuchen"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setSearch("");
                  setPage(0);
                }}
              >
                <X size={16} />
              </button>
            )}
            <span className="search-key">↵</span>
          </form>
          <div className="top-actions">
            <button
              className="icon-button"
              onClick={refresh}
              title="Aktualisieren"
            >
              <RefreshCw size={19} />
            </button>
            <button
              className="icon-button"
              onClick={() => setModal("settings")}
              title="Einstellungen"
            >
              <Settings size={19} />
            </button>
          </div>
        </header>
        {accounts.length === 0 ? (
          <EmptyAccount onAdd={() => setModal("account")} />
        ) : activeAccount?.needsCredentials ? (
          <div className="reader-empty account-setup-empty">
            <div className="reader-illustration">
              <div className="illustration-mail">
                <LockKeyhole size={42} strokeWidth={1.3} />
              </div>
            </div>
            <h2>Postfach vorbereiten</h2>
            <p>
              Die Serverdaten für {activeAccount.email} sind eingerichtet.
              Ergänze dein Postfach-Passwort, um E-Mails zu laden und zu senden.
            </p>
            <button
              className="primary-button"
              onClick={() => setModal({ type: "edit", account: activeAccount })}
            >
              Zugangsdaten ergänzen
            </button>
          </div>
        ) : (
          <div className="mail-layout">
            <section
              className={`message-panel ${selected ? "hide-mobile" : ""}`}
            >
              <div className="list-header">
                <div>
                  <div className="eyebrow">{activeAccount?.email}</div>
                  <h1>
                    {search ? "Suchergebnisse" : folderMeta(activeFolder).label}
                  </h1>
                  <p>
                    {loading
                      ? "Lade Nachrichten …"
                      : `${total} ${total === 1 ? "Nachricht" : "Nachrichten"}${search ? ` für „${search}“` : ""}`}
                  </p>
                </div>
                <button
                  className="list-menu"
                  title="Aktualisieren"
                  onClick={refresh}
                >
                  <RefreshCw size={18} />
                </button>
              </div>
              <div className="list-toolbar">
                <span>Alle Nachrichten</span>
                <PaginationControls
                  page={page}
                  total={total}
                  loading={loading}
                  onChange={changePage}
                  compact
                />
              </div>
              <div className="message-scroll" ref={messageScrollRef}>
                {loading ? (
                  <div className="panel-loading">
                    <LoaderCircle className="spin" size={25} />
                    <span>Postfach wird geladen</span>
                  </div>
                ) : messages.length ? (
                  messages.map((item) => (
                    <div
                      key={item.uid}
                      className={`message-row ${selected === item.uid ? "selected" : ""} ${!item.seen ? "unread" : ""} ${draggingUid === item.uid ? "dragging" : ""}`}
                      draggable
                      onDragStart={(event) => {
                        draggedMessageRef.current = {
                          uid: item.uid,
                          sourceFolder: folder,
                          accountId,
                        };
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData(
                          "application/x-minimail-message",
                          String(item.uid),
                        );
                        setDraggingUid(item.uid);
                        setContextMenu(null);
                      }}
                      onDragEnd={() => {
                        draggedMessageRef.current = null;
                        setDraggingUid(null);
                        setDropFolder(null);
                      }}
                      onClick={() => setSelected(item.uid)}
                      onContextMenu={(event) =>
                        openContextMenu(event, item.uid)
                      }
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") setSelected(item.uid);
                        if (
                          event.key === "ContextMenu" ||
                          (event.shiftKey && event.key === "F10")
                        )
                          openContextMenu(event, item.uid);
                      }}
                    >
                      <div className="row-avatar">
                        {(
                          item.from?.[0]?.name ||
                          item.from?.[0]?.address ||
                          "?"
                        )
                          .slice(0, 1)
                          .toUpperCase()}
                      </div>
                      <div className="row-main">
                        <div className="row-top">
                          <strong>{fmtAddress(item.from)}</strong>
                          <time>{dateLabel(item.date)}</time>
                        </div>
                        <div className="row-subject" title={item.subject}>
                          <span>{item.subject}</span>
                          {item.hasAttachments && (
                            <Paperclip size={13} aria-label="Mit Anhang" />
                          )}
                        </div>
                      </div>
                      <button
                        className={`star-button ${item.flagged ? "starred" : ""}`}
                        title="Markierung"
                        onClick={(event) => {
                          event.stopPropagation();
                          flag(item.uid, "flagged", !item.flagged);
                        }}
                      >
                        <Star
                          size={16}
                          fill={item.flagged ? "currentColor" : "none"}
                        />
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="empty-list">
                    <div className="empty-icon">
                      <MailOpen size={27} />
                    </div>
                    <h3>
                      {search
                        ? "Keine Treffer gefunden"
                        : "Hier ist alles erledigt"}
                    </h3>
                    <p>
                      {search
                        ? "Versuche einen anderen Suchbegriff."
                        : "In diesem Ordner liegen noch keine Nachrichten."}
                    </p>
                  </div>
                )}
              </div>
              <div className="pagination">
                <PaginationControls
                  page={page}
                  total={total}
                  loading={loading}
                  onChange={changePage}
                />
              </div>
              <ResizeHandle
                label="Breite der Nachrichtenliste"
                value={messageWidth}
                min={260}
                max={messageMax}
                defaultWidth={defaultMessageWidth}
                onResize={setMessagePreference}
                onCommit={(width) =>
                  localStorage.setItem(MESSAGE_WIDTH_KEY, String(width))
                }
              />
            </section>
            <section
              className={`reader-panel ${selected ? "show-mobile" : ""}`}
            >
              {selected ? (
                detailLoading || !detail ? (
                  <div className="reader-loading">
                    <LoaderCircle size={28} className="spin" />
                  </div>
                ) : (
                  <>
                    <div className="reader-toolbar">
                      <button
                        className="icon-button back-mobile"
                        onClick={() => setSelected(null)}
                        title="Zurück"
                      >
                        <ArrowLeft size={20} />
                      </button>
                      <div className="reader-tool-group">
                        <button
                          title="Antworten"
                          onClick={() =>
                            setModal({ type: "reply", message: detail })
                          }
                        >
                          <Reply size={19} />
                        </button>
                        <button title="Archivieren" onClick={() => archive()}>
                          <Archive size={19} />
                        </button>
                        <button
                          title="Als ungelesen markieren"
                          onClick={() => {
                            flag(selected, "seen", false);
                            setSelected(null);
                          }}
                        >
                          <Mail size={19} />
                        </button>
                        <button title="Löschen" onClick={() => remove()}>
                          <Trash2 size={19} />
                        </button>
                      </div>
                      <span className="reader-position">
                        {messages.findIndex((item) => item.uid === selected) +
                          1}{" "}
                        von {total}
                      </span>
                    </div>
                    <div className="reader-scroll">
                      <div className="reader-content">
                        <div className="message-kicker">NACHRICHT</div>
                        <h2>{detail.subject}</h2>
                        <div className="reader-meta">
                          <div className="reader-avatar">
                            {(
                              detail.from?.[0]?.name ||
                              detail.from?.[0]?.address ||
                              "?"
                            )
                              .slice(0, 1)
                              .toUpperCase()}
                          </div>
                          <div className="sender-details">
                            <strong>{fmtAddress(detail.from)}</strong>
                            <span>an {fullAddress(detail.to)}</span>
                          </div>
                          <time>
                            {detail.date
                              ? new Intl.DateTimeFormat("de-DE", {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                }).format(new Date(detail.date))
                              : ""}
                          </time>
                        </div>
                        <div className="message-body">
                          {detail.html ? (
                            <div
                              className="message-html"
                              dangerouslySetInnerHTML={{ __html: detail.html }}
                            />
                          ) : (
                            <div className="plain-text">
                              {detail.text ||
                                "Diese Nachricht enthält keinen lesbaren Text."}
                            </div>
                          )}
                        </div>
                        {detail.attachments?.length > 0 && (
                          <div className="attachments">
                            <h3>
                              <Paperclip size={17} /> Anhänge{" "}
                              <span>{detail.attachments.length}</span>
                            </h3>
                            <div className="attachment-list">
                              {detail.attachments.map((file) => (
                                <a
                                  key={file.index}
                                  href={`/api/accounts/${accountId}/messages/${selected}/attachments/${file.index}?folder=${encodeURIComponent(folder)}`}
                                >
                                  <div className="file-icon">
                                    <FileText size={20} />
                                  </div>
                                  <span>
                                    <strong>{file.filename}</strong>
                                    <small>
                                      {Math.round(file.size / 1024)} KB
                                    </small>
                                  </span>
                                  <Download size={17} />
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="reply-area">
                          <button
                            onClick={() =>
                              setModal({ type: "reply", message: detail })
                            }
                          >
                            <Reply size={17} /> Antworten
                          </button>
                          <button
                            onClick={() =>
                              setModal({ type: "forward", message: detail })
                            }
                          >
                            <ArrowRight size={17} /> Weiterleiten
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                )
              ) : (
                <div className="reader-empty">
                  <div className="reader-illustration">
                    <div className="illustration-mail">
                      <Mail size={46} strokeWidth={1.3} />
                    </div>
                    <span className="orbit orbit-one" />
                    <span className="orbit orbit-two" />
                  </div>
                  <h2>Keine Nachricht ausgewählt</h2>
                  <p>Wähle eine Nachricht aus, um sie hier zu lesen.</p>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
      {contextMenu?.type === "folder" &&
        folders.some((item) => item.path === contextMenu.path) && (
          <div
            ref={contextMenuRef}
            className="message-context-menu folder-context-menu"
            role="menu"
            aria-label="Aktionen für Ordner"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget))
                setContextMenu(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setContextMenu(null);
                contextTriggerRef.current?.focus();
              }
            }}
          >
            <button
              role="menuitem"
              onClick={() => {
                const path = contextMenu.path;
                setContextMenu(null);
                markFolderAsRead(path);
              }}
            >
              <MailOpen size={16} /> Alle Nachrichten als gelesen markieren
            </button>
          </div>
        )}
      {contextMenu && contextMessage && (
        <div
          ref={contextMenuRef}
          className="message-context-menu"
          role="menu"
          aria-label="Aktionen für Nachricht"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
              setContextMenu(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setContextMenu(null);
              contextTriggerRef.current?.focus();
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const items = [...event.currentTarget.querySelectorAll("button")];
              const index = items.indexOf(document.activeElement);
              const step = event.key === "ArrowDown" ? 1 : -1;
              items[(index + step + items.length) % items.length]?.focus();
            }
          }}
        >
          <button
            role="menuitem"
            onClick={() => composeFromMessage(contextMessage.uid, "reply")}
          >
            <Reply size={16} /> Antworten
          </button>
          <button
            role="menuitem"
            onClick={() => composeFromMessage(contextMessage.uid, "reply-all")}
          >
            <Reply size={16} /> Allen antworten
          </button>
          <button
            role="menuitem"
            onClick={() => composeFromMessage(contextMessage.uid, "forward")}
          >
            <ArrowRight size={16} /> Weiterleiten
          </button>
          <div className="context-menu-separator" role="separator" />
          <button
            role="menuitem"
            onClick={() => {
              setContextMenu(null);
              flag(contextMessage.uid, "seen", !contextMessage.seen);
            }}
          >
            {contextMessage.seen ? <Mail size={16} /> : <MailOpen size={16} />}
            {contextMessage.seen
              ? "Als ungelesen markieren"
              : "Als gelesen markieren"}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setContextMenu(null);
              flag(contextMessage.uid, "flagged", !contextMessage.flagged);
            }}
          >
            <Star
              size={16}
              fill={contextMessage.flagged ? "currentColor" : "none"}
            />
            {contextMessage.flagged ? "Markierung entfernen" : "Markieren"}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setContextMenu(null);
              archive(contextMessage.uid);
            }}
          >
            <Archive size={16} /> Archivieren
          </button>
          <div className="context-menu-separator" role="separator" />
          <button
            role="menuitem"
            className="context-menu-danger"
            onClick={() => {
              setContextMenu(null);
              remove(contextMessage.uid);
            }}
          >
            <Trash2 size={16} /> Löschen
          </button>
        </div>
      )}
      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {modal === "account" && (
        <AccountModal
          onClose={() => setModal(null)}
          onSaved={async (newAccount) => {
            const data = await api("/accounts");
            setAccounts(data);
            setAccountId(newAccount.id);
            setModal(null);
          }}
          setError={setError}
        />
      )}
      {modal === "settings" && (
        <SettingsModal
          accounts={accounts}
          auth={auth}
          onClose={() => setModal(null)}
          onEdit={(account) => setModal({ type: "edit", account })}
          onAdd={() => setModal("account")}
          onLogout={async () => {
            await api("/auth/logout", { method: "POST" });
            applyAuth(await api("/auth/me"));
          }}
          setTheme={setTheme}
          theme={theme}
          setError={setError}
          onDeleted={async (id) => {
            const data = await api("/accounts");
            setAccounts(data);
            if (accountId === id) setAccountId(data[0]?.id || null);
          }}
        />
      )}
      {modal?.type === "edit" && (
        <AccountModal
          account={modal.account}
          onClose={() => setModal("settings")}
          onSaved={async () => {
            setAccounts(await api("/accounts"));
            setModal("settings");
            refresh();
          }}
          setError={setError}
        />
      )}
      {(modal === "compose" ||
        modal?.type === "reply" ||
        modal?.type === "reply-all" ||
        modal?.type === "forward") && (
        <ComposeModal
          account={activeAccount}
          initial={modal}
          onClose={() => setModal(null)}
          onSent={() => {
            setModal(null);
            refresh();
          }}
          setError={setError}
        />
      )}
    </div>
  );
}

function EmptyAccount({ onAdd }) {
  return (
    <div className="empty-account">
      <div className="empty-account-art">
        <div className="large-envelope">
          <Mail size={64} strokeWidth={1.25} />
        </div>
        <div className="art-orb a" />
        <div className="art-orb b" />
      </div>
      <h1>Noch kein Postfach verbunden</h1>
      <p>Füge die IMAP- und SMTP-Zugangsdaten deines Mailservers hinzu.</p>
      <button className="primary-button" onClick={onAdd}>
        <Plus size={19} /> Postfach hinzufügen
      </button>
    </div>
  );
}

const blankAccount = {
  name: "",
  email: "",
  imap_host: "",
  imap_port: 993,
  imap_secure: true,
  smtp_host: "",
  smtp_port: 465,
  smtp_secure: true,
  smtp_username: "",
  smtp_password: "",
  username: "",
  password: "",
  check_interval_minutes: 5,
};
function AccountModal({ account, onClose, onSaved, setError }) {
  const [form, setForm] = useState(
    account ? { ...account, password: "", smtp_password: "" } : blankAccount,
  );
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState(false);
  function field(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    setTested(false);
  }
  async function test() {
    setBusy(true);
    try {
      await api("/accounts/test", {
        method: "POST",
        body: { ...form, id: account?.id },
      });
      setTested(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api(
        account ? `/accounts/${account.id}` : "/accounts",
        { method: account ? "PUT" : "POST", body: form },
      );
      onSaved(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal account-modal">
        <div className="modal-header">
          <div>
            <div className="eyebrow">POSTFACH-EINSTELLUNGEN</div>
            <h2>{account ? "Postfach bearbeiten" : "Postfach verbinden"}</h2>
            <p>Deine Zugangsdaten bleiben verschlüsselt auf deinem Server.</p>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <form onSubmit={save}>
          <div className="modal-scroll">
            <div className="form-grid">
              <label>
                Anzeigename
                <input
                  required
                  value={form.name}
                  onChange={(e) => field("name", e.target.value)}
                  placeholder="Mein Postfach"
                />
              </label>
              <label>
                E-Mail-Adresse
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={(e) => field("email", e.target.value)}
                  placeholder="name@beispiel.de"
                />
              </label>
            </div>
            <div className="form-section">
              <div className="form-section-title">
                <Inbox size={18} /> Eingangsserver <span>IMAP</span>
              </div>
              <div className="form-grid host-grid">
                <label>
                  Server
                  <input
                    required
                    value={form.imap_host}
                    onChange={(e) => field("imap_host", e.target.value)}
                    placeholder="imap.beispiel.de"
                  />
                </label>
                <label>
                  Port
                  <input
                    required
                    type="number"
                    min="1"
                    max="65535"
                    value={form.imap_port}
                    onChange={(e) => field("imap_port", Number(e.target.value))}
                  />
                </label>
              </div>
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={form.imap_secure}
                  onChange={(e) => {
                    setForm((current) => ({
                      ...current,
                      imap_secure: e.target.checked,
                      imap_port: e.target.checked ? 993 : 143,
                    }));
                    setTested(false);
                  }}
                />{" "}
                Direktes TLS{" "}
                <small>
                  (
                  {form.imap_secure
                    ? `Port ${form.imap_port}: TLS ab Verbindungsbeginn`
                    : `Port ${form.imap_port}: STARTTLS verpflichtend`}
                  )
                </small>
              </label>
            </div>
            <div className="form-section">
              <div className="form-section-title">
                <Send size={18} /> Ausgangsserver <span>SMTP</span>
              </div>
              <div className="form-grid host-grid">
                <label>
                  Server
                  <input
                    required
                    value={form.smtp_host}
                    onChange={(e) => field("smtp_host", e.target.value)}
                    placeholder="smtp.beispiel.de"
                  />
                </label>
                <label>
                  Port
                  <input
                    required
                    type="number"
                    min="1"
                    max="65535"
                    value={form.smtp_port}
                    onChange={(e) => field("smtp_port", Number(e.target.value))}
                  />
                </label>
              </div>
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={form.smtp_secure}
                  onChange={(e) => {
                    field("smtp_secure", e.target.checked);
                    field("smtp_port", e.target.checked ? 465 : 587);
                  }}
                />{" "}
                Direktes TLS{" "}
                <small>
                  (
                  {form.smtp_secure
                    ? `Port ${form.smtp_port}: TLS ab Verbindungsbeginn`
                    : `Port ${form.smtp_port}: STARTTLS verpflichtend`}
                  )
                </small>
              </label>
              <div className="form-grid">
                <label>
                  SMTP-Benutzername <small>(optional)</small>
                  <input
                    value={form.smtp_username || ""}
                    onChange={(e) => field("smtp_username", e.target.value)}
                    placeholder="Wie bei IMAP"
                  />
                </label>
                <label>
                  SMTP-Passwort <small>(optional)</small>
                  <input
                    type="password"
                    value={form.smtp_password || ""}
                    onChange={(e) => field("smtp_password", e.target.value)}
                    placeholder={
                      account ? "Unverändert lassen" : "Wie bei IMAP"
                    }
                  />
                </label>
              </div>
            </div>
            <div className="form-section credentials">
              <div className="form-section-title">
                <LockKeyhole size={18} /> Anmeldung
              </div>
              <div className="form-grid">
                <label>
                  Benutzername
                  <input
                    required
                    value={form.username}
                    onChange={(e) => field("username", e.target.value)}
                    placeholder="name@beispiel.de"
                  />
                </label>
                <label>
                  Passwort / App-Passwort
                  <input
                    required={!account || account.needsCredentials}
                    type="password"
                    value={form.password}
                    onChange={(e) => field("password", e.target.value)}
                    placeholder={
                      account ? "Unverändert lassen" : "Postfach-Passwort"
                    }
                  />
                </label>
              </div>
              <p>
                Bei Providern mit 2FA benötigst du meistens ein App-Passwort für
                IMAP/SMTP.
              </p>
            </div>
            <div className="form-section">
              <div className="form-section-title">
                <RefreshCw size={18} /> Automatischer Abruf
              </div>
              <label className="interval-field">
                Alle wie viele Minuten prüfen?
                <input
                  type="number"
                  min="0"
                  max="1440"
                  step="1"
                  required
                  value={form.check_interval_minutes ?? 5}
                  onChange={(e) =>
                    field("check_interval_minutes", Number(e.target.value))
                  }
                />
              </label>
              <p className="field-hint">
                Standard: 5 Minuten. Mit 0 ist der automatische Abruf für dieses
                Postfach aus.
              </p>
            </div>
          </div>
          <div className="modal-footer">
            <button
              type="button"
              className="secondary-button"
              onClick={test}
              disabled={busy}
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : tested ? (
                <Check size={16} />
              ) : (
                <RefreshCw size={16} />
              )}{" "}
              {tested ? "Verbindung erfolgreich" : "Verbindung testen"}
            </button>
            <div>
              <button type="button" className="text-button" onClick={onClose}>
                Abbrechen
              </button>
              <button className="primary-button" disabled={busy}>
                {account ? "Speichern" : "Postfach hinzufügen"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function SettingsModal({
  accounts,
  auth,
  onClose,
  onEdit,
  onAdd,
  onLogout,
  setTheme,
  theme,
  setError,
  onDeleted,
}) {
  async function remove(account) {
    if (
      !window.confirm(
        `Postfach „${account.name}“ aus MiniMail entfernen? E-Mails auf dem Server bleiben erhalten.`,
      )
    )
      return;
    try {
      await api(`/accounts/${account.id}`, { method: "DELETE" });
      onDeleted(account.id);
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal settings-modal">
        <div className="modal-header">
          <div>
            <div className="eyebrow">MINIMAIL</div>
            <h2>Einstellungen</h2>
            <p>Postfächer, Benutzer und Darstellung verwalten.</p>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="settings-body">
          <h3>Verbundene Postfächer</h3>
          {accounts.map((account) => (
            <div className="settings-account" key={account.id}>
              <div className="account-badge">
                {account.name[0]?.toUpperCase()}
              </div>
              <div>
                <strong>{account.name}</strong>
                <span>{account.email}</span>
                <span>
                  {account.check_interval_minutes === 0
                    ? "Automatischer Abruf aus"
                    : `Alle ${account.check_interval_minutes} Minuten · ${account.check_failed ? "Prüfung fehlgeschlagen" : account.last_checked_at ? `zuletzt ${new Date(account.last_checked_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}` : "noch nicht geprüft"}`}
                </span>
              </div>
              <button onClick={() => onEdit(account)}>Bearbeiten</button>
              <button
                className="danger-icon"
                title="Entfernen"
                onClick={() => remove(account)}
              >
                <Trash2 size={17} />
              </button>
            </div>
          ))}
          <button className="settings-add" onClick={onAdd}>
            <Plus size={17} /> Weiteres Postfach verbinden
          </button>
          {auth.user.role === "admin" && (
            <UserManagement
              request={api}
              currentUsername={auth.user.username}
              setError={setError}
            />
          )}
          <h3>Darstellung</h3>
          <div className="settings-row">
            <div>
              <strong>Farbschema</strong>
              <span>Wähle deinen bevorzugten Modus.</span>
            </div>
            <button
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              {theme === "light" ? <Sun size={17} /> : <Moon size={17} />}{" "}
              {theme === "light" ? "Hell" : "Dunkel"}
            </button>
          </div>
          <h3>Sicherheit</h3>
          <div className="settings-row">
            <div>
              <strong>Zwei-Faktor-Anmeldung</strong>
              <span>Für {auth.user.username} aktiviert</span>
            </div>
            <ShieldCheck size={20} className="secure-green" />
          </div>
          <button className="logout-button" onClick={onLogout}>
            Abmelden
          </button>
        </div>
      </div>
    </div>
  );
}

function ComposeModal({ account, initial, onClose, onSent, setError }) {
  const replyAll = initial?.type === "reply-all",
    reply = initial?.type === "reply" || replyAll,
    forward = initial?.type === "forward",
    original = initial?.message;
  const replyRecipients = replyAll ? replyAllCc(original, account?.email) : "";
  const [to, setTo] = useState(reply ? original.from?.[0]?.address || "" : "");
  const [cc, setCc] = useState(replyRecipients);
  const [subject, setSubject] = useState(
    original
      ? `${reply ? "Re" : "Fwd"}: ${original.subject.replace(/^(Re|Fwd):\s*/i, "")}`
      : "",
  );
  const [body, setBody] = useState(
    forward
      ? `\n\n---------- Weitergeleitete Nachricht ----------\nVon: ${fullAddress(original.from)}\nDatum: ${original.date ? new Date(original.date).toLocaleString("de-DE") : ""}\nBetreff: ${original.subject}\n\n${original.text || ""}`
      : reply
        ? `\n\nAm ${original.date ? new Date(original.date).toLocaleString("de-DE") : ""} schrieb ${fmtAddress(original.from)}:\n${(
            original.text || ""
          )
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n")}`
        : "",
  );
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [showCc, setShowCc] = useState(Boolean(replyRecipients));
  async function submit(event) {
    event.preventDefault();
    if (!account) {
      setError("Bitte zuerst ein Postfach verbinden.");
      return;
    }
    setBusy(true);
    try {
      const attachments = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          data: await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(",")[1]);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          }),
        })),
      );
      await api(`/accounts/${account.id}/send`, {
        method: "POST",
        body: { to, cc, subject, text: body, attachments },
      });
      onSent();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="modal-backdrop compose-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal compose-modal">
        <div className="compose-header">
          <div>
            <div className="eyebrow">
              VON {account?.email || "KEIN POSTFACH"}
            </div>
            <h2>
              {reply
                ? replyAll
                  ? "Allen antworten"
                  : "Antworten"
                : forward
                  ? "Weiterleiten"
                  : "Neue Nachricht"}
            </h2>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="compose-fields">
            <div className="compose-field">
              <span>An</span>
              <input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="Empfänger-Adresse"
                required
                type="text"
              />
              <button type="button" onClick={() => setShowCc(!showCc)}>
                Cc
              </button>
            </div>
            {showCc && (
              <div className="compose-field">
                <span>Cc</span>
                <input
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  placeholder="Kopie an"
                />
              </div>
            )}
            <div className="compose-field">
              <span>Betreff</span>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Worum geht es?"
              />
            </div>
          </div>
          <textarea
            className="compose-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Schreibe deine Nachricht …"
            required
          />
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
              <button className="primary-button" disabled={busy || !account}>
                {busy ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <Send size={17} />
                )}{" "}
                Senden
              </button>
              <label className="attachment-button" title="Dateien anhängen">
                <Paperclip size={19} />
                <input
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => {
                    const next = [...files, ...Array.from(e.target.files)];
                    if (
                      next.reduce((sum, file) => sum + file.size, 0) >
                      8 * 1024 * 1024
                    ) {
                      setError(
                        "Anhänge dürfen zusammen höchstens 8 MB groß sein.",
                      );
                      return;
                    }
                    setFiles(next.slice(0, 8));
                  }}
                />
              </label>
            </div>
            <span>Gesendet über {account?.name || "MiniMail"}</span>
          </div>
        </form>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
