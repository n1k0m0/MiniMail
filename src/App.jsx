import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useLayoutEffect,
} from "react";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Contact,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  FileCode2,
  FolderPlus,
  ListFilter,
  Inbox,
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
  ShieldAlert,
  Sparkles,
  Star,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import {
  PAGE_SIZE,
  api,
  fmtAddress,
  fullAddress,
  dateLabel,
} from "./mailUi.js";
import { t, choose, dateLocale, getLanguage } from "./i18n.js";
import { findSpamFolder } from "./spamFolder.js";
import { buildFolderTree, visibleFolderNodes } from "./folderTree.js";
import AccountModal from "./AccountModal.jsx";
import AddressBookModal from "./AddressBookModal.jsx";
import AiSummaryModal from "./AiSummaryModal.jsx";
import ComposeModal from "./ComposeModal.jsx";
import CryptoSettingsModal from "./CryptoSettingsModal.jsx";
import EmptyAccount from "./EmptyAccount.jsx";
import EmptyTrashModal from "./EmptyTrashModal.jsx";
import FolderActionModal from "./FolderActionModal.jsx";
import PaginationControls from "./PaginationControls.jsx";
import ResizeHandle from "./ResizeHandle.jsx";
import SettingsModal from "./SettingsModal.jsx";
import SourceModal from "./SourceModal.jsx";
import DraftsModal from "./DraftsModal.jsx";
import LoginScreen from "./LoginScreen.jsx";
import CalendarReminders from "./calendar/CalendarReminders.jsx";
import MailInvitation from "./calendar/MailInvitation.jsx";
import {
  notificationKey,
  notificationPreferences,
  mailArrivals,
  notifyOnce,
  showNotification,
} from "./notifications.js";
import { setLanguage as updateLanguage } from "./i18n.js";
import "./style.css";
import "./settings.css";
import "./calendar/calendar.css";
const CalendarView = React.lazy(() => import("./calendar/CalendarView.jsx"));
const MailTrace = React.lazy(() => import("./MailTrace.jsx"));

const SIDEBAR_WIDTH_KEY = "minimail-sidebar-width";
const MESSAGE_WIDTH_KEY = "minimail-message-width";
const SIDEBAR_WIDE_WIDTH_KEY = "minimail-sidebar-wide-width";
const MESSAGE_WIDE_WIDTH_KEY = "minimail-message-wide-width";
const READER_ZOOM_KEY = "minimail-reader-zoom";
const READER_WIDE_ZOOM_KEY = "minimail-reader-wide-zoom";
const THREAD_VIEW_KEY = "minimail-thread-view";
const hideReadKey = (username) =>
  `minimail-hide-read:${encodeURIComponent(username)}`;

