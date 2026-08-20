/**
 * English messages.
 *
 * Must provide every key defined by the Traditional Chinese catalogue, which
 * is the source of truth; the `Messages` type makes a missing key a build
 * error rather than a blank label at runtime.
 */

import type { Messages } from "./zh-TW";

export const en: Messages = {
  // Common ----------------------------------------------------------------
  "common.appName": "LatticeTerm",
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.delete": "Delete",
  "common.edit": "Edit",
  "common.duplicate": "Duplicate",
  "common.reset": "Reset",
  "common.search": "Search",
  "common.export": "Export",
  "common.import": "Import",
  "common.clear": "Clear",
  "common.notSet": "Not set",
  "common.none": "None",
  "common.optional": "Optional",
  "common.comingSoon": "Coming soon",
  "common.available": "Available",
  "common.copy": "Copy",
  "common.copied": "Copied",
  "common.detecting": "Detecting…",

  // System credential storage --------------------------------------------
  "credential.saved.title": "Password stored securely",
  "credential.useSaved": "Use the password saved in {provider}",
  "credential.remember": "Save to {provider} after successful authentication",
  "credential.remove": "Delete saved password",
  "credential.removing": "Deleting…",
  "credential.removeFailed.title": "Could not delete the saved password",
  "credential.removeFailed.body": "The system credential store refused the deletion: {detail}",
  "credential.unavailable.title": "System credential storage is unavailable",
  "credential.unavailable.body":
    "You can still enter a password for this attempt, but it will not be saved. Reason: {detail}",

  // Navigation ------------------------------------------------------------
  "nav.connections": "Connections",
  "nav.connections.desc": "Find, organise and edit remote hosts",
  "nav.agents": "AI Agent Fleet",
  "nav.agents.desc": "Run and monitor multiple local LLM CLIs",
  "nav.tunnels": "Tunnels",
  "nav.tunnels.desc": "Local, remote and dynamic port forwarding",
  "nav.vault": "Key vault",
  "nav.vault.desc": "Keys, credentials and host trust",
  "nav.activity": "Activity",
  "nav.activity.desc": "Changes made while this window has been open",
  "nav.settings": "Settings",
  "nav.settings.desc": "Appearance, language and security preferences",

  // Connection list -------------------------------------------------------
  "connections.add": "Add connection",
  "connections.loadSamples": "Load samples",
  "connections.importJson": "Import file",
  "connections.exportJson": "Export",
  "connections.count": "{count} connections",
  "connections.countFiltered": "Showing {visible} of {total} connections",
  "connections.sortBy": "Sort by",
  "connections.sort.name": "Name",
  "connections.sort.hostname": "Hostname",
  "connections.sort.environment": "Environment",
  "connections.empty.title": "No connections yet",
  "connections.empty.body":
    "Add the hosts you want to reach and they will be one click away. Passwords are requested only when connecting and can be saved in the operating system secure store.",
  "connections.empty.footnote":
    "Samples use documentation-only names and addresses, not real hosts.",
  "connections.noResults.title": "No connections match",
  "connections.noResults.body":
    "Every host is still here — the current search and filters simply exclude them all.",
  "connections.resetFilters": "Clear filters",
  "connections.all": "All connections",
  "connections.favorites": "Favorites",
  "connections.groups": "Groups",
  "connections.protocols": "Protocols",
  "connections.environments": "Environments",
  "connections.tags": "Tags",
  "connections.ungrouped": "Ungrouped",
  "connections.searchPlaceholder": "Search hosts, addresses or tags",
  "connections.clearSearch": "Clear search",
  "connections.shown": "{visible} of {total} shown",

  // Connection card -------------------------------------------------------
  "row.connect": "Connect",
  "row.connectComingSoon": "Connecting is in development",
  "row.addFavorite": "Add {name} to favorites",
  "row.removeFavorite": "Remove {name} from favorites",
  "row.edit": "Edit {name}",
  "row.duplicate": "Duplicate {name}",
  "row.delete": "Delete {name}",
  "row.details": "Show details for {name}",

  // Add and edit form -----------------------------------------------------
  "form.addTitle": "New connection",
  "form.editTitle": "Edit connection",
  "form.addEyebrow": "Add",
  "form.editEyebrow": "Edit",
  "form.step.protocol": "How to connect",
  "form.step.target": "Where the host is",
  "form.step.organise": "How to organise it",
  "form.step.auth": "Sign-in details",
  "form.step.review": "Review",
  "form.protocolHint":
    "The usual port is filled in for you, and you can still change it.",
  "form.name": "Display name",
  "form.namePlaceholder": "For example: Production gateway",
  "form.hostname": "Hostname or IP address",
  "form.hostnamePlaceholder": "gateway.example.com",
  "form.username": "Username",
  "form.usernamePlaceholder": "For example: operator",
  "form.port": "Port",
  "form.environment": "Environment",
  "form.group": "Group",
  "form.groupPlaceholder": "For example: Core platform",
  "form.tags": "Tags",
  "form.tagsHint": "Comma separated",
  "form.tagsPlaceholder": "edge, eu-west",
  "form.favorite": "Add to favorites",
  "form.organiseHint":
    "Environment and group drive the ordering, and make production hosts obvious at a glance.",
  "form.auth.title": "Passwords are never written into connection profiles",
  "form.auth.body":
    "After saving the host, enter its password when connecting and optionally store it in Windows Credential Manager, macOS Keychain, or Linux Secret Service.",
  "form.review.unnamed": "Unnamed connection",
  "form.review.noHost": "No host entered yet",
  "form.duplicate.title": "Another connection uses the same target",
  "form.duplicate.body":
    "{name} already reaches {target} over {protocol}. Saving is fine if that is deliberate.",
  "form.unsaved": "Unsaved changes",
  "form.noChanges": "No changes yet",
  "form.discard.question": "Discard your changes?",
  "form.discard.keep": "Keep editing",
  "form.discard.confirm": "Discard changes",
  "form.submit.add": "Add connection",
  "form.submit.save": "Save changes",

  "form.test.button": "Check settings",
  "form.test.valid.title": "The settings look right",
  "form.test.valid.body":
    "The address format, port {port} and protocol {protocol} are all valid. Whether it actually connects can only be tested once connections are built.",
  "form.test.invalid.title": "Something is still wrong",
  "form.test.invalid.body": "Fix the fields marked above, then check again.",

  // Validation ------------------------------------------------------------
  "validation.nameRequired": "Enter a display name.",
  "validation.nameTooLong": "Use {max} characters or fewer.",
  "validation.hostRequired": "Enter a hostname or IP address.",
  "validation.hostSpaces": "Hostnames cannot contain spaces.",
  "validation.hostScheme": "Enter the host only, without a prefix such as ssh://.",
  "validation.hostPath": "Enter the host only, without a path.",
  "validation.hostAccount": "Put the account in the username field.",
  "validation.hostChars": "Use letters, digits, dots, colons or hyphens.",
  "validation.hostTooLong": "Use {max} characters or fewer.",
  "validation.usernameSpaces": "Usernames cannot contain spaces.",
  "validation.usernameTooLong": "Use {max} characters or fewer.",
  "validation.portInteger": "Enter a whole number.",
  "validation.portRange": "Use a port between {min} and {max}.",
  "validation.groupTooLong": "Use {max} characters or fewer.",
  "validation.tagsTooMany": "Use {max} tags or fewer.",
  "validation.tagTooLong": "Each tag must be {max} characters or fewer.",

  // Delete confirmation ---------------------------------------------------
  "confirm.delete.title": "Delete {name}?",
  "confirm.delete.body":
    "This removes the entry for {host} from this workspace. The remote machine is not touched.",
  "confirm.delete.confirm": "Delete {name}",
  "confirm.delete.credential.title":
    "Delete the saved password for {name} first",
  "confirm.delete.credential.body":
    "This connection still has a password in {provider}. Open the Key Vault and explicitly delete it first so no unmanaged credential is left behind.",
  "confirm.delete.credential.loading":
    "Checking whether this connection has a saved password…",
  "confirm.delete.credential.openVault": "Open Key Vault",
  "confirm.delete.credential.checking": "Checking…",
  "confirm.delete.credential.unavailable.title":
    "This connection cannot be deleted safely right now",
  "confirm.delete.credential.unavailable.body":
    "LatticeTerm could not verify whether the system credential store still contains a password: {detail}",
  "confirm.delete.credential.blocked": "Deletion unavailable",

  // Inspector -------------------------------------------------------------
  "inspector.tab.info": "Details",
  "inspector.tab.metrics": "Host status",
  "inspector.section.target": "Where the host is",
  "inspector.host": "Hostname",
  "inspector.port": "Port",
  "inspector.username": "Username",
  "inspector.environment": "Environment",
  "inspector.group": "Group",
  "inspector.tags": "Tags",
  "inspector.services": "Services on this host",
  "inspector.security.title": "No credentials are attached",
  "inspector.security.body":
    "This entry holds host details only. Keys, passwords and host trust arrive with the secure store.",
  "inspector.close": "Close details",

  // Host metrics ----------------------------------------------------------
  "metrics.title": "Host resources",
  "metrics.notConnected.title": "Not connected, so there is nothing to show",
  "metrics.notConnected.body":
    "CPU, memory and disk usage have to be reported by the remote host after a successful connection. Live figures appear here once SSH connections are working.",
  "metrics.cpu": "Processor",
  "metrics.memory": "Memory",
  "metrics.swap": "Swap",
  "metrics.disk": "Disk",
  "metrics.uptime": "Uptime",
  "metrics.load": "Load average",
  "metrics.cores": "{count} cores",
  "metrics.usedOfTotal": "{used} of {total}",
  "metrics.percentUsed": "{percent}% used",
  "metrics.mountpoint": "Mount point",
  "metrics.refresh": "Refresh",
  "metrics.lastUpdated": "Updated {time}",
  "metrics.autoRefresh": "Auto refresh",
  "metrics.uptimeValue": "{days}d {hours}h",
  "metrics.uptimeHours": "{hours}h {minutes}m",

  // Activity --------------------------------------------------------------
  "activity.title": "Activity in this window",
  "activity.note.title": "Only changes made in this window",
  "activity.note.body":
    "This records what you did to your connection entries. It never contains passwords, commands or session output, and it is cleared when you close the app.",
  "activity.empty.title": "Nothing here yet",
  "activity.empty.body":
    "Add, edit or delete a connection and it will appear here with a timestamp.",
  "activity.count": "{count} entries, newest first",
  "activity.countFiltered": "Showing {visible} of {total} entries, newest first",
  "activity.searchPlaceholder": "Search activity",
  "activity.filter.all": "All",
  "activity.export": "Export log",
  "activity.clear": "Clear log",
  "activity.noMatch": "No entries match the current filter.",
  "activity.resetFilter": "Clear activity filter",
  "activity.confirmClear.title": "Clear the activity log?",
  "activity.confirmClear.body":
    "This removes all {count} entries from this window. Your connections are not affected.",
  "activity.confirmClear.confirm": "Clear {count} entries",
  "activity.kind.created": "Connection added",
  "activity.kind.updated": "Connection updated",
  "activity.kind.deleted": "Connection deleted",
  "activity.kind.workspace": "Workspace",
  "activity.samplesLoaded": "Sample connections loaded",
  "activity.samplesDetail": "{count} examples using documentation-only hostnames",
  "activity.duplicatedFrom": "Duplicated from {name}",

  // Settings --------------------------------------------------------------
  "settings.appearance": "Appearance",
  "settings.appearanceHint": "Applies immediately and is remembered.",
  "settings.theme": "Theme",
  "settings.themeHint": "Pick whichever is easiest on your eyes.",
  "settings.language": "Language",
  "settings.languageHint": "Language used across the interface.",
  "settings.density": "Density",
  "settings.densityHint":
    "Compact fits more hosts on screen when you manage a lot of them.",
  "settings.density.comfortable": "Comfortable",
  "settings.density.compact": "Compact",
  "settings.motion": "Motion",
  "settings.motionHint": "Turn animation off if it bothers you.",
  "settings.motion.system": "Follow system",
  "settings.motion.reduced": "Reduce motion",
  "settings.security": "Security",
  "settings.securityHint":
    "Strict host-key verification and system credential storage are active. Auto-lock, clipboard clearing, and encrypted backup are still in development.",
  "settings.security.title": "Host trust and system credential storage are active",
  "settings.security.body":
    "SSH, SFTP, and RDP passwords default to one connection attempt. When explicitly selected, only a successfully verified password is saved by the operating system; connection profiles remain secret-free.",
  "settings.security.autoLock": "Auto-lock the vault",
  "settings.security.autoLockDetail":
    "Lock after a period of inactivity, and when the app loses focus.",
  "settings.security.hostKey": "Host key verification policy",
  "settings.security.hostKeyDetail":
    "Strict known-host checking, with an explicit trust decision on first connect.",
  "settings.security.clipboard": "Clipboard clearing",
  "settings.security.clipboardDetail":
    "Clear copied secrets after a countdown, with an option to clear immediately.",
  "settings.security.backup": "Encrypted backup and recovery",
  "settings.security.backupDetail":
    "Export and restore local data without producing a plain-text file.",
  "settings.about": "About",
  "settings.aboutHint": "Reported by the running build.",
  "settings.about.application": "Application",
  "settings.about.version": "Version",
  "settings.about.runtime": "Runtime",
  "settings.about.runtime.tauri": "Desktop window",
  "settings.about.runtime.browser": "Browser preview (no desktop backend)",
  "settings.about.credentialStore": "Credential store",
  "settings.about.credentialStore.ready": "Available",
  "settings.about.credentialStore.pending": "Currently unavailable",
  "settings.about.license": "Licence",
  "settings.updater": "Software Updates",
  "settings.updaterHint": "Check for updates from GitHub Releases and update directly in-app without reinstalling.",
  "settings.updater.current": "Current version",
  "settings.updater.status": "Update status",
  "settings.updater.check": "Check for updates",
  "settings.updater.checking": "Checking for updates...",
  "settings.updater.upToDate": "You are up to date",
  "settings.updater.available": "New version {version} available",
  "settings.updater.download": "Download & Install Update",
  "settings.updater.downloading": "Downloading update ({percent}%)...",
  "settings.updater.downloaded": "Update downloaded, click to restart and apply",
  "settings.updater.relaunch": "Restart & Apply Update",
  "settings.updater.error": "Update check failed: {error}",
  "settings.updater.releaseNotes": "Release notes",

  // Themes ----------------------------------------------------------------
  "theme.system": "Follow system",
  "theme.dark": "Obsidian Amber",
  "theme.midnight": "Celestial Violet",
  "theme.graphite": "Arctic Frost",
  "theme.nordic": "Nordic Emerald",
  "theme.light": "Ivory & Cobalt",
  "theme.sand": "Terracotta Warm",
  "theme.contrast": "Matrix High Contrast",
  "theme.system.hint": "Switches with your operating system",
  "theme.dark.hint": "Default deep obsidian canvas with rich golden amber accents",
  "theme.midnight.hint": "Deep cosmic purple and electric violet glow",
  "theme.graphite.hint": "Cool titanium slate with crisp arctic cyan accents",
  "theme.nordic.hint": "Deep botanical forest dark with luminous emerald jade",
  "theme.light.hint": "Crisp porcelain canvas with deep cobalt blue accents",
  "theme.sand.hint": "Warm parchment canvas with rich terracotta cinnamon tones",
  "theme.contrast.hint": "Pure black with radiant amber gold for maximum visibility",

  // Command palette -------------------------------------------------------
  "palette.placeholder": "Search connections and commands",
  "palette.empty": "Nothing matches “{query}”.",
  "palette.navigate": "navigate",
  "palette.run": "run",
  "palette.dismiss": "dismiss",
  "palette.group.connections": "Connections",
  "palette.group.navigate": "Go to",
  "palette.group.actions": "Actions",
  "palette.group.appearance": "Appearance",
  "palette.goTo": "Go to {name}",
  "palette.command.add": "Add connection",
  "palette.command.addHint": "Open the new connection form",
  "palette.command.search": "Search connections",
  "palette.command.searchHint": "Focus the search field",
  "palette.command.theme": "Switch theme: {name}",
  "palette.command.language": "Switch language: {name}",
  "palette.command.density": "Use {name} density",
  "palette.command.sidebar.show": "Show sidebar",
  "palette.command.sidebar.hide": "Hide sidebar",
  "palette.command.samples": "Load sample connections",
  "palette.command.samplesHint": "Six examples using documentation-only hostnames",

  // Status bar ------------------------------------------------------------
  "status.connections": "{count} connections",
  "status.connectionsFiltered": "{visible} of {total} connections",
  "status.inMemory": "In memory only, cleared when you close the app",
  "status.vault": "Credential store: {state}",
  "status.vault.locked": "Not built yet",
  "status.vault.ready": "Available",
  "status.palette": "Command palette",

  "status.savedLocally": "Connections are saved on this machine",
  "status.notSaved": "In memory only, cleared when you close the app",
  "settings.storage": "Where data is kept",
  "settings.storageHint": "Connection details only — never any credentials.",
  "settings.storage.location": "File location",
  "settings.storage.browser":
    "A browser preview has no backend, so a reload clears everything",
  "settings.storage.saved": "{count} connections saved",
  "settings.storage.recovered.title": "The previous file could not be read",
  "settings.storage.recovered.body":
    "Nothing was deleted — the original is kept at {path}. The list starts empty for now. Reason: {reason}",

  // Planned areas ---------------------------------------------------------
  "planned.badge": "In development",
  "planned.notReady": "Not available yet",
  "planned.whatItDoes": "What this area will do",
  "planned.whatItDoesHint":
    "Written down so the plan is clear — not a claim that it works today.",
  "planned.boundary": "Security first",
  "planned.tunnels.summary":
    "Port forwarding for the hosts you already keep here: local, remote and dynamic tunnels, each showing where it goes and which connection uses it.",
  "planned.tunnels.boundary":
    "A tunnel rides on an established SSH connection, so this opens once connections and the secure store are done. Until then nothing is forwarded.",
  "planned.tunnels.cap1.title": "All three kinds at a glance",
  "planned.tunnels.cap1.detail":
    "Local, remote and dynamic forwarding each show their source, destination and bind scope.",
  "planned.tunnels.cap2.title": "Live state per tunnel",
  "planned.tunnels.cap2.detail":
    "Who is using it, how long it has been up, and whether it is starting, listening or stopped.",
  "planned.tunnels.cap3.title": "Errors you can act on",
  "planned.tunnels.cap3.detail":
    "It says whether the port is taken, the connection dropped, or permission was denied.",
  "planned.vault.summary":
    "One place for what must stay secret: SSH keys, saved passwords, jump host credentials, and the host fingerprints you have trusted.",
  "planned.vault.boundary":
    "Secrets go to the operating system credential store and host trust uses strict checking. Neither exists yet, which is why nothing asks you for a credential today.",
  "planned.vault.cap1.title": "Lock state you can see",
  "planned.vault.cap1.detail":
    "Locked, unlocking, unlocked, about to auto-lock and recovery required are all distinct.",
  "planned.vault.cap2.title": "Know what uses each item",
  "planned.vault.cap2.detail":
    "Every credential lists the connections that reference it, so nothing is deleted blindly.",
  "planned.vault.cap3.title": "Host trust you can verify",
  "planned.vault.cap3.detail":
    "Full, copyable fingerprints, with first connection and changed keys handled separately.",
  "planned.vault.cap4.title": "Encrypted import and export",
  "planned.vault.cap4.detail":
    "Move a vault between machines without writing a plain-text file.",

  // Connect flow ----------------------------------------------------------
  "connect.title": "Connect to {name}",
  "connect.target": "{user}@{host}:{port}",
  "connect.password": "Password",
  "connect.passwordHint":
    "Used for this connection only. It is not saved and never written to a file.",
  "connect.submit": "Connect",
  "connect.connecting": "Connecting…",
  "connect.authFailed": "That username or password was not accepted. Try again.",
  "connect.noUsername":
    "This connection has no username yet. Edit it first, then connect.",
  "connect.failed.title": "Could not reach this host",
  "connect.failed.body": "Failed while {stage}: {detail}",
  "connect.stage.connect": "opening the connection",
  "connect.stage.authenticate": "signing in",
  "connect.stage.channel": "opening a channel",
  "connect.stage.subsystem": "starting the SFTP subsystem",
  "connect.stage.directory": "reading the initial directory",
  "connect.stage.registry": "creating the session",
  "connect.stage.pty": "requesting a terminal",
  "connect.stage.shell": "starting the shell",
  "connect.stage.trust": "reading trusted host keys",
  "connect.stage.invoke": "calling the backend",
  "connect.stage.credential": "System credential storage",
  "connect.trusted": "Key remembered. Reconnecting…",

  // Terminal --------------------------------------------------------------
  "terminal.title": "Sessions",
  "terminal.desc": "Open AI CLI, SSH, SFTP, Lattice Remote, and Web RDP sessions",
  "terminal.disconnect": "Disconnect",
  "terminal.backToList": "Back to connections",
  "terminal.closed": "Session ended ({reason})",
  "terminal.inputFailed":
    "This session has ended, so input is going nowhere. Close the tab and connect again.",
  "terminal.reconnect": "Reconnect",
  "terminal.empty.title": "No session is open",
  "terminal.empty.body":
    "Launch a CLI from AI Agent Fleet or pick a host to open its session here.",

  // AI Agent Fleet --------------------------------------------------------
  "agents.hero.eyebrow": "Local collaboration hub",
  "agents.hero.title": "Keep multiple AI CLIs in view",
  "agents.hero.body":
    "Every agent runs in its own native terminal. Launch, switch, and stop them in parallel without moving existing sign-in data into LatticeTerm.",
  "agents.stats.installed": "Detected",
  "agents.stats.running": "Running",
  "agents.stats.attention": "May need input",
  "agents.security.title": "Each CLI keeps its own sign-in and permissions",
  "agents.security.body":
    "LatticeTerm only starts the local program and arguments you select; it does not read or store model API keys. CLIs still run with your user permissions, so add only executables you trust.",
  "agents.backend.unavailable.title": "Use the LatticeTerm desktop app",
  "agents.backend.unavailable.body":
    "The browser preview cannot access local PTYs. You can inspect this interface here, but it cannot launch a CLI.",
  "agents.launch.failed": "Could not launch the agent",
  "agents.directory.eyebrow": "Launch context",
  "agents.directory.title": "Choose a working directory and CLI",
  "agents.directory.refresh": "Detect again",
  "agents.cwd": "Working directory",
  "agents.cwd.placeholder": "For example /home/me/project",
  "agents.cwd.hint":
    "The agent starts in this folder and may read or change its files according to the CLI's permissions.",
  "agents.installed": "Available",
  "agents.notInstalled": "Not detected",
  "agents.path.missing": "No directly executable program was found on PATH",
  "agents.launching": "Launching…",
  "agents.launch": "Launch",
  "agents.custom.eyebrow": "Custom adapter",
  "agents.custom.title": "Connect another LLM CLI",
  "agents.custom.body":
    "Provide an executable and explicit argument vector; the system never joins them into a shell command.",
  "agents.custom.label": "Display name",
  "agents.custom.label.placeholder": "For example My Team Agent",
  "agents.custom.executable": "Executable",
  "agents.custom.executable.placeholder": "For example my-agent or an absolute path",
  "agents.custom.arguments": "Launch arguments",
  "agents.custom.arguments.placeholder": "--model\nteam-model\n--resume",
  "agents.custom.arguments.hint": "One argument per line; blank lines are ignored, up to 64.",
  "agents.custom.launch": "Launch custom CLI",
  "agents.broadcast.eyebrow": "Safe orchestration",
  "agents.broadcast.title": "Prompt multiple agents together",
  "agents.broadcast.body":
    "Select running agents, review the targets, and send the same prompt into each independent PTY.",
  "agents.broadcast.selectAll": "Select all",
  "agents.broadcast.clearAll": "Clear selection",
  "agents.broadcast.securityTitle": "Every broadcast requires explicit selection and confirmation",
  "agents.broadcast.securityBody":
    "The prompt is written only to the local agents selected for this send, with a final confirmation first. LatticeTerm does not save prompt content or create a background schedule.",
  "agents.broadcast.successTitle": "Broadcast prompt sent",
  "agents.broadcast.partialTitle": "Some agents did not receive the prompt",
  "agents.broadcast.result": "Delivered to {delivered}; failed for {failed}.",
  "agents.broadcast.empty": "Launch at least one agent to use broadcast prompts.",
  "agents.broadcast.prompt": "Shared prompt",
  "agents.broadcast.promptPlaceholder":
    "For example: review the current changes and list the three highest risks.",
  "agents.broadcast.promptHint":
    "Up to {count} agents and 16,000 characters. Line breaks are preserved; sending is equivalent to pressing Enter in every selected PTY.",
  "agents.broadcast.review": "Review send to {count}",
  "agents.broadcast.sending": "Sending…",
  "agents.broadcast.confirmTitle": "Send this broadcast prompt?",
  "agents.broadcast.confirmBody":
    "The same prompt will be sent immediately to {count} selected agents and Enter will be pressed in every PTY. Confirm that each one is currently ready to accept a prompt.",
  "agents.broadcast.confirmAction": "Send to {count} agents",
  "agents.running.eyebrow": "Live state",
  "agents.running.title": "Running agents",
  "agents.running.empty": "No agent is running. Choose a CLI above to begin.",
  "agents.state.needsAttention": "May be waiting for input",
  "agents.state.working": "Working",
  "agents.state.idle": "Idle",
  "agents.state.done": "Task complete",
  "agents.state.source.heuristic": "Inferred from output",
  "agents.state.source.integration": "Reported by adapter",
  "agents.open": "Open",
  "agents.stop": "Stop agent",
  "agents.stop.confirm.title": "Stop “{name}”?",
  "agents.stop.confirm.body":
    "This terminates the local CLI process. Anything the CLI has not saved may be lost.",
  "agents.stop.confirm.action": "Stop",
  "agents.terminal.inputFailed": "The agent has ended and can no longer accept input.",

  // SFTP ------------------------------------------------------------------
  "sftp.title": "SFTP file workspace",
  "sftp.path": "Remote path",
  "sftp.go": "Go",
  "sftp.up": "Up",
  "sftp.refresh": "Refresh",
  "sftp.newFolder": "New folder",
  "sftp.upload": "Upload",
  "sftp.download": "Download",
  "sftp.rename": "Rename",
  "sftp.delete": "Delete",
  "sftp.limit":
    "Each upload or download is limited to 32 MiB so large files never fill WebView memory.",
  "sftp.problem": "SFTP operation failed",
  "sftp.loading": "Reading the remote directory…",
  "sftp.empty": "This folder is empty.",
  "sftp.createPrompt": "New folder name",
  "sftp.renamePrompt": "New file or folder name",
  "sftp.deleteConfirm": "Delete “{name}”? This action cannot be undone.",
  "sftp.overwriteConfirm":
    "“{name}” already exists. Overwrite it? This action cannot be undone.",
  "sftp.overwriteDirectory":
    "“{name}” is a folder and cannot be overwritten by an uploaded file.",
  "sftp.tooLarge": "This file exceeds the {limit} MiB transfer limit.",
  "sftp.column.name": "Name",
  "sftp.column.size": "Size",
  "sftp.column.modified": "Modified",
  "sftp.column.permissions": "Permissions",
  "sftp.column.actions": "Actions",

  // Lattice Remote ---------------------------------------------------------
  "remote.connect.title": "Connect to {name}",
  "remote.connect.securityTitle": "One-time encrypted pairing",
  "remote.connect.securityBody":
    "The code is used only for this Noise handshake and is not saved. Version 1 is view-only and cannot send keyboard or mouse input.",
  "remote.connect.code": "Agent pairing code",
  "remote.connect.codeHint":
    "Enter the eight-digit code shown by lattice-agent on the remote device.",
  "remote.connect.codeInvalid": "The pairing code must contain eight digits.",
  "remote.connect.submit": "Start view-only session",
  "remote.connect.connecting": "Pairing securely…",
  "remote.connect.failedTitle": "Lattice Remote could not connect",
  "remote.connect.failedBody": "Stage: {stage}. {detail}",
  "remote.session.encrypted": "Encrypted direct link",
  "remote.session.viewOnly": "View only",
  "remote.session.frameAlt": "Live remote display from {name}",
  "remote.session.waitingTitle": "Waiting for the first frame",
  "remote.session.waitingBody":
    "Pairing succeeded. The Agent is capturing and encoding its primary display.",
  "remote.host.title": "Share this device",
  "remote.host.action": "Share this device",
  "remote.host.activeAction": "Sharing active",
  "remote.host.securityTitle": "You choose when sharing starts",
  "remote.host.securityBody":
    "The complete primary display is captured only after you press Start and is sent over an end-to-end encrypted direct connection. This version is view-only and requires a one-time code that expires in five minutes.",
  "remote.host.problemTitle": "Sharing status changed",
  "remote.host.state.waiting": "Waiting for pairing",
  "remote.host.state.pairing": "Verifying pairing code",
  "remote.host.state.streaming": "Sending encrypted display",
  "remote.host.peer": "Connection from {peer}",
  "remote.host.waiting": "No viewer is connected yet",
  "remote.host.address": "Connection address",
  "remote.host.code": "One-time pairing code",
  "remote.host.copyAddress": "Copy connection address",
  "remote.host.copyCode": "Copy pairing code",
  "remote.host.copied": "Copied to clipboard",
  "remote.host.expires": "Pairing code expires in {time}",
  "remote.host.attempts": "Attempts remaining: {count}",
  "remote.host.bindAddress": "Interface IP to share",
  "remote.host.bindHint":
    "Use 127.0.0.1 for local testing. For LAN sharing, enter this device's specific LAN IP; 0.0.0.0 is refused.",
  "remote.host.port": "Port",
  "remote.host.frameRate": "Display rate: {fps} FPS",
  "remote.host.start": "Start sharing",
  "remote.host.starting": "Starting…",
  "remote.host.stop": "Stop sharing",
  "remote.host.stopping": "Stopping…",
  "remote.host.keepRunning": "Keep sharing in background",

  // Web RDP ----------------------------------------------------------------
  "rdp.connect.title": "RDP connect to {name}",
  "rdp.connect.securityTitle": "Native RDP with strict TLS verification",
  "rdp.connect.securityBody":
    "The password is sent only to the isolated local RDP engine over stdin. It is never saved or placed in process arguments. Invalid certificates are rejected by default.",
  "rdp.connect.password": "Windows password",
  "rdp.connect.domain": "Domain (optional)",
  "rdp.connect.domainPlaceholder": "For example, CONTOSO",
  "rdp.connect.noUsername": "This RDP profile has no Windows username.",
  "rdp.connect.submit": "Open Web RDP",
  "rdp.connect.connecting": "Verifying and connecting…",
  "rdp.connect.failedTitle": "Web RDP could not connect",
  "rdp.connect.failedBody": "Stage: {stage}. {detail}",
  "rdp.connect.certificateTitle": "The RDP host certificate is not system-trusted",
  "rdp.connect.certificateBody":
    "Compare this SHA-256 fingerprint over another trusted channel. Approval applies only to this connection attempt.",
  "rdp.connect.trustOnce": "Trust this fingerprint and retry",
  "rdp.session.secure": "TLS / NLA encrypted",
  "rdp.session.interactive": "Interactive",
  "rdp.session.canvasLabel": "Interactive RDP display for {host}",
  "rdp.session.waitingTitle": "Waiting for the RDP display",
  "rdp.session.waitingBody": "Login is established; the remote desktop is preparing its first Canvas frame.",

  // Remote Canvas capture -------------------------------------------------
  "capture.controlsLabel": "Screenshot and recording controls",
  "capture.screenshot": "Screenshot",
  "capture.start": "Start recording",
  "capture.stop": "Stop and download",
  "capture.localOnly":
    "Only the remote Canvas is captured. The file is downloaded on this device and is never uploaded. Long recordings use more memory.",
  "capture.unsupported": "This system WebView does not support Canvas recording.",
  "capture.screenshotFailed": "A screenshot could not be created from the current frame.",
  "capture.recordingFailed":
    "The recording could not be completed. Check the system media encoder support.",

  // Key Vault -------------------------------------------------------------
  "vault.title": "Host trust and credential vault",
  "vault.status.ready": "Host trust active",
  "vault.status.loading": "Loading",
  "vault.status.browser": "Desktop required",
  "vault.status.error": "Unavailable",
  "vault.summary.ready":
    "{count} public host fingerprints loaded from the local security boundary. Passwords are isolated in the operating system credential store.",
  "vault.summary.loading": "Reading real host-trust data from the desktop core.",
  "vault.summary.browser":
    "The browser preview has no desktop security store, so it does not display or invent trust data.",
  "vault.summary.error":
    "Trust data could not be read safely. SSH connections remain blocked as well.",
  "vault.tabs.label": "Key Vault sections",
  "vault.tabs.hosts": "Trusted hosts ({count})",
  "vault.tabs.credentials": "Credentials ({count})",
  "vault.searchPlaceholder": "Search hosts, algorithms or fingerprints",
  "vault.add": "Add host fingerprint",
  "vault.loading.title": "Loading trusted hosts",
  "vault.loading.body": "Entries come directly from the desktop core, never sample fingerprints.",
  "vault.browser.title": "Manage host trust in the LatticeTerm desktop app",
  "vault.browser.body":
    "The browser preview has no Tauri backend and no known_hosts.json. This area stays empty so demonstration data cannot be mistaken for a real trust decision.",
  "vault.loadError.title": "Trusted hosts could not be read",
  "vault.loadError.body":
    "The app will not replace broken trust data with an empty list, because that could make a known host look new. Reason: {error}",
  "vault.retry": "Try again",
  "vault.empty.title": "No hosts have been trusted yet",
  "vault.empty.body":
    "Compare and remember a fingerprint on first SSH connection, or add one here after verifying it through another channel.",
  "vault.noResults.title": "No trusted host matches",
  "vault.noResults.body": "The trust data is still here; nothing matches the current search.",
  "vault.table.target": "Host and port",
  "vault.table.algorithm": "Algorithm",
  "vault.table.fingerprint": "SHA-256 fingerprint",
  "vault.table.trustedAt": "First trusted",
  "vault.table.actions": "Actions",
  "vault.copy": "Copy fingerprint",
  "vault.copyFor": "Copy the fingerprint for {target}",
  "vault.remove": "Remove trust",
  "vault.removeFor": "Remove trusted-host data for {target}",
  "vault.add.title": "Add a trusted host fingerprint",
  "vault.add.securityTitle": "Verify it through another trusted channel first",
  "vault.add.securityBody":
    "Save this only after confirming the fingerprint with the host administrator, the host console, or ssh-keygen output.",
  "vault.form.host": "Host address",
  "vault.form.hostPlaceholder": "e.g. server.example.com",
  "vault.form.port": "Port",
  "vault.form.algorithm": "Key algorithm",
  "vault.form.recommended": "Recommended",
  "vault.form.fingerprint": "SHA-256 fingerprint",
  "vault.form.fingerprintHint":
    "Enter the complete OpenSSH SHA256: fingerprint, not public- or private-key material.",
  "vault.validation.title": "The entry cannot be saved",
  "vault.validation.hostRequired": "Enter a hostname or IP address.",
  "vault.validation.hostInvalid":
    "Use only a hostname or IP address, without ssh://, an account, a path, or spaces.",
  "vault.validation.portInvalid": "Port must be an integer from 1 to 65535.",
  "vault.validation.fingerprintInvalid":
    "Fingerprint must use the complete OpenSSH SHA256: format.",
  "vault.validation.duplicate":
    "{target} already has trusted-host data. If its key really changed, remove the old entry before adding the new one.",
  "vault.save": "Save host trust",
  "vault.saving": "Saving…",
  "vault.remove.title": "Remove trust for {target}?",
  "vault.remove.body":
    "This does not end an open session, but the next connection will require a fresh fingerprint comparison.",
  "vault.remove.confirm": "Remove host trust",
  "vault.removing": "Removing…",
  "vault.actionFailed.title": "Security data was not changed",
  "vault.actionFailed.body": "The desktop core refused the operation: {error}",
  "vault.activity.added": "Trusted host added for {target}",
  "vault.activity.removed": "Trusted host removed for {target}",
  "vault.credentials.title": "System credential storage is active",
  "vault.credentials.body":
    "This tab lists which connections have a securely stored password without reading or displaying the password. SSH private keys and a Stronghold vault remain future work.",
  "vault.credentials.loading.title": "Reading the system credential store",
  "vault.credentials.loading.body":
    "Only connection-to-entry associations are checked; passwords are never loaded into the view.",
  "vault.credentials.ready.title": "{provider} connected",
  "vault.credentials.ready.body":
    "Only the Rust connection core can request a saved password when needed; the WebView never receives its plaintext.",
  "vault.credentials.empty.title": "No passwords have been saved",
  "vault.credentials.empty.body":
    "Choose save when opening an SSH or RDP connection. The password is written only after authentication succeeds.",
  "vault.credentials.table.connection": "Connection",
  "vault.credentials.table.protocol": "Protocol",
  "vault.credentials.table.target": "Target",
  "vault.credentials.removeFor": "Delete the saved password for {name}",
  "vault.credentials.remove.title": "Delete the saved password for {name}?",
  "vault.credentials.remove.body":
    "This does not affect the current session. You must enter the password again next time you connect to {target}.",
  "vault.credentials.activity.removed": "Secure credential removed for {name}",
  "vault.credentials.systemStore": "Operating-system credential store",
  "vault.credentials.systemStoreDetail":
    "Wrap the master key with Windows Credential Manager, macOS Keychain, or Linux Secret Service.",
  "vault.credentials.stronghold": "Stronghold encrypted vault",
  "vault.credentials.strongholdDetail":
    "Store SSH private keys, passwords, and passphrases while the UI sees opaque references only.",
  "vault.credentials.autoLock": "Auto-lock and idle protection",
  "vault.credentials.autoLockDetail":
    "Seal decrypted state when the app loses focus or times out, with an explicit recovery path.",

  // Host trust dialogs ----------------------------------------------------
  "security.verify.title": "Check the host fingerprint",
  "security.verify.body":
    "The identity of {target} cannot be confirmed automatically. Compare the fingerprint below with the one on the host before you continue.",
  "security.algorithm": "Key algorithm",
  "security.fingerprint": "Fingerprint",
  "security.trustOnce": "Trust once",
  "security.trustAndSave": "Trust and remember",
  "security.verifyHint": "Run ssh-keygen -lf on the host to see its fingerprint.",
  "security.changed.title": "This host's identity has changed",
  "security.changed.body":
    "The key this host offered is different from the one you trusted before. It may have been rebuilt or re-keyed — or the connection may be intercepted. Do not continue until you know which.",
  "security.changed.expected": "What you trusted before",
  "security.changed.received": "What arrived this time",
  "security.changed.abort": "Stop connecting",
  "security.changed.override": "I have verified it — update the trusted key",
  "security.changed.overrideConfirm": "Replace the trusted key?",
  "security.changed.checklist":
    "Ask whoever runs the host whether the key really changed.",

  // Import and export -----------------------------------------------------
  "transfer.import.success": "Import complete",
  "transfer.import.successBody": "{count} connections were imported.",
  "transfer.import.partial": "Imported, with some entries skipped",
  "transfer.import.partialBody": "{errors} ({skipped} invalid entries skipped)",
  "transfer.import.failed": "Import failed",
  "transfer.import.failedBody": "No usable connections were found in the file.",
  "transfer.export.hint":
    "The exported file contains host details only, never secrets.",
  "transfer.error.json": "The file is not valid JSON.",
  "transfer.error.notObject": "Imported data must be a JSON object.",
  "transfer.error.noProfiles": "No array of connections was found in the data.",
  "transfer.error.foreignApp": "This file came from another application ({app}).",
  "transfer.error.notObjectItem": "Entry {index}: not an object.",
  "transfer.error.unknownProtocol":
    "Entry {index} ({name}): unsupported protocol “{protocol}”.",
  "transfer.error.invalidEntry": "Entry {index} ({name}): {reasons}",
  "transfer.unnamed": "unnamed",

  // Protocols and environments --------------------------------------------
  "protocol.ssh": "SSH terminal",
  "protocol.ssh.summary": "Text-based remote access",
  "protocol.sftp": "SFTP transfer",
  "protocol.sftp.summary": "Browse and move files",
  "protocol.rdp": "RDP remote desktop",
  "protocol.rdp.summary": "Windows graphical desktop",
  "protocol.vnc": "VNC screen sharing",
  "protocol.vnc.summary": "Cross-platform screen control",
  "protocol.lattice": "Lattice Remote",
  "protocol.lattice.summary": "Encrypted display sharing with one-time pairing",
  "environment.production": "Production",
  "environment.staging": "Staging",
  "environment.development": "Development",
  "environment.unassigned": "Unassigned",
  "environment.production.hint": "Systems serving real users",
  "environment.staging.hint": "Systems used to verify releases",
  "environment.development.hint": "Systems used to build and experiment",
  "environment.unassigned.hint": "No environment set",

  // Accessibility ---------------------------------------------------------
  "a11y.primaryNav": "Primary",
  "a11y.toggleSidebar.show": "Show sidebar",
  "a11y.toggleSidebar.hide": "Hide sidebar",
  "a11y.switchTheme": "Switch theme",
  "a11y.searchConnections": "Search connections",
};
