import { calendarTranslations } from "./calendar/calendarTranslations.js";
import { mailFilterTranslations } from "./mailFilterTranslations.js";
const translations = {
  ...mailFilterTranslations,
  "Backup und Wiederherstellung": "Backup and restore",
  "Alle MiniMail-Anwendungsdaten verschlüsselt sichern und wiederherstellen.":
    "Create encrypted backups of all MiniMail application data and restore them.",
  "Enthält alle Benutzer, Postfächer und Zugangsdaten, 2FA, Schlüssel, Kontakte, Entwürfe samt Anhängen, KI-Einstellungen sowie Kalender, Termine und Aufgaben.":
    "Includes all users, mailbox settings and credentials, 2FA, keys, contacts, drafts with attachments, AI settings, calendars, events and tasks.",
  "E-Mails und Anhänge auf externen Mailservern, Serverdateien und lokale Browser-Einstellungen sind nicht enthalten. Für Serverdateien gibt es zusätzlich den Installations-Backup-Befehl.":
    "Messages and attachments on external mail servers, server files and local browser preferences are not included. Use the additional installation backup command for server files.",
  "Dein Admin-Passwort": "Your administrator password",
  "Aktueller 2FA-Code": "Current 2FA code",
  "Backup-Passwort (mindestens 12 Zeichen)":
    "Backup password (at least 12 characters)",
  "Backup-Passwort wiederholen (Export)": "Repeat backup password (export)",
  "Das Backup-Passwort muss mindestens 12 Zeichen lang sein.":
    "The backup password must contain at least 12 characters.",
  "Die Backup-Passwörter stimmen nicht überein.":
    "The backup passwords do not match.",
  "Bewahre das Backup-Passwort getrennt von der Datei auf. Ohne dieses Passwort ist keine Wiederherstellung möglich. Für jede Aktion wird ein neuer 2FA-Code benötigt.":
    "Store the backup password separately from the file. Recovery is impossible without this password. Each operation requires a new 2FA code.",
  "Sicherung wird erstellt …": "Creating backup …",
  "Verschlüsseltes Backup herunterladen": "Download encrypted backup",
  "Alle Anwendungsdaten wiederherstellen": "Restore all application data",
  "Der Import ersetzt die Daten aller Benutzer. Vorher wird automatisch ein Sicherheitsbackup mit dem eingegebenen Backup-Passwort auf dem Server gespeichert. Bei einem Fehler bleibt die bestehende Datenbank erhalten. Danach müssen sich alle neu anmelden; es gelten die Zugangsdaten aus dem Backup.":
    "Import replaces every user's data. A safety backup encrypted with the entered backup password is saved on the server first. If an error occurs, the existing database is preserved. Afterwards everyone must sign in again using the credentials from the backup.",
  "Sicherungsdatei (maximal 512 MiB)": "Backup file (maximum 512 MiB)",
  "Zur Bestätigung ALLE DATEN ERSETZEN eingeben":
    "Type ALLE DATEN ERSETZEN to confirm",
  "Wiederherstellung läuft …": "Restoring …",
  "Alle Daten wiederherstellen": "Restore all data",
  "Sicherheitsbackups vor früheren Importen":
    "Safety backups from earlier imports",
  "Administratoren können Passwörter und 2FA zurücksetzen sowie die gespeicherten Anwendungsdaten aller Benutzer sichern und wiederherstellen. Personen mit direktem Serverzugriff können technisch auf gespeicherte Daten zugreifen.":
    "Administrators can reset passwords and 2FA and back up and restore all users' stored application data. People with direct server access can technically access stored data.",
  "System und Updates": "System and updates",
  "Version und geprüfte GitHub-Releases.":
    "Version and verified GitHub releases.",
  "Installierte Version": "Installed version",
  Datenbankschema: "Database schema",
  "Update-Modus": "Update mode",
  "Release-Kanal": "Release channel",
  Lizenz: "License",
  Benachrichtigen: "Notify",
  Manuell: "Manual",
  "Automatische Patch-Updates": "Automatic patch updates",
  "Auf Updates prüfen": "Check for updates",
  "Release ansehen": "View release",
  "Für diesen Kanal ist noch kein Release veröffentlicht.":
    "No release has been published for this channel yet.",
  "Die installierte Version ist aktuell.":
    "The installed version is up to date.",
  "Installation und Update-Modus werden mit dem MiniMail-Updater auf dem Server verwaltet.":
    "Installation and update policy are managed with the MiniMail updater on the server.",
  "Die Update-Prüfung ist fehlgeschlagen. Es wurden keine Änderungen installiert.":
    "The update check failed. No changes were installed.",
  ...calendarTranslations,
  "Änderungen werden sofort übernommen.": "Changes take effect immediately.",
  "KI-Änderungen mit Speichern übernehmen.": "Apply AI changes with Save.",
  "Die Verwaltung gemeinsamer Einstellungen ist Administratoren vorbehalten.":
    "Only administrators can manage shared settings.",
  "Deine persönlichen Daten bleiben deinem Benutzerkonto zugeordnet.":
    "Your personal data stays associated with your user account.",
  "Persönliche Einstellungen und Verwaltung an einem Ort.":
    "Personal settings and administration in one place.",
  Administrator: "Administrator",
  "Einstellungen schließen": "Close settings",
  Einstellungsbereiche: "Settings sections",
  "Mein Bereich": "My settings",
  Administration: "Administration",
  Funktionen: "Features",
  "Persönliches und gemeinsame Einstellungen sind getrennt.":
    "Personal and shared settings are kept separate.",
  "Die KI-Verbindung gilt für alle Benutzer. Nur Administratoren können sie ändern; andere Benutzer sehen nur die Verfügbarkeit.":
    "The AI connection is shared by all users. Only administrators can change it; other users see availability only.",
  Postfächer: "Mailboxes",
  "Verbindungen, Absender und Schlüssel deiner Postfächer verwalten.":
    "Manage connections, sender identities and keys for your mailboxes.",
  "Nur für dich": "Only for you",
  "Deine Kontakte und das automatische Merken von Empfängern.":
    "Your contacts and automatic recipient collection.",
  "Design, Sprache und die Anzeige deiner Nachrichten anpassen.":
    "Customize the theme, language and message display.",
  "Dieser Browser": "This browser",
  "Deine Anmeldung und die Zugriffsrechte in MiniMail.":
    "Your sign-in and access permissions in MiniMail.",
  "Dein Benutzerkonto": "Your user account",
  "Verfügbarkeit und gemeinsame Konfiguration der KI-Funktionen.":
    "Availability and shared configuration of AI features.",
  "Für alle Benutzer": "For all users",
  "Benutzer anlegen und den Zugang bei Bedarf zurücksetzen.":
    "Create users and reset access when needed.",
  "Nur Administratoren": "Administrators only",
  Oberfläche: "Interface",
  "Nachrichten lesen": "Reading messages",
  "Design, Sprache und Konversationsansicht werden in diesem Browser gespeichert. Der Filter für gelesene E-Mails wird zusätzlich je Benutzer gespeichert.":
    "Theme, language and conversation view are saved in this browser. The read-email filter is also saved separately for each user.",
  "Adressbuch öffnen": "Open address book",
  "Dein Adressbuch und diese Einstellung gehören zu deinem Benutzerkonto und gelten auch auf anderen Geräten.":
    "Your address book and this setting belong to your user account and also apply on other devices.",
  "Zugangsdaten fehlen": "Credentials required",
  "Postfach entfernen": "Remove mailbox",
  "Verbinde dein erstes Postfach, um E-Mails zu lesen und zu senden.":
    "Connect your first mailbox to read and send email.",
  "Hier siehst und verwaltest du ausschließlich deine eigenen Postfächer. Absender, Signaturen und Verschlüsselung findest du beim jeweiligen Postfach.":
    "You can view and manage only your own mailboxes here. Sender identities, signatures and encryption are managed for each mailbox.",
  "Angemeldet als": "Signed in as",
  "Die Zwei-Faktor-Anmeldung ist für MiniMail verpflichtend.":
    "Two-factor authentication is required for MiniMail.",
  Aktiviert: "Enabled",
  "Noch nicht eingerichtet": "Not configured yet",
  "Wer kann was sehen?": "Who can see what?",
  "Benutzer sehen ihre eigenen Postfächer, Kontakte und Entwürfe. Administratoren verwalten zusätzlich Benutzer und gemeinsame KI-Einstellungen.":
    "Users see their own mailboxes, contacts and drafts. Administrators also manage users and shared AI settings.",
  "Administratoren können Passwörter und 2FA zurücksetzen. Personen mit direktem Serverzugriff können technisch auf gespeicherte Daten zugreifen.":
    "Administrators can reset passwords and 2FA. People with direct server access can technically access stored data.",
  "Einstellungen werden geladen …": "Loading settings …",
  "Benutzer werden geladen …": "Loading users …",
  "Gelesene E-Mails ausblenden": "Hide read emails",
  "Nur ungelesene E-Mails anzeigen. Gilt für alle Postfächer in diesem Browser.":
    "Show only unread emails. Applies to all mailboxes in this browser.",
  "Nur ungelesene": "Unread only",
  "Keine ungelesenen Nachrichten": "No unread messages",
  "Gelesene E-Mails sind ausgeblendet.": "Read emails are hidden.",
  "Alle Nachrichten anzeigen": "Show all messages",
  "Ungültige Nachricht.": "Invalid message.",
  "Bitte mindestens einen Empfänger in An, Cc oder Bcc eingeben.":
    "Enter at least one recipient in To, Cc or Bcc.",
  "Betreff ist ungültig (maximal 998 Zeichen, keine Zeilenumbrüche).":
    "Invalid subject (maximum 998 characters, no line breaks).",
  "Die Antwortkennung der ursprünglichen Nachricht ist ungültig. Bitte als neue Nachricht verfassen.":
    "The original message has an invalid reply identifier. Please compose a new message.",
  "Die Referenzkennungen der ursprünglichen Nachricht sind ungültig. Bitte als neue Nachricht verfassen.":
    "The original message has invalid reference identifiers. Please compose a new message.",
  "Nachrichtentext fehlt oder überschreitet 500000 Zeichen.":
    "Message text is missing or exceeds 500000 characters.",
  "Die Einstellungen für Signatur oder Verschlüsselung sind ungültig.":
    "The signing or encryption settings are invalid.",
  "Anhänge sind ungültig. Dateien bitte erneut hinzufügen.":
    "Invalid attachments. Please add the files again.",
  "Ein Anhang hat einen ungültigen Dateinamen oder Inhalt. Bitte erneut hinzufügen.":
    "An attachment has an invalid filename or content. Please add it again.",
  "Empfänger im Feld An sind ungültig (Adressen prüfen; keine Zeilenumbrüche).":
    "Invalid recipients in To (check addresses; no line breaks).",
  "Das Feld An ist zu lang (maximal 4096 Zeichen).":
    "The To field is too long (maximum 4096 characters).",
  "Empfänger im Feld Cc sind ungültig (Adressen prüfen; keine Zeilenumbrüche).":
    "Invalid recipients in Cc (check addresses; no line breaks).",
  "Das Feld Cc ist zu lang (maximal 4096 Zeichen).":
    "The Cc field is too long (maximum 4096 characters).",
  "Empfänger im Feld Bcc sind ungültig (Adressen prüfen; keine Zeilenumbrüche).":
    "Invalid recipients in Bcc (check addresses; no line breaks).",
  "Das Feld Bcc ist zu lang (maximal 4096 Zeichen).":
    "The Bcc field is too long (maximum 4096 characters).",

  "Nachricht konnte nicht verschoben werden.":
    "The message could not be moved.",
  "Nachricht konnte nicht gelöscht werden.":
    "The message could not be deleted.",
  "Nachrichtenstatus konnte nicht geändert werden.":
    "The message status could not be changed.",
  "Entwurfsspeicher voll. Bitte alte Entwürfe löschen.":
    "Draft storage is full. Please delete old drafts.",
  "Anmeldung ausgelastet. Bitte kurz warten.":
    "Sign-in is busy. Please try again shortly.",
  "Komprimierte Anfragen werden nicht unterstützt.":
    "Compressed requests are not supported.",
  "In Spam verschieben": "Move to spam",
  "Kein Spam-Ordner auf diesem Postfach gefunden.":
    "No spam folder found in this mailbox.",
  "Gespeicherte Entwürfe": "Saved drafts",
  "Keine gespeicherten Entwürfe.": "No saved drafts.",
  "Entwurf endgültig löschen?": "Permanently delete this draft?",
  "Entwurf nicht gefunden.": "Draft not found.",
  "Ungültiger Entwurf.": "Invalid draft.",
  "Entwurf speichern": "Save draft",
  "Entwurf gespeichert.": "Draft saved.",
  "Ungespeicherte Nachricht": "Unsaved message",
  "Möchtest du den aktuellen Stand als Entwurf speichern?":
    "Would you like to save the current message as a draft?",
  "Weiter bearbeiten": "Keep editing",
  "Änderungen verwerfen": "Discard changes",
  "Speichern und schließen": "Save and close",
  "Nachricht gesendet.": "Message sent.",
  "Nachricht gesendet. MiniMail konnte keine Kopie im Gesendet-Ordner speichern. Bitte nicht erneut senden; prüfe den Ordner auf dem Mailserver.":
    "Message sent. MiniMail could not save a copy in the Sent folder. Please do not send it again; check the folder on the mail server.",
  "Der gespeicherte Entwurf konnte nicht entfernt werden. Bitte lösche ihn unter Gespeicherte Entwürfe.":
    "The saved draft could not be removed. Please delete it under Saved drafts.",
  "Höchstens acht Anhänge sind erlaubt.":
    "A maximum of eight attachments is allowed.",
  "Bitte Absender wählen": "Please choose a sender",
  Nachrichtentext: "Message text",

  "Breite ziehen · Doppelklick setzt zurück":
    "Drag to resize · double-click to reset",
  Unbekannt: "Unknown",
  Posteingang: "Inbox",
  Gesendet: "Sent",
  Entwürfe: "Drafts",
  Papierkorb: "Trash",
  Archiv: "Archive",
  Nachrichtenseiten: "Message pages",
  "Erste Seite": "First page",
  "Neuere Nachrichten": "Newer messages",
  Seite: "Page",
  von: "of",
  Seitennummer: "Page number",
  "Ältere Nachrichten": "Older messages",
  "Letzte Seite": "Last page",
  "Bitte anmelden.": "Please sign in.",
  "Kein Archivordner auf diesem Postfach gefunden.":
    "No archive folder found in this mailbox.",
  "MiniMail startet …": "MiniMail is starting …",
  "E-Mail": "Email",
  "Design wechseln": "Switch theme",
  Einstellungen: "Settings",
  "Neue Nachricht": "New message",
  POSTFÄCHER: "MAILBOXES",
  Primärpostfach: "Primary mailbox",
  "Passwort ergänzen": "Add password",
  "ungelesene Nachrichten im Posteingang": "unread messages in the inbox",
  "Postfach verbinden": "Connect mailbox",
  ORDNER: "FOLDERS",
  "Ordner aktualisieren": "Refresh folders",
  "Ordner finden …": "Find a folder …",
  "Ordner finden": "Find a folder",
  "Ordnerfilter löschen": "Clear folder filter",
  "Unterordner anzeigen": "Show subfolders",
  "Unterordner ausblenden": "Hide subfolders",
  anzeigen: "show",
  ausblenden: "hide",
  "Kein passender Ordner.": "No matching folder.",
  "Abmelden …": "Signing out …",
  Abmelden: "Sign out",
  "Breite der Ordnerleiste": "Folder pane width",
  "E-Mails durchsuchen …": "Search email …",
  "E-Mails durchsuchen": "Search email",
  Aktualisieren: "Refresh",
  "Postfach vorbereiten": "Set up mailbox",
  "Die Serverdaten für": "The server settings for",
  "sind eingerichtet. Ergänze dein Postfach-Passwort, um E-Mails zu laden und zu senden.":
    "are ready. Add your mailbox password to receive and send email.",
  "Zugangsdaten ergänzen": "Add credentials",
  Suchergebnisse: "Search results",
  "Lade Nachrichten …": "Loading messages …",
  Nachricht: "message",
  Nachrichten: "messages",
  "Papierkorb leeren": "Empty trash",
  "Alle Nachrichten": "All messages",
  Konversation: "conversation",
  Konversationen: "Conversations",
  Konversationsansicht: "Conversation view",
  "Konversationsansicht umschalten": "Toggle conversation view",
  "Zusammengehörige E-Mails als aufklappbare Kette anzeigen.":
    "Show related messages as an expandable conversation.",
  "Konversation einklappen": "Collapse conversation",
  "Konversation aufklappen": "Expand conversation",
  "Nachrichten in der Konversation": "Messages in conversation",
  "Nachrichten in dieser Konversation": "messages in this conversation",
  Ein: "On",
  Aus: "Off",
  "Postfach wird geladen": "Loading mailbox",
  "Mit Anhang": "Has attachment",
  Markierung: "Star",
  "Keine Treffer gefunden": "No results found",
  "Hier ist alles erledigt": "Nothing here yet",
  "Versuche einen anderen Suchbegriff.": "Try another search term.",
  "In diesem Ordner liegen noch keine Nachrichten.":
    "There are no messages in this folder yet.",
  "Breite der Nachrichtenliste": "Message list width",
  Lesedarstellung: "Reading size",
  "Mailtext verkleinern": "Decrease message size",
  "Mailtext vergrößern": "Increase message size",
  Zurück: "Back",
  Antworten: "Reply",
  Archivieren: "Archive",
  "Als ungelesen markieren": "Mark as unread",
  Löschen: "Delete",
  NACHRICHT: "MESSAGE",
  an: "to",
  "Diese Nachricht enthält keinen lesbaren Text.":
    "This message has no readable text.",
  Anhänge: "Attachments",
  Weiterleiten: "Forward",
  "Keine Nachricht ausgewählt": "No message selected",
  "Wähle eine Nachricht aus, um sie hier zu lesen.":
    "Select a message to read it here.",
  "Aktionen für Ordner": "Folder actions",
  "Alle Nachrichten als gelesen markieren": "Mark all messages as read",
  "Aktionen für Nachricht": "Message actions",
  "Allen antworten": "Reply all",
  "Nur Absender antworten": "Reply to sender",
  Adressbuch: "Address book",
  "Kontakte verwalten": "Manage contacts",
  "Adressen suchen, hinzufügen und bearbeiten.":
    "Search, add, and edit addresses.",
  Öffnen: "Open",
  "Gesendete Empfänger automatisch merken":
    "Automatically remember sent recipients",
  "Neue Adressen nach erfolgreichem Senden im Adressbuch speichern.":
    "Save new addresses to the address book after sending.",
  "Kontakte suchen …": "Search contacts …",
  "Keine Kontakte gefunden.": "No contacts found.",
  "Kontakt bearbeiten": "Edit contact",
  "Kontakt hinzufügen": "Add contact",
  Name: "Name",
  Schließen: "Close",
  "Blindkopie an": "Bcc recipient",
  "Nachrichtenquelltext anzeigen": "View message source",
  "Mail-Weg auf Karte anzeigen": "Show mail trace on map",
  "Mit KI zusammenfassen": "Summarize with AI",
  "KI-Zusammenfassung": "AI summary",
  "Beim Zusammenfassen wird der lesbare Nachrichtentext an deinen KI-Server gesendet. Anhänge werden nicht übertragen.":
    "Summarizing sends the readable message text to your AI server. Attachments are not sent.",
  "Die Nachricht war sehr lang; nur der Anfang wurde zusammengefasst.":
    "This message was very long; only the beginning was summarized.",
  "Erneut zusammenfassen": "Summarize again",
  Zusammenfassen: "Summarize",
  "Mit KI überarbeiten": "Revise with AI",
  "KI-Änderung rückgängig": "Undo AI change",
  "Text mit KI überarbeiten": "Revise text with AI",
  "Ausgangstext anzeigen": "Show original draft",
  "Beim Erstellen werden Entwurf, Anweisungen, Betreff sowie Absender und Empfänger mit verfügbaren Namen an deinen KI-Server gesendet. Das Bcc-Feld, die gespeicherte Signatur und automatisch angehängte Zitate werden nicht übertragen. Die KI ergänzt Anrede, Absätze und Grußformel; deine Signatur wird später separat angehängt.":
    "When you generate a suggestion, the draft, instructions, subject, sender and recipients with available names are sent to your AI server. The Bcc field, saved signature and automatically appended quotes are not sent. AI adds a salutation, paragraphs and closing; your signature is appended separately later.",
  "Zusätzliche Anweisungen oder Stichpunkte":
    "Additional instructions or bullet points",
  "Zum Beispiel: freundlich antworten, Termin am Freitag vorschlagen …":
    "For example: reply politely, suggest a meeting on Friday …",
  "Du kannst den Mailtext leer lassen und die Nachricht nur aus Stichpunkten erstellen lassen.":
    "You can leave the draft empty and create the message from bullet points alone.",
  "Der zitierte Mailverlauf wird beim Übernehmen wieder angehängt.":
    "The quoted mail history will be reattached when you apply the suggestion.",
  "Vorschlag – vor dem Übernehmen bearbeitbar":
    "Suggestion — editable before applying",
  "Neu erstellen": "Generate again",
  "Vorschlag erstellen": "Generate suggestion",
  Übernehmen: "Apply",
  "KI-Funktionen": "AI features",
  "Text überarbeiten und Mails zusammenfassen":
    "Revise text and summarize messages",
  "Eigene KI ist eingerichtet.": "Your AI server is configured.",
  "Eigene KI ist noch nicht eingerichtet.":
    "Your AI server is not configured yet.",
  "Nur auf Klick wird Mailtext an deinen KI-Server gesendet.":
    "Message text is sent to your AI server only when you request it.",
  "OpenAI-kompatible Basis-URL": "OpenAI-compatible base URL",
  "Modell-ID deiner eigenen KI": "Model ID of your AI server",
  Modell: "Model",
  "API-Schlüssel (falls erforderlich)": "API key (if required)",
  "Ausgabetokens: Text überarbeiten": "Output tokens: revise text",
  "Ausgabetokens: Zusammenfassen": "Output tokens: summarize",
  "Kein MiniMail-Limit": "No MiniMail limit",
  "Leer lassen: MiniMail setzt kein Tokenlimit. Dein KI-Server kann eigene Grenzen haben.":
    "Leave blank: MiniMail does not set a token limit. Your AI server may have its own limits.",
  "Bitte eine positive ganze Zahl oder leer eingeben.":
    "Enter a positive whole number or leave the field blank.",
  "Optional bei lokaler KI": "Optional for local AI",
  "Schlüssel unverändert lassen": "Leave key unchanged",
  "API-Schlüssel entfernen": "Remove API key",
  "KI deaktivieren": "Disable AI",
  "Nur eigene KI-Endpunkte sind erlaubt.":
    "Only self-hosted AI endpoints are allowed.",
  "HTTP ist nur für lokale KI-Endpunkte erlaubt.":
    "HTTP is allowed only for local AI endpoints.",
  "Ungültige KI-Einstellung.": "Invalid AI setting.",
  "KI ist noch nicht eingerichtet.": "AI is not configured yet.",
  "Ungültige KI-Anfrage.": "Invalid AI request.",
  "KI-Text fehlt oder ist zu lang.": "AI text is missing or too long.",
  "KI-Anfrage hat zu lange gedauert.": "The AI request timed out.",
  "KI-Dienst nicht erreichbar.": "AI service is unavailable.",
  "KI-API-Schlüssel wurde abgelehnt.": "The AI API key was rejected.",
  "KI-Limit erreicht. Bitte später erneut versuchen.":
    "AI rate limit reached. Please try again later.",
  "KI-Dienst konnte die Anfrage nicht verarbeiten.":
    "The AI service could not process the request.",
  "Ungültige Antwort vom KI-Dienst.": "Invalid response from the AI service.",
  "KI hat keine vollständige Antwort geliefert.":
    "AI did not return a complete response.",
  "KI-Ausgabelimit erreicht. Prüfe das Tokenlimit in den KI-Einstellungen oder auf deinem Server.":
    "The AI reached its output limit. Check the token limit in AI settings or on your server.",
  "KI hat keinen lesbaren Text geliefert.": "AI did not return readable text.",
  "Zu viele KI-Anfragen. Bitte kurz warten.":
    "Too many AI requests. Please wait a moment.",
  "Mail-Weg auf Karte": "Mail trace on map",
  "Stationen aus den Received-Headern": "Hops from Received headers",
  "Mail-Weg konnte nicht geladen werden.": "Could not load mail trace.",
  "Mail-Weg wird ermittelt …": "Tracing mail route …",
  "Karte der Mailserver": "Map of mail servers",
  "Ort unbekannt": "Unknown location",
  "Keine öffentlichen Server-IPs in den Mail-Headern gefunden.":
    "No public server IPs found in the mail headers.",
  "GeoIP-Datenbank nicht verfügbar; IPs werden ohne Karte angezeigt.":
    "GeoIP database unavailable; IPs are shown without map locations.",
  "Standorte sind Schätzungen. Received-Header können gefälscht sein; Linien zeigen Mailstationen, nicht den tatsächlichen Netzwerkweg.":
    "Locations are estimates. Received headers can be forged; lines connect mail hops, not the actual network path.",
  Nachrichtenquelltext: "Message source",
  "Quelltext konnte nicht geladen werden.": "Could not load message source.",
  "Verschlüsselung und Schlüssel": "Encryption and keys",
  Schlüssel: "Keys",
  "Private Schlüssel bleiben verschlüsselt auf deinem Server.":
    "Private keys remain encrypted on your server.",
  "Standard beim Schreiben": "Default when composing",
  Verfahren: "Method",
  Signieren: "Sign",
  Verschlüsseln: "Encrypt",
  "Neue Nachrichten automatisch signieren": "Automatically sign new messages",
  "Automatisch verschlüsseln, wenn alle Empfänger Schlüssel haben":
    "Encrypt automatically when every recipient has a key",
  "Fehlt ein Empfängerschlüssel, wird ohne Verschlüsselung gesendet. Die Signatur bleibt aktiv, falls sie eingeschaltet ist.":
    "If a recipient key is missing, the message is sent without encryption. Signing remains active if enabled.",
  Verschlüsselung: "Encryption",
  Automatisch: "Automatic",
  Erzwingen: "Require encryption",
  "Empfängerschlüssel werden geprüft …": "Checking recipient keys …",
  "Alle Empfänger haben passende Schlüssel: Verschlüsselung aktiv.":
    "All recipients have suitable keys: encryption is active.",
  "Ohne Verschlüsselung: ": "Without encryption: ",
  "Ohne Verschlüsselung: Für diese Empfänger fehlen passende Schlüssel: ":
    "Without encryption: Suitable keys are missing for these recipients: ",
  "Ohne Verschlüsselung: Schlüssel noch nicht bestätigt für: ":
    "Without encryption: Keys are not yet confirmed for: ",
  "Bitte zuerst Empfänger eingeben.": "Enter recipients first.",
  "Das eigene S/MIME-Zertifikat ist abgelaufen.":
    "Your S/MIME certificate has expired.",
  "Kein Verschlüsselungsverfahren ausgewählt.":
    "No encryption method selected.",
  "Standard speichern": "Save default",
  "Privatschlüssel eingerichtet": "Private key configured",
  "Kein Privatschlüssel eingerichtet": "No private key configured",
  "Armierter Privatschlüssel": "Armored private key",
  "OpenPGP-Schlüsseldatei auswählen": "Choose OpenPGP key file",
  Schlüsselpassphrase: "Key passphrase",
  "Schlüssel importieren": "Import key",
  "Schlüssel entfernen": "Remove key",
  "Zertifikat eingerichtet": "Certificate configured",
  "Kein Zertifikat eingerichtet": "No certificate configured",
  "Zertifikat abgelaufen: nur ältere Nachrichten entschlüsseln":
    "Certificate expired: decrypt older messages only",
  "PKCS#12-Datei (.p12/.pfx)": "PKCS#12 file (.p12/.pfx)",
  "Alternativ Zertifikat und Privatschlüssel als PEM einfügen.":
    "Alternatively, paste the certificate and private key as PEM.",
  "Zertifikat (PEM)": "Certificate (PEM)",
  "Privatschlüssel (PEM)": "Private key (PEM)",
  "Datei- oder Schlüsselpassphrase": "File or key passphrase",
  "Zertifikat importieren": "Import certificate",
  "Zertifikat entfernen": "Remove certificate",
  "Schlüssel und Zertifikate": "Keys and certificates",
  "Öffentlicher Schlüssel vorhanden": "Public key available",
  "Schlüssel automatisch gefunden – Fingerabdruck prüfen":
    "Key discovered automatically – check its fingerprint",
  "Kein öffentlicher Schlüssel vorhanden": "No public key available",
  "Öffentlicher Schlüssel": "Public key",
  "Schlüssel speichern": "Save key",
  "Zertifikat vorhanden": "Certificate available",
  "Zertifikat automatisch gefunden – Fingerabdruck prüfen":
    "Certificate discovered automatically – check its fingerprint",
  "Automatisch gefundene Schlüssel": "Automatically discovered keys",
  "Prüfe den Fingerabdruck über einen zweiten Kanal, bevor du einen Schlüssel bestätigst oder ersetzt.":
    "Check the fingerprint through another channel before confirming or replacing a key.",
  "Aktiv und bestätigt": "Active and confirmed",
  "Gesammelt, noch nicht bestätigt": "Collected, not yet confirmed",
  "Weiterer Schlüssel – aktiven Schlüssel nicht ersetzt":
    "Additional key – active key was not replaced",
  "Fingerabdruck bestätigt – verwenden": "Fingerprint confirmed – use key",
  "Öffentliches Zertifikat (PEM oder DER)": "Public certificate (PEM or DER)",
  "S/MIME-Zertifikatdatei auswählen": "Choose S/MIME certificate file",
  "Zertifikat speichern": "Save certificate",
  Fingerabdruck: "Fingerprint",
  Verschlüsselungsverfahren: "Encryption method",
  "Ohne Ende-zu-Ende-Schutz": "No end-to-end protection",
  "Als gelesen markieren": "Mark as read",
  "Markierung entfernen": "Remove star",
  Markieren: "Star",
  PAPIERKORB: "TRASH",
  "Papierkorb leeren?": "Empty trash?",
  "Alle Nachrichten in": "All messages in",
  "werden dauerhaft gelöscht. Das lässt sich nicht rückgängig machen.":
    "will be deleted permanently. This cannot be undone.",
  Abbrechen: "Cancel",
  "Dauerhaft löschen": "Delete permanently",
  "Noch kein Postfach verbunden": "No mailbox connected yet",
  "Füge die IMAP- und SMTP-Zugangsdaten deines Mailservers hinzu.":
    "Add the IMAP and SMTP credentials for your mail server.",
  "Postfach hinzufügen": "Add mailbox",
  "POSTFACH-EINSTELLUNGEN": "MAILBOX SETTINGS",
  "Postfach bearbeiten": "Edit mailbox",
  "Deine Zugangsdaten bleiben verschlüsselt auf deinem Server.":
    "Your credentials remain encrypted on your server.",
  "VPN-Verbindung": "VPN connection",
  "Verbindung für dieses Postfach": "Connection for this mailbox",
  "Direkt (ohne VPN)": "Direct (without VPN)",
  "IMAP und SMTP dieses Postfachs verwenden die ausgewählte Server-VPN-Verbindung.":
    "This mailbox uses the selected server VPN connection for IMAP and SMTP.",
  "Ungültiges VPN-Profil.": "Invalid VPN profile.",
  "Dieses VPN-Profil ist nicht verfügbar.":
    "This VPN profile is not available.",
  "Das VPN-Profil ist auf diesem Server nicht verfügbar.":
    "The VPN profile is not available on this server.",
  Anzeigename: "Display name",
  "Absender und Signatur": "Sender and signature",
  Absendername: "Sender name",
  "Automatische Signatur": "Automatic signature",
  "Keine Signatur": "No signature",
  "Die Signatur wird beim Schreiben automatisch an die Nachricht angehängt.":
    "The signature is automatically added when you write a message.",
  "Ungültiger Absendername.": "Invalid sender name.",
  "Ungültige Signatur.": "Invalid signature.",
  "Mein Postfach": "My mailbox",
  "E-Mail-Adresse": "Email address",
  "name@beispiel.de": "name@example.com",
  "imap.beispiel.de": "imap.example.com",
  "smtp.beispiel.de": "smtp.example.com",
  Eingangsserver: "Incoming server",
  Ausgangsserver: "Outgoing server",
  "Direktes TLS": "Direct TLS",
  "TLS ab Verbindungsbeginn": "TLS from the start of the connection",
  "STARTTLS verpflichtend": "STARTTLS required",
  "SMTP-Benutzername": "SMTP username",
  "SMTP-Passwort": "SMTP password",
  "(optional)": "(optional)",
  "Wie bei IMAP": "Same as IMAP",
  "Unverändert lassen": "Leave unchanged",
  Anmeldung: "Sign-in",
  Benutzername: "Username",
  "Passwort / App-Passwort": "Password / app password",
  "Postfach-Passwort": "Mailbox password",
  "Bei Providern mit 2FA benötigst du meistens ein App-Passwort für IMAP/SMTP.":
    "Providers with 2FA usually require an app password for IMAP/SMTP.",
  "Automatischer Abruf": "Automatic check",
  "Alle wie viele Minuten prüfen?": "Check every how many minutes?",
  "Standard: 5 Minuten. Mit 0 ist der automatische Abruf für dieses Postfach aus.":
    "Default: 5 minutes. Set 0 to disable automatic checks for this mailbox.",
  "Verbindung erfolgreich": "Connection successful",
  "Verbindung testen": "Test connection",
  Speichern: "Save",
  "Postfächer, Benutzer und Darstellung verwalten.":
    "Manage mailboxes, users, and appearance.",
  "Verbundene Postfächer": "Connected mailboxes",
  "Automatischer Abruf aus": "Automatic checks off",
  "Prüfung fehlgeschlagen": "Check failed",
  "noch nicht geprüft": "not checked yet",
  "Als Primärpostfach festlegen": "Set as primary mailbox",
  Primär: "Primary",
  "Als primär": "Make primary",
  Bearbeiten: "Edit",
  Entfernen: "Remove",
  "Weiteres Postfach verbinden": "Connect another mailbox",
  Darstellung: "Appearance",
  Farbschema: "Theme",
  "Wähle deinen bevorzugten Modus.": "Choose your preferred theme.",
  Sprache: "Language",
  "Wähle die Sprache der Oberfläche.": "Choose the interface language.",
  Hell: "Light",
  Dunkel: "Dark",
  Sicherheit: "Security",
  "Zwei-Faktor-Anmeldung": "Two-factor authentication",
  Für: "Enabled for",
  aktiviert: "",
  VON: "FROM",
  Von: "From",
  Absenderadresse: "Sender address",
  "Passwort fehlt": "Password missing",
  "Signatur für": "Signature for",
  "KEIN POSTFACH": "NO MAILBOX",
  An: "To",
  "Empfänger-Adresse": "Recipient address",
  "Kopie an": "Cc recipient",
  Betreff: "Subject",
  "Worum geht es?": "Subject",
  "Schreibe deine Nachricht …": "Write your message …",
  Senden: "Send",
  "Dateien anhängen": "Attach files",
  "Anhänge dürfen zusammen höchstens 8 MB groß sein.":
    "Attachments may total no more than 8 MB.",
  "Gesendet über": "Sent via",
  "Die neuen Passwörter stimmen nicht überein.":
    "The new passwords do not match.",
  "Passwort ändern": "Change password",
  Anmelden: "Sign in",
  "2FA einrichten": "Set up 2FA",
  "Lege für deinen neuen Zugang ein eigenes Passwort fest.":
    "Set your own password for your new account.",
  "Scanne den QR-Code mit deiner Authenticator-App und bestätige den angezeigten Code.":
    "Scan the QR code with your authenticator app and confirm the displayed code.",
  "Melde dich mit deinem Benutzerkonto an.": "Sign in with your account.",
  "Admin-Zugang noch nicht eingerichtet.":
    "Administrator account not set up yet.",
  "Lege ihn auf dem Server im Terminal an:":
    "Create it in a terminal on the server:",
  "QR-Code für Authenticator-App": "QR code for authenticator app",
  "Schlüssel:": "Secret:",
  Bestätigungscode: "Confirmation code",
  "Aktuelles Passwort": "Current password",
  "Neues Passwort": "New password",
  "Mindestens 12 Zeichen": "At least 12 characters",
  "Neues Passwort wiederholen": "Repeat new password",
  Passwort: "Password",
  "2FA-Code": "2FA code",
  "(falls bereits eingerichtet)": "(if already set up)",
  "Passwort speichern": "Save password",
  "2FA aktivieren": "Enable 2FA",
  "Anderen Benutzer anmelden": "Sign in as another user",
  Benutzerverwaltung: "User management",
  "Nur Admins können Benutzerkonten anlegen. Jeder Benutzer verwaltet eigene Postfächer.":
    "Only administrators can create user accounts. Each user manages their own mailboxes.",
  "Neuer Benutzername": "New username",
  "3–40 Zeichen: Buchstaben, Zahlen, Punkt, Unterstrich oder Bindestrich":
    "3–40 characters: letters, numbers, period, underscore, or hyphen",
  Anlegen: "Create",
  "Einmaliges Startpasswort für": "One-time temporary password for",
  "Jetzt sicher an die Person weitergeben. Es wird danach nicht erneut angezeigt. Beim ersten Login muss sie es ändern und 2FA einrichten.":
    "Share it securely now. It will not be shown again. The user must change it and set up 2FA on first sign-in.",
  "Passwort kopieren": "Copy password",
  "(du)": "(you)",
  Benutzer: "User",
  "Passwortwechsel ausstehend": "Password change pending",
  "2FA aktiv": "2FA active",
  "2FA noch nicht eingerichtet": "2FA not set up yet",
  "Passwort zurücksetzen": "Reset password",
  "2FA zurücksetzen": "Reset 2FA",
  "Kopieren nicht möglich. Bitte das Passwort manuell markieren.":
    "Could not copy. Please select the password manually.",
  "Bitte zuerst ein Postfach verbinden.": "Connect a mailbox first.",
  "Bitte zuerst das Passwort ändern.": "Please change your password first.",
  "Zwei-Faktor-Anmeldung zuerst einrichten.":
    "Set up two-factor authentication first.",
  "Nur für Admins verfügbar.": "Available to administrators only.",
  "Anmeldedaten oder 2FA-Code stimmen nicht.":
    "The credentials or 2FA code are incorrect.",
  "Zu viele Versuche. Bitte später erneut versuchen.":
    "Too many attempts. Please try again later.",
  "Aktuelles Passwort prüfen und ein neues mit mindestens 12 Zeichen wählen.":
    "Check your current password and choose a new one with at least 12 characters.",
  "2FA ist bereits aktiv.": "2FA is already enabled.",
  "Der Code ist ungültig.": "The code is invalid.",
  "Benutzername: 3–40 Zeichen (Buchstaben, Zahlen, . _ -).":
    "Username: 3–40 characters (letters, numbers, . _ -).",
  "Benutzername ist bereits vergeben.": "Username is already taken.",
  "Benutzer nicht gefunden.": "User not found.",
  "Eigenes Passwort über das Profil ändern.":
    "Change your own password in your profile.",
  "Eigene 2FA kann hier nicht zurückgesetzt werden.":
    "You cannot reset your own 2FA here.",
  "Ungültiger Ursprung.": "Invalid origin.",
  "Ungültige E-Mail-Adresse.": "Invalid email address.",
  "Ungültiges Postfach-Passwort.": "Invalid mailbox password.",
  "Ungültiger SMTP-Benutzername.": "Invalid SMTP username.",
  "Ungültiges SMTP-Passwort.": "Invalid SMTP password.",
  "Das Abrufintervall muss zwischen 0 und 1440 Minuten liegen.":
    "The check interval must be between 0 and 1440 minutes.",
  "Postfach-Passwort fehlt.": "Mailbox password is required.",
  "Ordner fehlt.": "Folder is required.",
  "Nachricht nicht gefunden.": "Message not found.",
  "Anhang nicht gefunden.": "Attachment not found.",
  "Zielordner fehlt.": "Destination folder is required.",
  "Papierkorb fehlt.": "Trash folder is required.",
  "Kein Papierkorb-Ordner.": "This is not a trash folder.",
  "Empfänger, Nachricht oder Anhänge sind ungültig.":
    "The recipients, message, or attachments are invalid.",
  "Der Posteingang konnte nicht geprüft werden.":
    "The inbox could not be checked.",
  "Diese Nachricht ist für die Webansicht zu groß (über 25 MB).":
    "This message is too large for the web viewer (over 25 MB).",
  "Der Papierkorb konnte nicht geleert werden.":
    "The trash folder could not be emptied.",
  "Die Anfrage konnte nicht abgeschlossen werden. Bitte Verbindung und Eingaben prüfen.":
    "The request could not be completed. Check your connection and input.",
  "Die Anfrage ist zu groß.": "The request is too large.",
  "Ungültiges JSON.": "Invalid JSON.",
  "Postfach nicht gefunden.": "Mailbox not found.",
  "Verbindung oder Anmeldung fehlgeschlagen. Bitte Server, Port und Zugangsdaten prüfen.":
    "Connection or sign-in failed. Check the server, port, and credentials.",
};