function storedWidth(key) {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) && value > 0 ? value : null;
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
    return security.kind === "pgp"
      ? choose(
          "OpenPGP: Signatur passt zum automatisch gefundenen Schlüssel; Fingerabdruck noch nicht bestätigt.",
          "OpenPGP: Signature matches an automatically discovered key; fingerprint not yet confirmed.",
        )
      : choose(
          "S/MIME: Signatur gültig, Zertifikatskette nicht als vertrauenswürdig bestätigt.",
          "S/MIME: Signature valid; certificate chain not trusted.",
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

export default function App() {
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
  const [hideRead, setHideRead] = useState(false);
  const [notifications, setNotifications] = useState({
    mail: false,
    calendar: false,
  });
  const notificationsRef = useRef(notifications);
  notificationsRef.current = notifications;
  const mailNotificationBaseline = useRef(new Map());
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
  const [movingToSpam, setMovingToSpam] = useState(false);
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState(null);
  const [settingsSection, setSettingsSection] = useState("mailboxes");
  const [appView, setAppView] = useState("mail");
  const [calendarEventId, setCalendarEventId] = useState(null);
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
  const selectedMessageIndex = messages.findIndex(
    (item) => item.uid === (selectedThread?.uid || selected),
  );
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
      setNotifications(
        identity
          ? notificationPreferences(identity)
          : { mail: false, calendar: false },
      );
      mailNotificationBaseline.current = new Map();
      setHideRead(
        identity ? localStorage.getItem(hideReadKey(identity)) === "1" : false,
      );
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
      setSettingsSection("mailboxes");
      setAppView("mail");
      setCalendarEventId(null);
      setContextMenu(null);
      draggedMessageRef.current = null;
      setDraggingUid(null);
      setDropFolder(null);
      setMobileSidebar(false);
      setRefreshKey(0);
      setError("");
      setNotice("");
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
  function selectHideRead(next) {
    setHideRead(next);
    if (authIdentityRef.current)
      localStorage.setItem(
        hideReadKey(authIdentityRef.current),
        next ? "1" : "0",
      );
    setPage(0);
    setSelected(null);
    setExpandedThreads(new Set());
  }
  function selectNotifications(next) {
    try {
      localStorage.setItem(
        notificationKey(authIdentityRef.current),
        JSON.stringify(next),
      );
      setNotifications(next);
    } catch {
      setError(
        t("Die Einstellung konnte in diesem Browser nicht gespeichert werden."),
      );
    }
  }
  useEffect(() => {
    const sync = (event) => {
      if (
        authIdentityRef.current &&
        event.key === notificationKey(authIdentityRef.current)
      )
        setNotifications(notificationPreferences(authIdentityRef.current));
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  function observeMail(data, identity) {
    const { next, arrivals } = mailArrivals(
      mailNotificationBaseline.current,
      data,
    );
    mailNotificationBaseline.current = next;
    if (!notificationsRef.current.mail) return;
    for (const account of arrivals) {
      void notifyOnce(
        identity,
        "mail",
        `${account.id}:${account.inbox_uid_next}`,
        () => {
          if (
            authIdentityRef.current !== identity ||
            !notificationsRef.current.mail
          )
            return false;
          return showNotification(
            "MiniMail",
            {
              body: `${t("Neue E-Mails")}: ${account.name || account.email}`,
              tag: `minimail-mail-${account.id}`,
            },
            () => {
              if (authIdentityRef.current !== identity) return;
              setAppView("mail");
              setAccountId(account.id);
              selectFolder("INBOX");
            },
          );
        },
      );
    }
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
  useEffect(
    () => setContextMenu(null),
    [accountId, folder, page, search, hideRead],
  );
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
        observeMail(data, identity);
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
      if (polling || (document.hidden && !notificationsRef.current.mail))
        return;
      polling = true;
      try {
        const data = await api("/accounts");
        if (cancelled || authIdentityRef.current !== identity) return;
        observeMail(data, identity);
        if (JSON.stringify(data) === JSON.stringify(accountsRef.current))
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
        const inbox = data.find((item) => item.path.toUpperCase() === "INBOX");
        if (inbox)
          setAccounts((current) =>
            current.map((item) =>
              item.id === accountId
                ? { ...item, inbox_unseen: inbox.unseen }
                : item,
            ),
          );
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
      `/accounts/${accountId}/messages?folder=${encodeURIComponent(folder)}&q=${encodeURIComponent(search)}&page=${page}&threaded=${threaded ? "1" : "0"}&unread=${hideRead ? "1" : "0"}`,
    )
      .then((data) => {
        if (active) {
          setTotal(data.total);
          const lastPage = Math.max(0, Math.ceil(data.total / PAGE_SIZE) - 1);
          if (page > lastPage) {
            setPage(lastPage);
            return;
          }
          setMessages(data.messages);
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
    hideRead,
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
  async function moveToSpam(uid = selected) {
    if (!uid || movingToSpam) return;
    setMovingToSpam(true);
    try {
      // Resolve against this account's current folders, even immediately after
      // switching accounts or when folders have changed on the mail server.
      const target = findSpamFolder(
        await api(`/accounts/${accountId}/folders`),
      );
      if (!target) {
        setError(t("Kein Spam-Ordner auf diesem Postfach gefunden."));
        return;
      }
      await move(uid, target.path);
    } catch (error) {
      setError(error.message);
    } finally {
      setMovingToSpam(false);
    }
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
      className={`app-shell${wideDesktop ? " wide-layout" : ""}${appView === "calendar" ? " calendar-open" : ""}`}
      style={{
        "--sidebar-width": `${sidebarWidth}px`,
        "--message-width": `${messageWidth}px`,
        "--reader-zoom": String(readerZoom / 100),
        "--reader-zoom-width": `${10000 / readerZoom}%`,
      }}
    >
      <div className="icon-rail">
        <div
          className="brand-mark"
          role="img"
          aria-label="MiniMail"
          title="MiniMail"
        >
          <span aria-hidden="true">Mini</span>
          <span className="brand-mark-mail" aria-hidden="true">
            Mail<span className="brand-mark-dot">.</span>
          </span>
        </div>
        <button
          className={`rail-icon${appView === "mail" ? " active" : ""}`}
          title={t("E-Mail")}
          aria-label={t("E-Mail")}
          onClick={() => setAppView("mail")}
        >
          <Mail size={21} />
        </button>
        <button
          className={`rail-icon${appView === "calendar" ? " active" : ""}`}
          title={t("Kalender")}
          aria-label={t("Kalender")}
          onClick={() => setAppView("calendar")}
        >
          <CalendarDays size={21} />
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
        <button
          type="button"
          className="rail-icon rail-logout"
          title={`${auth.user.username}: ${t("Abmelden")}`}
          aria-label={loggingOut ? t("Abmelden …") : t("Abmelden")}
          onClick={logout}
          disabled={loggingOut}
        >
          {loggingOut ? (
            <LoaderCircle className="spin" size={21} />
          ) : (
            <LogOut size={21} />
          )}
        </button>
      </div>
      {appView === "calendar" ? (
        <React.Suspense
          fallback={
            <div className="boot">
              <LoaderCircle className="spin" size={28} />
            </div>
          }
        >
          <CalendarView
            key={auth.user.username}
            username={auth.user.username}
            accounts={accounts}
            onMail={() => setAppView("mail")}
            onSettings={() => setModal("settings")}
            onNotificationSettings={() => {
              setSettingsSection("notifications");
              setModal("settings");
            }}
            setError={setError}
            notify={setNotice}
            openEventId={calendarEventId}
            onEventOpened={() => setCalendarEventId(null)}
          />
        </React.Suspense>
      ) : (
        <>
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
            <button
              className="compose-button"
              onClick={() => setModal("compose")}
            >
              <PenLine size={18} />
              <span>{t("Neue Nachricht")}</span>
              <Plus size={17} className="compose-plus" />
            </button>
            <button
              className="drafts-button"
              onClick={() => setModal("drafts")}
            >
              <FileText size={16} /> {t("Gespeicherte Entwürfe")}
            </button>
            <div className="sidebar-content">
              <div className="section-label">{t("POSTFÄCHER")}</div>
              {accounts.length ? (
                <div className="account-list">
                  {accounts.map((account) => (
                    <button
                      key={account.id}
                      className={`account-choice ${account.inbox_unseen > 0 ? "unread" : "read"} ${account.id === accountId ? "selected" : ""}`}
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
                      {account.inbox_unseen > 0 &&
                        !account.needsCredentials && (
                          <b
                            className="account-unseen"
                            title={choose(
                              `${account.inbox_unseen} ungelesene Nachrichten im Posteingang`,
                              `${account.inbox_unseen} unread messages in the inbox`,
                            )}
                          >
                            {account.inbox_unseen > 99
                              ? "99+"
                              : account.inbox_unseen}
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
                    <button
                      onClick={() =>
                        setModal({ type: "create-folder", path: "", accountId })
                      }
                      title={t("Neuer Ordner")}
                      aria-label={t("Neuer Ordner")}
                    >
                      <FolderPlus size={14} />
                    </button>
                    <button onClick={refresh} title={t("Ordner aktualisieren")}>
                      <RefreshCw size={14} />
                    </button>
                  </div>
                  {folders.length > 8 && (
                    <div className="folder-search">
                      <Search size={15} />
                      <input
                        value={folderFilter}
                        onChange={(event) =>
                          setFolderFilter(event.target.value)
                        }
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
                  <nav
                    className="folder-list"
                    onContextMenu={(event) => {
                      if (event.target === event.currentTarget)
                        openFolderContextMenu(event, "");
                    }}
                  >
                    {visibleFolders.map(({ node, depth }) => {
                      const item = node.folder;
                      const meta = folderMeta(item || node),
                        Icon = meta.icon;
                      return (
                        <div
                          key={node.path}
                          className={`folder-row ${node.hasUnread ? "unread" : "read"} ${folder === node.path ? "current" : ""} ${dropFolder === node.path ? "drop-target" : ""}`}
                          style={{
                            paddingLeft: `${8 + Math.min(depth, 6) * 14}px`,
                          }}
                          onContextMenu={(event) => {
                            event.stopPropagation();
                            openFolderContextMenu(event, node.path);
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
                            if (dropFolder !== node.path)
                              setDropFolder(node.path);
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
                                  collapsedFolders.has(node.path) &&
                                  !folderFilter
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
                className="sidebar-settings mobile-calendar-link"
                onClick={() => {
                  setAppView("calendar");
                  setMobileSidebar(false);
                }}
              >
                <CalendarDays size={17} />
                {t("Kalender")}
              </button>
              <button
                className="sidebar-settings"
                onClick={() => setModal("settings")}
              >
                <Settings size={17} />
                {t(" Einstellungen\n          ")}
              </button>
              <button
                className="sidebar-settings sidebar-logout mobile-logout"
                onClick={logout}
                disabled={loggingOut}
              >
                <LogOut size={17} />{" "}
                {loggingOut ? t("Abmelden …") : t("Abmelden")}
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
                  onClick={() =>
                    setModal({ type: "edit", account: activeAccount })
                  }
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
                    <div className="list-view-controls">
                      <button
                        type="button"
                        className="thread-mode-button"
                        aria-pressed={threaded}
                        title={t("Konversationsansicht umschalten")}
                        onClick={() => selectThreaded(!threaded)}
                      >
                        {threaded
                          ? t("Konversationen")
                          : hideRead
                            ? t("Nachrichten")
                            : t("Alle Nachrichten")}
                        <ChevronDown size={13} />
                      </button>
                      <button
                        type="button"
                        className="read-filter-button"
                        aria-pressed={hideRead}
                        aria-label={t("Gelesene E-Mails ausblenden")}
                        title={t("Gelesene E-Mails ausblenden")}
                        onClick={() => selectHideRead(!hideRead)}
                      >
                        <Mail size={14} />
                        <span>{t("Nur ungelesene")}</span>
                      </button>
                    </div>
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
                                    if (next.has(item.uid))
                                      next.delete(item.uid);
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
                                  <div
                                    className="thread-line"
                                    aria-hidden="true"
                                  />
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
                                      flag(
                                        member.uid,
                                        "flagged",
                                        !member.flagged,
                                      );
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
                          {hideRead
                            ? t("Keine ungelesenen Nachrichten")
                            : search
                              ? t("Keine Treffer gefunden")
                              : t("Hier ist alles erledigt")}
                        </h3>
                        <p>
                          {hideRead
                            ? t("Gelesene E-Mails sind ausgeblendet.")
                            : search
                              ? t("Versuche einen anderen Suchbegriff.")
                              : t(
                                  "In diesem Ordner liegen noch keine Nachrichten.",
                                )}
                        </p>
                        {hideRead && (
                          <button
                            className="show-read-button"
                            onClick={() => selectHideRead(false)}
                          >
                            {t("Alle Nachrichten anzeigen")}
                          </button>
                        )}
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
                        wideDesktop
                          ? MESSAGE_WIDE_WIDTH_KEY
                          : MESSAGE_WIDTH_KEY,
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
                              title={t("In Spam verschieben")}
                              aria-label={t("In Spam verschieben")}
                              disabled={movingToSpam}
                              onClick={() => moveToSpam()}
                            >
                              <ShieldAlert size={19} />
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
                          {selectedMessageIndex >= 0 && (
                            <span className="reader-position">
                              {page * PAGE_SIZE + selectedMessageIndex + 1}{" "}
                              {t("von")} {total}
                            </span>
                          )}
                        </div>
                        <div className="reader-scroll">
                          <div className="reader-content">
                            {selectedThread?.thread?.length > 1 && (
                              <div
                                className="reader-thread"
                                aria-label={t(
                                  "Nachrichten in der Konversation",
                                )}
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
                            <div className="message-kicker">
                              {t("NACHRICHT")}
                            </div>
                            <MailInvitation
                              key={`${accountId}:${folder}:${detail.uid}`}
                              message={detail}
                              accountId={accountId}
                              folder={folder}
                              onOpen={(id) => {
                                setCalendarEventId(id);
                                setAppView("calendar");
                              }}
                              setError={setError}
                            />
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
                                  dangerouslySetInnerHTML={{
                                    __html: detail.html,
                                  }}
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
                                  setModal({
                                    type: "reply-all",
                                    message: detail,
                                  })
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
                      <p>
                        {t("Wähle eine Nachricht aus, um sie hier zu lesen.")}
                      </p>
                    </div>
                  )}
                </section>
              </div>
            )}
          </main>
        </>
      )}
      <CalendarReminders
        username={auth.user.username}
        desktopEnabled={notifications.calendar}
        onOpen={(id) => {
          setCalendarEventId(id);
          setAppView("calendar");
        }}
        setError={setError}
      />
      {contextMenu?.type === "folder" && accountId && (
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
              setModal({ type: "create-folder", path, accountId });
            }}
          >
            <FolderPlus size={16} />
            {t("Neuer Unterordner")}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setContextMenu(null);
              setSettingsSection("filters");
              setModal("settings");
            }}
          >
            <ListFilter size={16} />
            {t("Mailfilter verwalten")}
          </button>
          {folders.some((item) => item.path === contextMenu.path) && (
            <>
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
              {folderMeta(
                folders.find((item) => item.path === contextMenu.path),
              ).icon === Mail &&
                !folders.find((item) => item.path === contextMenu.path)
                  ?.specialUse && (
                  <button
                    role="menuitem"
                    className="context-menu-danger"
                    onClick={() => {
                      const path = contextMenu.path;
                      setContextMenu(null);
                      setModal({ type: "delete-folder", path, accountId });
                    }}
                  >
                    <Trash2 size={16} />
                    {t("Ordner löschen …")}
                  </button>
                )}
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
          <button
            role="menuitem"
            disabled={movingToSpam}
            onClick={() => {
              setContextMenu(null);
              moveToSpam(contextMessage.uid);
            }}
          >
            <ShieldAlert size={16} />
            {t("In Spam verschieben")}
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
      {notice && (
        <div className="toast send-notice" role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice("")} aria-label={t("Schließen")}>
            <X size={16} />
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
      {(modal === "account" || modal?.type === "settings-add-account") && (
        <AccountModal
          onClose={() =>
            setModal(modal?.type === "settings-add-account" ? "settings" : null)
          }
          onSaved={async (newAccount) => {
            const data = await api("/accounts");
            setAccounts(data);
            setAccountId(newAccount.id);
            setModal(
              modal?.type === "settings-add-account" ? "settings" : null,
            );
          }}
          setError={setError}
        />
      )}
      {modal === "settings" && (
        <SettingsModal
          page={settingsSection}
          onPageChange={setSettingsSection}
          accounts={accounts}
          accountId={accountId}
          auth={auth}
          onClose={() => setModal(null)}
          onEdit={(account) => setModal({ type: "edit", account })}
          onCrypto={(account) => setModal({ type: "crypto", account })}
          onAdd={() => setModal({ type: "settings-add-account" })}
          onOpenContacts={() => setModal({ type: "settings-contacts" })}
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
          hideRead={hideRead}
          onHideReadChange={selectHideRead}
          notifications={notifications}
          onNotificationsChange={selectNotifications}
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
      {["create-folder", "delete-folder"].includes(modal?.type) && (
        <FolderActionModal
          key={`${modal.accountId}:${modal.path}:${modal.type}`}
          accountId={modal.accountId}
          path={modal.path}
          deleting={modal.type === "delete-folder"}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            if (accountId === modal.accountId) {
              if (modal.type === "delete-folder") {
                setSelected(null);
                setDetail(null);
                setFolder("INBOX");
              }
              refresh();
            }
          }}
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
        <React.Suspense
          fallback={
            <div className="modal-backdrop">
              <LoaderCircle className="spin" size={28} />
            </div>
          }
        >
          <MailTrace
            accountId={accountId}
            folder={folder}
            uid={modal.uid}
            onClose={() => setModal(null)}
          />
        </React.Suspense>
      )}
      {modal?.type === "summary" && (
        <AiSummaryModal
          accountId={accountId}
          folder={folder}
          uid={modal.uid}
          onClose={() => setModal(null)}
        />
      )}
      {(modal === "contacts" || modal?.type === "settings-contacts") && (
        <AddressBookModal
          onClose={() =>
            setModal(modal?.type === "settings-contacts" ? "settings" : null)
          }
          setError={setError}
        />
      )}
      {modal === "drafts" && (
        <DraftsModal
          onClose={() => setModal(null)}
          setError={setError}
          onOpen={(draft) => setModal({ type: "draft", draft })}
        />
      )}
      {(modal === "compose" ||
        modal?.type === "draft" ||
        modal?.type === "reply" ||
        modal?.type === "reply-all" ||
        modal?.type === "forward") && (
        <ComposeModal
          account={activeAccount}
          accounts={accounts}
          initial={modal}
          draft={modal?.draft}
          onClose={() => setModal(null)}
          onSent={(result) => {
            setModal(null);
            setError("");
            setNotice(
              [
                result.sentCopy?.saved === false
                  ? t(
                      "Nachricht gesendet. MiniMail konnte keine Kopie im Gesendet-Ordner speichern. Bitte nicht erneut senden; prüfe den Ordner auf dem Mailserver.",
                    )
                  : t("Nachricht gesendet."),
                result.draftRemovalFailed
                  ? t(
                      "Der gespeicherte Entwurf konnte nicht entfernt werden. Bitte lösche ihn unter Gespeicherte Entwürfe.",
                    )
                  : "",
              ]
                .filter(Boolean)
                .join(" "),
            );
            refresh();
          }}
          setError={setError}
        />
      )}
    </div>
  );
}
