import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import LoginScreen from "./LoginScreen.jsx";
import UserManagement from "./UserManagement.jsx";
import MailTrace from "./MailTrace.jsx";
import { highlightMailSource } from "./mailSourceHighlight.js";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Check,
  Contact,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  FileCode2,
  Inbox,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Mail,
  MailOpen,
  MapPinned,
  Menu,
  Minus,
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
  Sparkles,
  Star,
  Sun,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import AiSettings from "./AiSettings.jsx";
import "./style.css";
import { buildFolderTree, visibleFolderNodes } from "./folderTree.js";
import { replyRecipients } from "./replyRecipients.js";
import {
  choose,
  dateLocale,
  getLanguage,
  setLanguage as updateLanguage,
  t,
} from "./i18n.js";

const PAGE_SIZE = 60;
const SIDEBAR_WIDTH_KEY = "minimail-sidebar-width";
const MESSAGE_WIDTH_KEY = "minimail-message-width";
const SIDEBAR_WIDE_WIDTH_KEY = "minimail-sidebar-wide-width";
const MESSAGE_WIDE_WIDTH_KEY = "minimail-message-wide-width";
const READER_ZOOM_KEY = "minimail-reader-zoom";
const READER_WIDE_ZOOM_KEY = "minimail-reader-wide-zoom";
const THREAD_VIEW_KEY = "minimail-thread-view";

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
      title={t("Breite ziehen · Doppelklick setzt zurück")}
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
  if (!response.ok)
    throw new Error(t(payload.error || `HTTP ${response.status}`));
  return payload;
}
const fmtAddress = (list) =>
  list?.map((item) => item.name || item.address).join(", ") || t("Unbekannt");
const fullAddress = (list) =>
  list
    ?.map((item) =>
      item.name ? `${item.name} <${item.address}>` : item.address,
    )
    .join(", ") || "";
