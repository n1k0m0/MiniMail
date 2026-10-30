const pages = [
  {
    id: "mailboxes",
    title: "Postfächer",
    description:
      "Verbindungen, Absender und Schlüssel deiner Postfächer verwalten.",
    scope: "Nur für dich",
    group: "personal",
  },
  {
    id: "filters",
    title: "Mailfilter",
    description:
      "Nachrichten pro Postfach automatisch sortieren und markieren.",
    scope: "Nur für dich",
    group: "personal",
  },
  {
    id: "contacts",
    title: "Adressbuch",
    description: "Deine Kontakte und das automatische Merken von Empfängern.",
    scope: "Nur für dich",
    group: "personal",
  },
  {
    id: "appearance",
    title: "Darstellung",
    description: "Design, Sprache und die Anzeige deiner Nachrichten anpassen.",
    scope: "Dieser Browser",
    group: "personal",
  },
  {
    id: "security",
    title: "Sicherheit",
    description: "Deine Anmeldung und die Zugriffsrechte in MiniMail.",
    scope: "Dein Benutzerkonto",
    group: "personal",
  },
  {
    id: "ai",
    title: "KI-Funktionen",
    description:
      "Verfügbarkeit und gemeinsame Konfiguration der KI-Funktionen.",
    scope: "Für alle Benutzer",
    group: "shared",
  },
  {
    id: "updates",
    title: "System und Updates",
    description: "Version und geprüfte GitHub-Releases.",
    scope: "Nur Administratoren",
    group: "shared",
    adminOnly: true,
  },
  {
    id: "backups",
    title: "Backup und Wiederherstellung",
    description:
      "Alle MiniMail-Anwendungsdaten verschlüsselt sichern und wiederherstellen.",
    scope: "Nur Administratoren",
    group: "shared",
    adminOnly: true,
  },
  {
    id: "users",
    title: "Benutzerverwaltung",
    description: "Benutzer anlegen und den Zugang bei Bedarf zurücksetzen.",
    scope: "Nur Administratoren",
    group: "shared",
    adminOnly: true,
  },
];

export const settingsPages = (role) =>
  pages.filter((page) => !page.adminOnly || role === "admin");

export function settingsPage(role, id) {
  const available = settingsPages(role);
  return available.find((page) => page.id === id) || available[0];
}