const storageKey = "minimail-language";
let language =
  typeof localStorage !== "undefined" &&
  localStorage.getItem(storageKey) === "en"
    ? "en"
    : "de";
if (typeof document !== "undefined") document.documentElement.lang = language;

export function getLanguage() {
  return language;
}

export function setLanguage(next) {
  language = next === "en" ? "en" : "de";
  localStorage.setItem(storageKey, language);
  document.documentElement.lang = language;
}

export function dateLocale() {
  return language === "en" ? "en-US" : "de-DE";
}

export function choose(german, english) {
  return language === "en" ? english : german;
}

export function t(value) {
  if (language === "de" || typeof value !== "string") return value;
  const normalized = value.trim().replace(/\s+/g, " ");
  let translated = translations[normalized];
  if (translated === undefined) {
    const required = normalized.match(/^(.+) fehlt\.$/);
    const invalid = normalized.match(/^(.+) ist ungültig\.$/);
    const mailConnection = normalized.match(
      /^(IMAP|SMTP)-Verbindung oder Anmeldung fehlgeschlagen\. Bitte Server, Port und Zugangsdaten prüfen\.$/,
    );
    if (required) translated = `${required[1]} is required.`;
    else if (invalid) translated = `${invalid[1]} is invalid.`;
    else if (mailConnection)
      translated = `${mailConnection[1]} connection or sign-in failed. Check the server, port, and credentials.`;
  }
  if (translated === undefined) return value;
  const prefix = value.match(/^\s*/)?.[0] || "";
  const suffix = value.match(/\s*$/)?.[0] || "";
  return prefix + translated + suffix;
}