function dateLabel(value) {
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

function securityText(security) {
  if (!security) return "";
  const kind = security.kind === "pgp" ? "OpenPGP" : "S/MIME";
  if (security.status === "missing-key")
    return choose(
      `${kind}: Verschlüsselt, aber kein passender privater Schlüssel eingerichtet.`,
      `${kind}: Encrypted, but no matching private key is configured.`,
    );
  if (security.status === "error")
    return choose(
      `${kind}: Entschlüsselung oder Signaturprüfung fehlgeschlagen.`,
      `${kind}: Decryption or signature verification failed.`,
    );
  if (security.signature === "invalid")
    return choose(`${kind}: Signatur ungültig.`, `${kind}: Invalid signature.`);
  if (security.signature === "expired")
    return choose(
      `${kind}: Signatur geprüft, aber das Zertifikat ist abgelaufen oder noch nicht gültig.`,
      `${kind}: Signature verified, but the certificate has expired or is not yet valid.`,
    );
  if (security.signature === "identity-mismatch")
    return choose(
      `${kind}: Signatur gültig, aber das Zertifikat passt nicht zur Absenderadresse.`,
      `${kind}: Signature valid, but the certificate does not match the sender address.`,
    );
  if (security.signature === "untrusted")
    return choose(
      `${kind}: Signatur gültig, Zertifikatskette nicht als vertrauenswürdig bestätigt.`,
      `${kind}: Signature valid; certificate chain not trusted.`,
    );
  if (security.signature === "unknown-key")
    return choose(
      `${kind}: Signiert, aber kein öffentlicher Schlüssel zur Prüfung vorhanden.`,
      `${kind}: Signed, but no public key is available for verification.`,
    );
  if (security.signature === "valid")
    return choose(
      `${kind}: Signatur gültig${security.encrypted ? "; Nachricht entschlüsselt" : ""}.`,
      `${kind}: Valid signature${security.encrypted ? "; message decrypted" : ""}.`,
    );
  if (security.encrypted)
    return choose(
      `${kind}: Nachricht entschlüsselt.`,
      `${kind}: Message decrypted.`,
    );
  return choose(`${kind}: Signierte Nachricht.`, `${kind}: Signed message.`);
}
function isTrashFolder(folder) {
  if (folder?.specialUse) return folder.specialUse === "\\Trash";
  return /^(papierkorb|trash|deleted items|deleted messages|gelöscht|gelöschte elemente)$/i.test(
    folder?.name || "",
  );
}
function folderMeta(folder) {
  const name = folder?.name || folder?.path || t("Posteingang");
  const type = folder?.specialUse || "";
  if (type === "\\Sent" || /^(gesendet|sent|sent items|sent mail)$/i.test(name))
    return { icon: Send, label: t("Gesendet") };
  if (type === "\\Drafts" || /^(entwürfe|entwurf|drafts?)$/i.test(name))
    return { icon: FileText, label: t("Entwürfe") };
  if (isTrashFolder(folder)) return { icon: Trash2, label: t("Papierkorb") };
  if (type === "\\Archive" || /^(archiv|archive)$/i.test(name))
    return { icon: Archive, label: t("Archiv") };
  if (folder?.path?.toUpperCase() === "INBOX")
    return { icon: Inbox, label: t("Posteingang") };
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
      aria-label={t("Nachrichtenseiten")}
    >
      {!compact && (
        <button
          type="button"
          title={t("Erste Seite")}
          aria-label={t("Erste Seite")}
          disabled={loading || page === 0}
          onClick={() => onChange(0)}
        >
          «
        </button>
      )}
      <button
        type="button"
        title={t("Neuere Nachrichten")}
        aria-label={t("Neuere Nachrichten")}
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
          <label htmlFor="mail-page">{t("Seite")}</label>
          <input
            id="mail-page"
            type="number"
            min="1"
            max={pages}
            value={entry}
            onChange={(event) => setEntry(event.target.value)}
            onBlur={jump}
            aria-label={t("Seitennummer")}
          />
          <span>
            {t("von ")}
            {pages}
          </span>
        </form>
      )}
      <button
        type="button"
        title={t("Ältere Nachrichten")}
        aria-label={t("Ältere Nachrichten")}
        disabled={loading || page >= pages - 1}
        onClick={() => onChange(page + 1)}
      >
        <ChevronRight size={17} />
      </button>
      {!compact && (
        <button
          type="button"
          title={t("Letzte Seite")}
          aria-label={t("Letzte Seite")}
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
  const [threaded, setThreaded] = useState(
    () => localStorage.getItem(THREAD_VIEW_KEY) === "1",
  );
  const [expandedThreads, setExpandedThreads] = useState(new Set());
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
  const [loggingOut, setLoggingOut] = useState(false);
  const [language, setLanguageState] = useState(getLanguage);
  const [theme, setTheme] = useState(
    localStorage.getItem("minimail-theme") || "light",
  );
  const [refreshKey, setRefreshKey] = useState(0);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [sidebarPreferences, setSidebarPreferences] = useState(() => ({
    standard: storedWidth(SIDEBAR_WIDTH_KEY),
    wide: storedWidth(SIDEBAR_WIDE_WIDTH_KEY),
  }));
  const [messagePreferences, setMessagePreferences] = useState(() => ({
    standard: storedWidth(MESSAGE_WIDTH_KEY),
    wide: storedWidth(MESSAGE_WIDE_WIDTH_KEY),
  }));
  const [readerZoomPreferences, setReaderZoomPreferences] = useState(() => ({
    standard: storedWidth(READER_ZOOM_KEY),
    wide: storedWidth(READER_WIDE_ZOOM_KEY),
  }));
  const wideDesktop = windowWidth >= 1600;
  const widthTier = wideDesktop ? "wide" : "standard";
  const narrowDesktop = windowWidth <= 1060;
  const railWidth = narrowDesktop
    ? 58
    : wideDesktop
      ? windowWidth >= 2100
        ? 92
        : 80
      : 72;
  const defaultSidebarWidth = narrowDesktop
    ? 210
    : wideDesktop
      ? windowWidth >= 2100
        ? Math.min(430, Math.max(360, Math.round(windowWidth * 0.16)))
        : Math.min(355, Math.max(280, Math.round(windowWidth * 0.14)))
      : 247;
  const defaultMessageWidth = narrowDesktop
    ? 265
    : wideDesktop
      ? windowWidth >= 2100
        ? Math.min(740, Math.max(540, Math.round(windowWidth * 0.27)))
        : Math.min(620, Math.max(420, Math.round(windowWidth * 0.24)))
      : 374;
  const sidebarMax = Math.max(
    180,
    Math.min(wideDesktop ? 560 : 440, windowWidth - railWidth - 260 - 220),
  );
  const sidebarWidth = Math.min(
    sidebarMax,
    Math.max(180, sidebarPreferences[widthTier] ?? defaultSidebarWidth),
  );
  const messageMax = Math.max(
    260,
    Math.min(900, windowWidth - railWidth - sidebarWidth - 220),
  );
  const messageWidth = Math.min(
    messageMax,
    Math.max(260, messagePreferences[widthTier] ?? defaultMessageWidth),
  );
  const readerZoom = narrowDesktop
    ? 100
    : Math.min(
        175,
        Math.max(
          75,
          readerZoomPreferences[widthTier] ??
            (wideDesktop
              ? windowWidth >= 2200
                ? 135
                : windowWidth >= 1800
                  ? 125
                  : 110
              : 100),
        ),
      );
  function changeReaderZoom(delta) {
    const next = Math.min(175, Math.max(75, readerZoom + delta));
    setReaderZoomPreferences((current) => ({ ...current, [widthTier]: next }));
    localStorage.setItem(
      wideDesktop ? READER_WIDE_ZOOM_KEY : READER_ZOOM_KEY,
      String(next),
    );
  }
  const messageScrollRef = useRef(null);
  const contextMessage =
    contextMenu?.type === "message"
      ? messages
          .flatMap((item) => item.thread || [item])
          .find((item) => item.uid === contextMenu.uid)
      : null;
  const selectedThread = threaded
    ? messages.find((item) =>
        item.thread?.some((member) => member.uid === selected),
      )
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
  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await api("/auth/logout", { method: "POST" });
      applyAuth({ user: null, adminSetupRequired: false });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoggingOut(false);
    }
  }
  function selectLanguage(next) {
    updateLanguage(next);
    setLanguageState(next);
  }
  function selectThreaded(next) {
    setThreaded(next);
    localStorage.setItem(THREAD_VIEW_KEY, next ? "1" : "0");
    setPage(0);
    setSelected(null);
    setExpandedThreads(new Set());
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
        setAccountId(
          (current) =>
            current ??
            data.find((account) => account.is_primary)?.id ??
            data[0]?.id ??
            null,
        );
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
          err.message === t("Bitte anmelden.")
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
      `/accounts/${accountId}/messages?folder=${encodeURIComponent(folder)}&q=${encodeURIComponent(search)}&page=${page}&threaded=${threaded ? "1" : "0"}`,
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
    threaded,
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
          if (
            messages
              .flatMap((item) => item.thread || [item])
              .some((item) => item.uid === selected && !item.seen)
          )
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
    setExpandedThreads(new Set());
    setMobileSidebar(false);
  }
  function changePage(nextPage) {
    if (nextPage === page) return;
    setPage(nextPage);
    setSelected(null);
    setExpandedThreads(new Set());
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
        current.map((item) => {
          const thread = item.thread?.map((member) =>
            member.uid === uid ? { ...member, [key]: enabled } : member,
          );
          return {
            ...item,
            ...(item.uid === uid ? { [key]: enabled } : {}),
            ...(thread
              ? {
                  thread,
                  threadUnread: thread.some((member) => !member.seen),
                }
              : {}),
          };
        }),
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
      setMessages((current) =>
        current.map((item) => ({
          ...item,
          seen: true,
          ...(item.thread
            ? {
                thread: item.thread.map((member) => ({
                  ...member,
                  seen: true,
                })),
                threadUnread: false,
              }
            : {}),
        })),
      );
    if (path.toUpperCase() === "INBOX")
      setAccounts((current) =>
        current.map((item) =>
          item.id === currentAccountId ? { ...item, inbox_unseen: 0 } : item,
        ),
      );
  }
  async function emptyTrashFolder(path) {
    const currentAccountId = accountId;
    const success = await withAction(() =>
      api(`/accounts/${currentAccountId}/trash/empty`, {
        method: "POST",
        body: { folder: path },
      }),
    );
    if (!success) return;
    setModal(null);
    if (
      activeAccountIdRef.current === currentAccountId &&
      activeFolderRef.current === path
    ) {
      setSelected(null);
      setMessages([]);
      setTotal(0);
      setPage(0);
    }
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
      if (!threaded)
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
      if (!threaded)
        setMessages((current) => current.filter((item) => item.uid !== uid));
    }
  }
  async function archive(uid = selected) {
    const target = folders.find(
      (item) =>
        item.specialUse === "\\Archive" || /archiv|archive/i.test(item.name),
    );
    if (!target || !uid) {
      setError(t("Kein Archivordner auf diesem Postfach gefunden."));
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
      if (
        messages
          .flatMap((item) => item.thread || [item])
          .some((item) => item.uid === uid && !item.seen)
      )
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
        <span>{t("MiniMail startet …")}</span>
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
        language={language}
        onLanguageChange={selectLanguage}
        error={error}
        setError={setError}
      />
    );
  return (
    <div
      className={`app-shell${wideDesktop ? " wide-layout" : ""}`}
      style={{
        "--sidebar-width": `${sidebarWidth}px`,
        "--message-width": `${messageWidth}px`,
        "--reader-zoom": String(readerZoom / 100),
        "--reader-zoom-width": `${10000 / readerZoom}%`,
      }}
    >
      <div className="icon-rail">
        <div className="brand-mark">
          <Mail size={22} strokeWidth={2.5} />
        </div>
        <button className="rail-icon active" title={t("E-Mail")}>
          <Mail size={21} />
        </button>
        <button
          className="rail-icon"
          onClick={() => setModal("contacts")}
          title={t("Adressbuch")}
          aria-label={t("Adressbuch")}
        >
          <Contact size={21} />
        </button>
        <div className="rail-spacer" />
        <button
          className="rail-icon"
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          title={t("Design wechseln")}
        >
          {theme === "light" ? <Moon size={21} /> : <Sun size={21} />}
        </button>
        <button
          className="rail-icon"
          onClick={() => setModal("settings")}
          title={t("Einstellungen")}
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
            {t("\n            minimail")}
            <span className="logo-dot">.</span>
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
          <span>{t("Neue Nachricht")}</span>
          <Plus size={17} className="compose-plus" />
        </button>
        <div className="sidebar-content">
          <div className="section-label">{t("POSTFÄCHER")}</div>
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
                    <span className="account-name-line">
                      <strong>{account.name}</strong>
                      {account.is_primary && (
                        <Star
                          size={12}
                          fill="currentColor"
                          aria-label={t("Primärpostfach")}
                        />
                      )}
                    </span>
                    <small>
                      {account.needsCredentials
                        ? t("Passwort ergänzen")
                        : account.email}
                    </small>
                  </span>
                  {account.inbox_unseen > 0 && !account.needsCredentials && (
                    <b
                      className="account-unseen"
                      title={choose(
                        `${account.inbox_unseen} ungelesene Nachrichten im Posteingang`,
                        `${account.inbox_unseen} unread messages in the inbox`,
                      )}
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
              <Plus size={16} />
              {t(" Postfach verbinden\n            ")}
            </button>
          )}
          {accountId && (
            <>
              <div className="section-label folder-heading">
                <span>
                  {t("\n                  ORDNER ")}
                  <small>{folders.length}</small>
                </span>
                <button onClick={refresh} title={t("Ordner aktualisieren")}>
                  <RefreshCw size={14} />
                </button>
              </div>
              {folders.length > 8 && (
                <div className="folder-search">
                  <Search size={15} />
                  <input
                    value={folderFilter}
                    onChange={(event) => setFolderFilter(event.target.value)}
                    placeholder={t("Ordner finden …")}
                    aria-label={t("Ordner finden")}
                  />
                  {folderFilter && (
                    <button
                      onClick={() => setFolderFilter("")}
                      aria-label={t("Ordnerfilter löschen")}
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
                        const bounds =
                          event.currentTarget.getBoundingClientRect();
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
                              ? t("Unterordner anzeigen")
                              : t("Unterordner ausblenden")
                          }
                          aria-label={choose(
                            `${node.path}: Unterordner ${collapsedFolders.has(node.path) ? "anzeigen" : "ausblenden"}`,
                            `${node.path}: ${collapsedFolders.has(node.path) ? "show" : "hide"} subfolders`,
                          )}
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
                  <p className="folder-no-results">
                    {t("Kein passender Ordner.")}
                  </p>
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
            <Settings size={17} />
            {t(" Einstellungen\n          ")}
          </button>
          <button
            className="sidebar-settings sidebar-logout"
            onClick={logout}
            disabled={loggingOut}
          >
            <LogOut size={17} /> {loggingOut ? t("Abmelden …") : t("Abmelden")}
          </button>
        </div>
        <ResizeHandle
          label={t("Breite der Ordnerleiste")}
          value={sidebarWidth}
          min={180}
          max={sidebarMax}
          defaultWidth={defaultSidebarWidth}
          onResize={(width) =>
            setSidebarPreferences((current) => ({
              ...current,
              [widthTier]: width,
            }))
          }
          onCommit={(width) =>
            localStorage.setItem(
              wideDesktop ? SIDEBAR_WIDE_WIDTH_KEY : SIDEBAR_WIDTH_KEY,
              String(width),
            )
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
            <span>{t("Mail")}</span>
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
              placeholder={t("E-Mails durchsuchen …")}
              aria-label={t("E-Mails durchsuchen")}
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
              title={t("Aktualisieren")}
            >
              <RefreshCw size={19} />
            </button>
            <button
              className="icon-button"
              onClick={() => setModal("settings")}
              title={t("Einstellungen")}
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
            <h2>{t("Postfach vorbereiten")}</h2>
            <p>
              {t("\n              Die Serverdaten für ")}
              {activeAccount.email}
              {t(
                " sind eingerichtet.\n              Ergänze dein Postfach-Passwort, um E-Mails zu laden und zu senden.\n            ",
              )}
            </p>
            <button
              className="primary-button"
              onClick={() => setModal({ type: "edit", account: activeAccount })}
            >
              {t("\n              Zugangsdaten ergänzen\n            ")}
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
                    {search
                      ? t("Suchergebnisse")
                      : folderMeta(activeFolder).label}
                  </h1>
                  <p>
                    {loading
                      ? t("Lade Nachrichten …")
                      : `${total} ${threaded ? (total === 1 ? t("Konversation") : t("Konversationen")) : total === 1 ? t("Nachricht") : t("Nachrichten")}${search ? choose(` für „${search}“`, ` for “${search}”`) : ""}`}
                  </p>
                </div>
                <div className="list-header-actions">
                  {isTrashFolder(activeFolder) && (
                    <button
                      className="empty-trash-button"
                      aria-label={t("Papierkorb leeren")}
                      title={t("Papierkorb leeren")}
                      onClick={() =>
                        setModal({ type: "empty-trash", path: folder })
                      }
                    >
                      <Trash2 size={15} />
                      <span className="empty-trash-label">
                        {t(
                          "\n                        Papierkorb leeren\n                      ",
                        )}
                      </span>
                    </button>
                  )}
                  <button
                    className="list-menu"
                    title={t("Aktualisieren")}
                    onClick={refresh}
                  >
                    <RefreshCw size={18} />
                  </button>
                </div>
              </div>
              <div className="list-toolbar">
                <button
                  type="button"
                  className="thread-mode-button"
                  aria-pressed={threaded}
                  title={t("Konversationsansicht umschalten")}
                  onClick={() => selectThreaded(!threaded)}
                >
                  {threaded ? t("Konversationen") : t("Alle Nachrichten")}
                  <ChevronDown size={13} />
                </button>
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
                    <span>{t("Postfach wird geladen")}</span>
                  </div>
                ) : messages.length ? (
                  messages.map((item) => (
                    <React.Fragment key={item.uid}>
                      <div
                        className={`message-row ${selected === item.uid ? "selected" : ""} ${threaded ? (item.threadUnread ? "unread" : "") : !item.seen ? "unread" : ""} ${draggingUid === item.uid ? "dragging" : ""}`}
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
                        {threaded && item.thread?.length > 1 && (
                          <button
                            type="button"
                            className="thread-toggle"
                            aria-label={
                              expandedThreads.has(item.uid)
                                ? t("Konversation einklappen")
                                : t("Konversation aufklappen")
                            }
                            aria-expanded={expandedThreads.has(item.uid)}
                            onClick={(event) => {
                              event.stopPropagation();
                              setExpandedThreads((current) => {
                                const next = new Set(current);
                                if (next.has(item.uid)) next.delete(item.uid);
                                else next.add(item.uid);
                                return next;
                              });
                            }}
                          >
                            {expandedThreads.has(item.uid) ? (
                              <ChevronDown size={16} />
                            ) : (
                              <ChevronRight size={16} />
                            )}
                          </button>
                        )}
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
                            {threaded && item.thread?.length > 1 && (
                              <span
                                className="thread-count"
                                title={t("Nachrichten in der Konversation")}
                              >
                                {item.thread.length}
                              </span>
                            )}
                            {item.hasAttachments && (
                              <Paperclip
                                size={13}
                                aria-label={t("Mit Anhang")}
                              />
                            )}
                          </div>
                        </div>
                        <button
                          className={`star-button ${item.flagged ? "starred" : ""}`}
                          title={t("Markierung")}
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
                      {threaded &&
                        expandedThreads.has(item.uid) &&
                        item.thread
                          ?.slice(0, -1)
                          .reverse()
                          .map((member) => (
                            <div
                              key={member.uid}
                              className={`message-row thread-child ${selected === member.uid ? "selected" : ""} ${!member.seen ? "unread" : ""} ${draggingUid === member.uid ? "dragging" : ""}`}
                              draggable
                              onDragStart={(event) => {
                                draggedMessageRef.current = {
                                  uid: member.uid,
                                  sourceFolder: folder,
                                  accountId,
                                };
                                event.dataTransfer.effectAllowed = "move";
                                event.dataTransfer.setData(
                                  "application/x-minimail-message",
                                  String(member.uid),
                                );
                                setDraggingUid(member.uid);
                                setContextMenu(null);
                              }}
                              onDragEnd={() => {
                                draggedMessageRef.current = null;
                                setDraggingUid(null);
                                setDropFolder(null);
                              }}
                              onClick={() => setSelected(member.uid)}
                              onContextMenu={(event) =>
                                openContextMenu(event, member.uid)
                              }
                              role="button"
                              tabIndex={0}
                              onKeyDown={(event) => {
                                if (event.key === "Enter")
                                  setSelected(member.uid);
                                if (
                                  event.key === "ContextMenu" ||
                                  (event.shiftKey && event.key === "F10")
                                )
                                  openContextMenu(event, member.uid);
                              }}
                            >
                              <div className="thread-line" aria-hidden="true" />
                              <div className="row-avatar">
                                {(
                                  member.from?.[0]?.name ||
                                  member.from?.[0]?.address ||
                                  "?"
                                )
                                  .slice(0, 1)
                                  .toUpperCase()}
                              </div>
                              <div className="row-main">
                                <div className="row-top">
                                  <strong>{fmtAddress(member.from)}</strong>
                                  <time>{dateLabel(member.date)}</time>
                                </div>
                                <div
                                  className="row-subject"
                                  title={member.subject}
                                >
                                  <span>{member.subject}</span>
                                  {member.hasAttachments && (
                                    <Paperclip
                                      size={13}
                                      aria-label={t("Mit Anhang")}
                                    />
                                  )}
                                </div>
                              </div>
                              <button
                                className={`star-button ${member.flagged ? "starred" : ""}`}
                                title={t("Markierung")}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  flag(member.uid, "flagged", !member.flagged);
                                }}
                              >
                                <Star
                                  size={16}
                                  fill={
                                    member.flagged ? "currentColor" : "none"
                                  }
                                />
                              </button>
                            </div>
                          ))}
                    </React.Fragment>
                  ))
                ) : (
                  <div className="empty-list">
                    <div className="empty-icon">
                      <MailOpen size={27} />
                    </div>
                    <h3>
                      {search
                        ? t("Keine Treffer gefunden")
                        : t("Hier ist alles erledigt")}
                    </h3>
                    <p>
                      {search
                        ? t("Versuche einen anderen Suchbegriff.")
                        : t("In diesem Ordner liegen noch keine Nachrichten.")}
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
                label={t("Breite der Nachrichtenliste")}
                value={messageWidth}
                min={260}
                max={messageMax}
                defaultWidth={defaultMessageWidth}
                onResize={(width) =>
                  setMessagePreferences((current) => ({
                    ...current,
                    [widthTier]: width,
                  }))
                }
                onCommit={(width) =>
                  localStorage.setItem(
                    wideDesktop ? MESSAGE_WIDE_WIDTH_KEY : MESSAGE_WIDTH_KEY,
                    String(width),
                  )
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
                        title={t("Zurück")}
                      >
                        <ArrowLeft size={20} />
                      </button>
                      <div className="reader-tool-group">
                        <button
                          title={t("Allen antworten")}
                          aria-label={t("Allen antworten")}
                          onClick={() =>
                            setModal({ type: "reply-all", message: detail })
                          }
                        >
                          <Reply size={19} />
                        </button>
                        <button
                          title={t("Archivieren")}
                          aria-label={t("Archivieren")}
                          onClick={() => archive()}
                        >
                          <Archive size={19} />
                        </button>
                        <button
                          title={t("Als ungelesen markieren")}
                          aria-label={t("Als ungelesen markieren")}
                          onClick={() => {
                            flag(selected, "seen", false);
                            setSelected(null);
                          }}
                        >
                          <Mail size={19} />
                        </button>
                        <button
                          title={t("Löschen")}
                          aria-label={t("Löschen")}
                          onClick={() => remove()}
                        >
                          <Trash2 size={19} />
                        </button>
                        <button
                          title={t("Nachrichtenquelltext anzeigen")}
                          aria-label={t("Nachrichtenquelltext anzeigen")}
                          onClick={() =>
                            setModal({ type: "source", uid: detail.uid })
                          }
                        >
                          <FileCode2 size={19} />
                        </button>
                        <button
                          title={t("Mail-Weg auf Karte anzeigen")}
                          aria-label={t("Mail-Weg auf Karte anzeigen")}
                          onClick={() =>
                            setModal({ type: "trace", uid: detail.uid })
                          }
                        >
                          <MapPinned size={19} />
                        </button>
                        <button
                          title={t("Mit KI zusammenfassen")}
                          aria-label={t("Mit KI zusammenfassen")}
                          onClick={() =>
                            setModal({ type: "summary", uid: detail.uid })
                          }
                        >
                          <Sparkles size={19} />
                        </button>
                      </div>
                      <div
                        className="reader-zoom-controls"
                        role="group"
                        aria-label={t("Lesedarstellung")}
                      >
                        <button
                          type="button"
                          onClick={() => changeReaderZoom(-10)}
                          disabled={readerZoom <= 75}
                          title={t("Mailtext verkleinern")}
                          aria-label={t("Mailtext verkleinern")}
                        >
                          <Minus size={17} />
                        </button>
                        <span>{readerZoom}%</span>
                        <button
                          type="button"
                          onClick={() => changeReaderZoom(10)}
                          disabled={readerZoom >= 175}
                          title={t("Mailtext vergrößern")}
                          aria-label={t("Mailtext vergrößern")}
                        >
                          <Plus size={17} />
                        </button>
                      </div>
                      <span className="reader-position">
                        {messages.findIndex(
                          (item) =>
                            item.uid === (selectedThread?.uid || selected),
                        ) + 1}{" "}
                        {t("\n                        von ")}
                        {total}
                      </span>
                    </div>
                    <div className="reader-scroll">
                      <div className="reader-content">
                        {selectedThread?.thread?.length > 1 && (
                          <div
                            className="reader-thread"
                            aria-label={t("Nachrichten in der Konversation")}
                          >
                            <strong>
                              {selectedThread.thread.length}{" "}
                              {t("Nachrichten in dieser Konversation")}
                            </strong>
                            <div className="reader-thread-items">
                              {selectedThread.thread.map((member) => (
                                <button
                                  type="button"
                                  key={member.uid}
                                  className={
                                    selected === member.uid ? "active" : ""
                                  }
                                  onClick={() => setSelected(member.uid)}
                                >
                                  <span>{fmtAddress(member.from)}</span>
                                  <time>{dateLabel(member.date)}</time>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="message-kicker">{t("NACHRICHT")}</div>
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
                            <span>
                              {t("an ")}
                              {fullAddress(detail.to)}
                            </span>
                            {!!detail.cc?.length && (
                              <span>Cc: {fullAddress(detail.cc)}</span>
                            )}
                            {!!detail.bcc?.length && (
                              <span>Bcc: {fullAddress(detail.bcc)}</span>
                            )}
                          </div>
                          <time>
                            {detail.date
                              ? new Intl.DateTimeFormat(dateLocale(), {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                }).format(new Date(detail.date))
                              : ""}
                          </time>
                        </div>
                        {detail.security && (
                          <div
                            className={`message-security ${["error", "missing-key"].includes(detail.security.status) || ["invalid", "expired", "identity-mismatch", "untrusted", "unknown-key"].includes(detail.security.signature) ? "warning" : "verified"}`}
                            role="status"
                          >
                            <LockKeyhole size={18} />
                            <span>
                              {securityText(detail.security)}
                              {detail.security.fingerprint && (
                                <small>
                                  {t("Fingerabdruck")}:{" "}
                                  {detail.security.fingerprint}
                                </small>
                              )}
                            </span>
                          </div>
                        )}
                        <div className="message-body">
                          {detail.html ? (
                            <div
                              className="message-html"
                              dangerouslySetInnerHTML={{ __html: detail.html }}
                            />
                          ) : (
                            <div className="plain-text">
                              {detail.text ||
                                t(
                                  "Diese Nachricht enthält keinen lesbaren Text.",
                                )}
                            </div>
                          )}
                        </div>
                        {detail.attachments?.length > 0 && (
                          <div className="attachments">
                            <h3>
                              <Paperclip size={17} />
                              {t(" Anhänge")}{" "}
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
                                      {Math.round(file.size / 1024)}
                                      {t(
                                        " KB\n                                    ",
                                      )}
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
                              setModal({ type: "reply-all", message: detail })
                            }
                          >
                            <Reply size={17} />
                            {t("Allen antworten")}
                          </button>
                          <button
                            onClick={() =>
                              setModal({ type: "forward", message: detail })
                            }
                          >
                            <ArrowRight size={17} />
                            {t(" Weiterleiten\n                          ")}
                          </button>
                          <button
                            onClick={() =>
                              setModal({ type: "summary", uid: detail.uid })
                            }
                          >
                            <Sparkles size={17} />
                            {t("Zusammenfassen")}
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
                  <h2>{t("Keine Nachricht ausgewählt")}</h2>
                  <p>{t("Wähle eine Nachricht aus, um sie hier zu lesen.")}</p>
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
            aria-label={t("Aktionen für Ordner")}
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
              <MailOpen size={16} />
              {t(" Alle Nachrichten als gelesen markieren\n            ")}
            </button>
            {isTrashFolder(
              folders.find((item) => item.path === contextMenu.path),
            ) && (
              <>
                <div className="context-menu-separator" role="separator" />
                <button
                  role="menuitem"
                  className="context-menu-danger"
                  onClick={() => {
                    const path = contextMenu.path;
                    setContextMenu(null);
                    setModal({ type: "empty-trash", path });
                  }}
                >
                  <Trash2 size={16} />
                  {t(" Papierkorb leeren\n                ")}
                </button>
              </>
            )}
          </div>
        )}
      {contextMenu && contextMessage && (
        <div
          ref={contextMenuRef}
          className="message-context-menu"
          role="menu"
          aria-label={t("Aktionen für Nachricht")}
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
            onClick={() => composeFromMessage(contextMessage.uid, "reply-all")}
          >
            <Reply size={16} />
            {t("Allen antworten")}
          </button>
          <button
            role="menuitem"
            onClick={() => composeFromMessage(contextMessage.uid, "reply")}
          >
            <Reply size={16} />
            {t("Nur Absender antworten")}
          </button>
          <button
            role="menuitem"
            onClick={() => composeFromMessage(contextMessage.uid, "forward")}
          >
            <ArrowRight size={16} />
            {t(" Weiterleiten\n          ")}
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
              ? t("Als ungelesen markieren")
              : t("Als gelesen markieren")}
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
            {contextMessage.flagged
              ? t("Markierung entfernen")
              : t("Markieren")}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setContextMenu(null);
              archive(contextMessage.uid);
            }}
          >
            <Archive size={16} />
            {t(" Archivieren\n          ")}
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
            <Trash2 size={16} />
            {t(" Löschen\n          ")}
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
          onCrypto={(account) => setModal({ type: "crypto", account })}
          onAdd={() => setModal("account")}
          onOpenContacts={() => setModal("contacts")}
          onCollectRecipientsChange={async (enabled) => {
            await api("/settings/contacts", {
              method: "PATCH",
              body: { collectRecipients: enabled },
            });
            setAuth((current) => ({
              ...current,
              user: { ...current.user, collectRecipients: enabled },
            }));
          }}
          onLogout={logout}
          setTheme={setTheme}
          theme={theme}
          language={language}
          onLanguageChange={selectLanguage}
          threaded={threaded}
          onThreadedChange={selectThreaded}
          setError={setError}
          onDeleted={async (id) => {
            const data = await api("/accounts");
            setAccounts(data);
            if (accountId === id)
              setAccountId(
                data.find((account) => account.is_primary)?.id ??
                  data[0]?.id ??
                  null,
              );
          }}
          onPrimary={async (id) => {
            await api(`/accounts/${id}/primary`, { method: "PATCH" });
            setAccounts(await api("/accounts"));
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
      {modal?.type === "crypto" && (
        <CryptoSettingsModal
          account={modal.account}
          onClose={() => setModal("settings")}
          onChanged={async () => setAccounts(await api("/accounts"))}
          setError={setError}
        />
      )}
      {modal?.type === "empty-trash" && (
        <EmptyTrashModal
          path={modal.path}
          onClose={() => setModal(null)}
          onConfirm={() => emptyTrashFolder(modal.path)}
        />
      )}
      {modal?.type === "source" && (
        <SourceModal
          accountId={accountId}
          folder={folder}
          uid={modal.uid}
          onClose={() => setModal(null)}
          setError={setError}
        />
      )}
      {modal?.type === "trace" && (
        <MailTrace
          accountId={accountId}
          folder={folder}
          uid={modal.uid}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "summary" && (
        <AiSummaryModal
          accountId={accountId}
          folder={folder}
          uid={modal.uid}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "contacts" && (
        <AddressBookModal onClose={() => setModal(null)} setError={setError} />
      )}
      {(modal === "compose" ||
        modal?.type === "reply" ||
        modal?.type === "reply-all" ||
        modal?.type === "forward") && (
        <ComposeModal
          account={activeAccount}
          accounts={accounts}
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

function SourceModal({ accountId, folder, uid, onClose, setError }) {
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(true);
  const highlightedSource = useMemo(
    () => highlightMailSource(source),
    [source],
  );
  useEffect(() => {
    const controller = new AbortController();
    fetch(
      `/api/accounts/${accountId}/messages/${uid}/source?folder=${encodeURIComponent(folder)}`,
      {
        credentials: "same-origin",
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        if (!response.ok)
          throw new Error(t("Quelltext konnte nicht geladen werden."));
        return response.text();
      })
      .then(setSource)
      .catch((error) => {
        if (error.name !== "AbortError") setError(error.message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [accountId, folder, uid, setError]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal source-modal">
        <div className="modal-header">
          <div>
            <div className="eyebrow">MINIMAIL</div>
            <h2>{t("Nachrichtenquelltext")}</h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label={t("Schließen")}
          >
            <X size={20} />
          </button>
        </div>
        <pre className="source-content">
          {loading
            ? t("Lade Nachrichten …")
            : highlightedSource.map(({ text, type }, index) =>
                type === "plain" ? (
                  text
                ) : (
                  <span className={`source-${type}`} key={index}>
                    {text}
                  </span>
                ),
              )}
        </pre>
      </div>
    </div>
  );
}

function AiSummaryModal({ accountId, folder, uid, onClose }) {
  const [summary, setSummary] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function summarize() {
    setBusy(true);
    setError("");
    try {
      const result = await api(
        `/accounts/${accountId}/messages/${uid}/summary`,
        {
          method: "POST",
          body: { folder, language: getLanguage() },
        },
      );
      setSummary(result.text);
      setTruncated(result.truncated);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="modal ai-modal">
        <div className="modal-header">
          <div>
            <div className="eyebrow">MINIMAIL AI</div>
            <h2>{t("KI-Zusammenfassung")}</h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label={t("Schließen")}
          >
            <X size={20} />
          </button>
        </div>
        <div className="ai-modal-content">
          <p className="ai-disclosure">
            {t(
              "Beim Zusammenfassen wird der lesbare Nachrichtentext an deinen KI-Server gesendet. Anhänge werden nicht übertragen.",
            )}
          </p>
          {error && (
            <p className="ai-error" role="alert">
              {error}
            </p>
          )}
          {summary && (
            <div className="ai-result" aria-live="polite">
              {summary}
            </div>
          )}
          {truncated && (
            <p className="ai-disclosure">
              {t(
                "Die Nachricht war sehr lang; nur der Anfang wurde zusammengefasst.",
              )}
            </p>
          )}
        </div>
        <div className="modal-footer ai-modal-footer">
          <button type="button" onClick={onClose}>
            {t("Schließen")}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={busy}
            onClick={summarize}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Sparkles size={16} />
            )}
            {summary ? t("Erneut zusammenfassen") : t("Zusammenfassen")}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyTrashModal({ path, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  async function confirm() {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (!busy && event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (!busy && event.key === "Escape") onClose();
      }}
    >
      <div
        className="modal confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="empty-trash-title"
      >
        <div className="modal-header">
          <div>
            <div className="eyebrow">{t("PAPIERKORB")}</div>
            <h2 id="empty-trash-title">{t("Papierkorb leeren?")}</h2>
          </div>
        </div>
        <p className="confirm-copy">
          {t("\n          Alle Nachrichten in ")}
          <strong>{path}</strong>
          {t(
            " werden dauerhaft gelöscht.\n          Das lässt sich nicht rückgängig machen.\n        ",
          )}
        </p>
        <div className="modal-footer">
          <div>
            <button
              className="text-button"
              onClick={onClose}
              disabled={busy}
              autoFocus
            >
              {t("\n              Abbrechen\n            ")}
            </button>
            <button className="danger-button" onClick={confirm} disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Trash2 size={16} />
              )}
              {t("\n              Dauerhaft löschen\n            ")}
            </button>
          </div>
        </div>
      </div>
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
      <h1>{t("Noch kein Postfach verbunden")}</h1>
      <p>
        {t("Füge die IMAP- und SMTP-Zugangsdaten deines Mailservers hinzu.")}
      </p>
      <button className="primary-button" onClick={onAdd}>
        <Plus size={19} />
        {t(" Postfach hinzufügen\n      ")}
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
  sender_name: "",
  signature: "",
  vpn_profile: "",
  check_interval_minutes: 5,
};
function AccountModal({ account, onClose, onSaved, setError }) {
  const [form, setForm] = useState(
    account ? { ...account, password: "", smtp_password: "" } : blankAccount,
  );
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState(false);
  const [vpnProfiles, setVpnProfiles] = useState([]);
  useEffect(() => {
    let active = true;
    api("/vpn-profiles")
      .then((profiles) => {
        if (active) setVpnProfiles(profiles);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, []);
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
            <div className="eyebrow">{t("POSTFACH-EINSTELLUNGEN")}</div>
            <h2>
              {account ? t("Postfach bearbeiten") : t("Postfach verbinden")}
            </h2>
            <p>
              {t("Deine Zugangsdaten bleiben verschlüsselt auf deinem Server.")}
            </p>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <form onSubmit={save}>
          <div className="modal-scroll">
            <div className="form-grid">
              <label>
                {t("\n                Anzeigename\n                ")}
                <input
                  required
                  value={form.name}
                  onChange={(e) => field("name", e.target.value)}
                  placeholder={t("Mein Postfach")}
                />
              </label>
              <label>
                {t("\n                E-Mail-Adresse\n                ")}
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={(e) => field("email", e.target.value)}
                  placeholder={t("name@beispiel.de")}
                />
              </label>
            </div>
            <div className="form-section">
              <div className="form-section-title">
                <PenLine size={18} />
                {t("Absender und Signatur")}
              </div>
              <label>
                {t("Absendername")}
                <input
                  value={form.sender_name || ""}
                  onChange={(event) => field("sender_name", event.target.value)}
                  placeholder={form.name || t("Mein Postfach")}
                  maxLength={256}
                />
              </label>
              <label className="signature-field">
                {t("Automatische Signatur")}
                <textarea
                  value={form.signature || ""}
                  onChange={(event) => field("signature", event.target.value)}
                  placeholder={t("Keine Signatur")}
                  maxLength={10000}
                  rows={6}
                />
              </label>
              <p className="field-hint">
                {t(
                  "Die Signatur wird beim Schreiben automatisch an die Nachricht angehängt.",
                )}
              </p>
            </div>
            <div className="form-section">
              <div className="form-section-title">
                <Inbox size={18} />
                {t(" Eingangsserver ")}
                <span>{t("IMAP")}</span>
              </div>
              <div className="form-grid host-grid">
                <label>
                  {t("\n                  Server\n                  ")}
                  <input
                    required
                    value={form.imap_host}
                    onChange={(e) => field("imap_host", e.target.value)}
                    placeholder={t("imap.beispiel.de")}
                  />
                </label>
                <label>
                  {t("\n                  Port\n                  ")}
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
                {t("\n                Direktes TLS")}{" "}
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
                <Send size={18} />
                {t(" Ausgangsserver ")}
                <span>{t("SMTP")}</span>
              </div>
              <div className="form-grid host-grid">
                <label>
                  {t("\n                  Server\n                  ")}
                  <input
                    required
                    value={form.smtp_host}
                    onChange={(e) => field("smtp_host", e.target.value)}
                    placeholder={t("smtp.beispiel.de")}
                  />
                </label>
                <label>
                  {t("\n                  Port\n                  ")}
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
                {t("\n                Direktes TLS")}{" "}
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
                  {t("\n                  SMTP-Benutzername ")}
                  <small>{t("(optional)")}</small>
                  <input
                    value={form.smtp_username || ""}
                    onChange={(e) => field("smtp_username", e.target.value)}
                    placeholder={t("Wie bei IMAP")}
                  />
                </label>
                <label>
                  {t("\n                  SMTP-Passwort ")}
                  <small>{t("(optional)")}</small>
                  <input
                    type="password"
                    value={form.smtp_password || ""}
                    onChange={(e) => field("smtp_password", e.target.value)}
                    placeholder={
                      account ? t("Unverändert lassen") : t("Wie bei IMAP")
                    }
                  />
                </label>
              </div>
            </div>
            {(vpnProfiles.length > 0 || form.vpn_profile) && (
              <div className="form-section">
                <div className="form-section-title">
                  <ShieldCheck size={18} />
                  {t("VPN-Verbindung")}
                </div>
                <label className="interval-field">
                  {t("Verbindung für dieses Postfach")}
                  <select
                    value={form.vpn_profile || ""}
                    onChange={(event) =>
                      field("vpn_profile", event.target.value)
                    }
                  >
                    <option value="">{t("Direkt (ohne VPN)")}</option>
                    {vpnProfiles.map((profile) => (
                      <option value={profile.id} key={profile.id}>
                        {profile.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="field-hint">
                  {t(
                    "IMAP und SMTP dieses Postfachs verwenden die ausgewählte Server-VPN-Verbindung.",
                  )}
                </p>
              </div>
            )}
            <div className="form-section credentials">
              <div className="form-section-title">
                <LockKeyhole size={18} />
                {t(" Anmeldung\n              ")}
              </div>
              <div className="form-grid">
                <label>
                  {t("\n                  Benutzername\n                  ")}
                  <input
                    required
                    value={form.username}
                    onChange={(e) => field("username", e.target.value)}
                    placeholder={t("name@beispiel.de")}
                  />
                </label>
                <label>
                  {t(
                    "\n                  Passwort / App-Passwort\n                  ",
                  )}
                  <input
                    required={!account || account.needsCredentials}
                    type="password"
                    value={form.password}
                    onChange={(e) => field("password", e.target.value)}
                    placeholder={
                      account ? t("Unverändert lassen") : t("Postfach-Passwort")
                    }
                  />
                </label>
              </div>
              <p>
                {t(
                  "\n                Bei Providern mit 2FA benötigst du meistens ein App-Passwort für\n                IMAP/SMTP.\n              ",
                )}
              </p>
            </div>
            <div className="form-section">
              <div className="form-section-title">
                <RefreshCw size={18} />
                {t(" Automatischer Abruf\n              ")}
              </div>
              <label className="interval-field">
                {t(
                  "\n                Alle wie viele Minuten prüfen?\n                ",
                )}
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
                {t(
                  "\n                Standard: 5 Minuten. Mit 0 ist der automatische Abruf für dieses\n                Postfach aus.\n              ",
                )}
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
              {tested ? t("Verbindung erfolgreich") : t("Verbindung testen")}
            </button>
            <div>
              <button type="button" className="text-button" onClick={onClose}>
                {t("\n                Abbrechen\n              ")}
              </button>
              <button className="primary-button" disabled={busy}>
                {account ? t("Speichern") : t("Postfach hinzufügen")}
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
  onCrypto,
  onAdd,
  onOpenContacts,
  onCollectRecipientsChange,
  onLogout,
  setTheme,
  theme,
  language,
  onLanguageChange,
  threaded,
  onThreadedChange,
  setError,
  onDeleted,
  onPrimary,
}) {
  const [primaryBusy, setPrimaryBusy] = useState(false);
  const [collectBusy, setCollectBusy] = useState(false);
  async function toggleCollection() {
    if (collectBusy) return;
    setCollectBusy(true);
    try {
      await onCollectRecipientsChange(!auth.user.collectRecipients);
    } catch (err) {
      setError(err.message);
    } finally {
      setCollectBusy(false);
    }
  }
  async function makePrimary(id) {
    if (primaryBusy) return;
    setPrimaryBusy(true);
    try {
      await onPrimary(id);
    } catch (err) {
      setError(err.message);
    } finally {
      setPrimaryBusy(false);
    }
  }
  async function remove(account) {
    if (
      !window.confirm(
        choose(
          `Postfach „${account.name}“ aus MiniMail entfernen? E-Mails auf dem Server bleiben erhalten.`,
          `Remove mailbox “${account.name}” from MiniMail? Messages on the mail server will remain.`,
        ),
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
            <div className="eyebrow">{t("MINIMAIL")}</div>
            <h2>{t("Einstellungen")}</h2>
            <p>{t("Postfächer, Benutzer und Darstellung verwalten.")}</p>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="settings-body">
          <h3>{t("Verbundene Postfächer")}</h3>
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
                    ? t("Automatischer Abruf aus")
                    : choose(
                        `Alle ${account.check_interval_minutes} Minuten`,
                        `Every ${account.check_interval_minutes} minutes`,
                      ) +
                      ` · ${
                        account.check_failed
                          ? t("Prüfung fehlgeschlagen")
                          : account.last_checked_at
                            ? choose("zuletzt", "last checked") +
                              ` ${new Date(account.last_checked_at).toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit" })}`
                            : t("noch nicht geprüft")
                      }`}
                </span>
              </div>
              <button
                className={`primary-account-button ${account.is_primary ? "is-primary" : ""}`}
                title={
                  account.is_primary
                    ? t("Primärpostfach")
                    : t("Als Primärpostfach festlegen")
                }
                onClick={() => makePrimary(account.id)}
                disabled={account.is_primary || primaryBusy}
              >
                <Star
                  size={14}
                  fill={account.is_primary ? "currentColor" : "none"}
                />
                {account.is_primary ? t("Primär") : t("Als primär")}
              </button>
              <button onClick={() => onEdit(account)}>{t("Bearbeiten")}</button>
              <button
                onClick={() => onCrypto(account)}
                title={t("Verschlüsselung und Schlüssel")}
              >
                <LockKeyhole size={14} /> {t("Schlüssel")}
              </button>
              <button
                className="danger-icon"
                title={t("Entfernen")}
                onClick={() => remove(account)}
              >
                <Trash2 size={17} />
              </button>
            </div>
          ))}
          <button className="settings-add" onClick={onAdd}>
            <Plus size={17} />
            {t(" Weiteres Postfach verbinden\n          ")}
          </button>
          <h3>{t("Adressbuch")}</h3>
          <div className="settings-row">
            <div>
              <strong>{t("Kontakte verwalten")}</strong>
              <span>{t("Adressen suchen, hinzufügen und bearbeiten.")}</span>
            </div>
            <button type="button" onClick={onOpenContacts}>
              <Contact size={16} /> {t("Öffnen")}
            </button>
          </div>
          <div className="settings-row">
            <div>
              <strong>{t("Gesendete Empfänger automatisch merken")}</strong>
              <span>
                {t(
                  "Neue Adressen nach erfolgreichem Senden im Adressbuch speichern.",
                )}
              </span>
            </div>
            <button
              type="button"
              aria-pressed={!!auth.user.collectRecipients}
              disabled={collectBusy}
              onClick={toggleCollection}
            >
              {auth.user.collectRecipients ? t("Ein") : t("Aus")}
            </button>
          </div>
          <AiSettings
            request={api}
            isAdmin={auth.user.role === "admin"}
            setError={setError}
          />
          {auth.user.role === "admin" && (
            <UserManagement
              request={api}
              currentUsername={auth.user.username}
              setError={setError}
            />
          )}
          <h3>{t("Darstellung")}</h3>
          <div className="settings-row">
            <div>
              <strong>{t("Farbschema")}</strong>
              <span>{t("Wähle deinen bevorzugten Modus.")}</span>
            </div>
            <button
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              {theme === "light" ? <Sun size={17} /> : <Moon size={17} />}{" "}
              {theme === "light" ? t("Hell") : t("Dunkel")}
            </button>
          </div>
          <div className="settings-row">
            <div>
              <strong>{t("Sprache")}</strong>
              <span>{t("Wähle die Sprache der Oberfläche.")}</span>
            </div>
            <select
              className="language-select"
              aria-label={t("Sprache")}
              value={language}
              onChange={(event) => onLanguageChange(event.target.value)}
            >
              <option value="de">Deutsch</option>
              <option value="en">English</option>
            </select>
          </div>
          <div className="settings-row">
            <div>
              <strong>{t("Konversationsansicht")}</strong>
              <span>
                {t("Zusammengehörige E-Mails als aufklappbare Kette anzeigen.")}
              </span>
            </div>
            <button
              type="button"
              aria-pressed={threaded}
              onClick={() => onThreadedChange(!threaded)}
            >
              {threaded ? t("Ein") : t("Aus")}
            </button>
          </div>
          <h3>{t("Sicherheit")}</h3>
          <div className="settings-row">
            <div>
              <strong>{t("Zwei-Faktor-Anmeldung")}</strong>
              <span>
                {choose(
                  `Für ${auth.user.username} aktiviert`,
                  `Enabled for ${auth.user.username}`,
                )}
              </span>
            </div>
            <ShieldCheck size={20} className="secure-green" />
          </div>
          <button className="logout-button" onClick={onLogout}>
            {t("\n            Abmelden\n          ")}
          </button>
        </div>
      </div>
    </div>
  );
}

function CryptoSettingsModal({ account, onClose, onChanged, setError }) {
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
      <div className="modal crypto-modal">
        <div className="modal-header">
          <div>
            <div className="eyebrow">{account.email}</div>
            <h2>{t("Verschlüsselung und Schlüssel")}</h2>
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

function ContactCryptoModal({ contact, onClose, onChanged, setError }) {
  const [pgp, setPgp] = useState("");
  const [certificate, setCertificate] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [busy, setBusy] = useState(false);
  async function perform(kind, method, body) {
    setBusy(true);
    try {
      const result = await api(`/contacts/${contact.id}/crypto/${kind}`, {
        method,
        ...(body ? { body } : {}),
      });
      setFingerprint(result.fingerprint || "");
      await onChanged();
      if (kind === "pgp") setPgp("");
      else setCertificate("");
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
                ? t("Öffentlicher Schlüssel vorhanden")
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
                ? t("Zertifikat vorhanden")
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

function AddressBookModal({ onClose, setError }) {
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

function splitEditableDraft(value) {
  const marker =
    /\n\n(?:Am [^\n]+ schrieb [^\n]*:|On [^\n]+ wrote:|---------- (?:Weitergeleitete Nachricht|Forwarded message) ----------)/.exec(
      value,
    );
  return marker
    ? {
        editable: value.slice(0, marker.index),
        quoted: value.slice(marker.index),
      }
    : { editable: value, quoted: "" };
}

function AiRewriteModal({
  body,
  senderAccountId,
  to,
  cc,
  subject,
  recipientNameHints,
  onApply,
  onClose,
}) {
  const { editable, quoted } = splitEditableDraft(body);
  const [instructions, setInstructions] = useState("");
  const [proposal, setProposal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function generate() {
    setBusy(true);
    setError("");
    setProposal("");
    try {
      const result = await api("/ai/rewrite", {
        method: "POST",
        body: {
          text: editable,
          instructions,
          language: getLanguage(),
          senderAccountId,
          to,
          cc,
          subject,
          recipientNameHints,
        },
      });
      setProposal(result.text);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="modal-backdrop ai-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className="modal ai-modal ai-rewrite-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-rewrite-title"
      >
        <div className="modal-header">
          <div>
            <div className="eyebrow">MINIMAIL AI</div>
            <h2 id="ai-rewrite-title">{t("Text mit KI überarbeiten")}</h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label={t("Schließen")}
          >
            <X size={20} />
          </button>
        </div>
        <div className="ai-modal-content">
          <p className="ai-disclosure">
            {t(
              "Beim Erstellen werden Entwurf, Anweisungen, Betreff sowie Absender und Empfänger mit verfügbaren Namen an deinen KI-Server gesendet. Das Bcc-Feld, die gespeicherte Signatur und automatisch angehängte Zitate werden nicht übertragen. Die KI ergänzt Anrede, Absätze und Grußformel; deine Signatur wird später separat angehängt.",
            )}
          </p>
          {editable.trim() && (
            <details className="ai-original">
              <summary>{t("Ausgangstext anzeigen")}</summary>
              <pre>{editable}</pre>
            </details>
          )}
          <label>
            {t("Zusätzliche Anweisungen oder Stichpunkte")}
            <textarea
              value={instructions}
              onChange={(event) => {
                setInstructions(event.target.value);
                setProposal("");
              }}
              maxLength={3000}
              placeholder={t(
                "Zum Beispiel: freundlich antworten, Termin am Freitag vorschlagen …",
              )}
            />
          </label>
          {!editable.trim() && (
            <p className="ai-disclosure">
              {t(
                "Du kannst den Mailtext leer lassen und die Nachricht nur aus Stichpunkten erstellen lassen.",
              )}
            </p>
          )}
          {quoted && (
            <p className="ai-disclosure">
              {t(
                "Der zitierte Mailverlauf wird beim Übernehmen wieder angehängt.",
              )}
            </p>
          )}
          {error && (
            <p className="ai-error" role="alert">
              {error}
            </p>
          )}
          {proposal && (
            <label>
              {t("Vorschlag – vor dem Übernehmen bearbeitbar")}
              <textarea
                className="ai-proposal"
                value={proposal}
                onChange={(event) => setProposal(event.target.value)}
              />
            </label>
          )}
        </div>
        <div className="modal-footer ai-modal-footer">
          <button type="button" onClick={onClose}>
            {t("Abbrechen")}
          </button>
          <button
            type="button"
            disabled={busy || (!editable.trim() && !instructions.trim())}
            onClick={generate}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Sparkles size={16} />
            )}
            {proposal ? t("Neu erstellen") : t("Vorschlag erstellen")}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!proposal.trim() || busy}
            onClick={() => onApply(proposal.trim() + quoted)}
          >
            {t("Übernehmen")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ComposeModal({
  account,
  accounts,
  initial,
  onClose,
  onSent,
  setError,
}) {
  const replyAll = initial?.type === "reply-all",
    reply = initial?.type === "reply" || replyAll,
    forward = initial?.type === "forward",
    original = initial?.message;
  const initialRecipients = reply
    ? replyRecipients(
        original,
        accounts.map((item) => item.email),
        replyAll,
      )
    : { to: "", cc: "" };
  const [to, setTo] = useState(initialRecipients.to);
  const [cc, setCc] = useState(initialRecipients.cc);
  const [bcc, setBcc] = useState("");
  const [contacts, setContacts] = useState([]);
  useEffect(() => {
    api("/contacts")
      .then(setContacts)
      .catch((error) => setError(error.message));
  }, [setError]);
  const [subject, setSubject] = useState(
    original
      ? `${reply ? "Re" : "Fwd"}: ${original.subject.replace(/^(Re|Fwd):\s*/i, "")}`
      : "",
  );
  const [body, setBody] = useState(
    forward
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
        : "",
  );
  const [aiOpen, setAiOpen] = useState(false);
  const [aiHistory, setAiHistory] = useState([]);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [showCc, setShowCc] = useState(Boolean(initialRecipients.cc));
  const [showBcc, setShowBcc] = useState(false);
  const [senderAccountId, setSenderAccountId] = useState(
    account && !account.needsCredentials
      ? account.id
      : accounts.find((item) => !item.needsCredentials)?.id ||
          account?.id ||
          null,
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
  const [cryptoOptions, setCryptoOptions] = useState(() =>
    cryptoForSender(senderAccount),
  );
  useEffect(() => {
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
  async function submit(event) {
    event.preventDefault();
    if (!senderAccount || senderAccount.needsCredentials) {
      setError(t("Bitte zuerst ein Postfach verbinden."));
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
      await api(`/accounts/${senderAccount.id}/send`, {
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
          ...(reply && original?.messageId
            ? {
                inReplyTo: original.messageId,
                references: [
                  ...(original.references || []),
                  original.messageId,
                ].slice(-30),
              }
            : {}),
        },
      });
      onSent();
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
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div className="modal compose-modal">
          <div className="compose-header">
            <div>
              <div className="eyebrow">
                {t("\n              VON ")}
                {senderAccount?.email || t("KEIN POSTFACH")}
              </div>
              <h2>
                {reply
                  ? replyAll
                    ? t("Allen antworten")
                    : t("Antworten")
                  : forward
                    ? t("Weiterleiten")
                    : t("Neue Nachricht")}
              </h2>
            </div>
            <button className="icon-button" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
          <form onSubmit={submit}>
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
                  {accounts.map((item) => (
                    <option
                      key={item.id}
                      value={item.id}
                      disabled={item.needsCredentials}
                    >
                      {item.email}
                      {item.needsCredentials ? ` (${t("Passwort fehlt")})` : ""}
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
                <option value="none">{t("Ohne Ende-zu-Ende-Schutz")}</option>
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
                      setFiles(next.slice(0, 8));
                    }}
                  />
                </label>
              </div>
              <span>
                {t("Gesendet über ")}
                {senderAccount?.name || "MiniMail"}
              </span>
            </div>
          </form>
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

createRoot(document.getElementById("root")).render(<App />);
