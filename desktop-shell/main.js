// Kutkap macOS app: starts the local editor and media service, then shows the
// editor in a native window with its own Dock icon and menu bar.
const { app, BrowserWindow, Menu, dialog, session, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const WEB_PORT = 3517;
const SERVICE_PORT = 3518;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const SERVICE_URL = `http://localhost:${SERVICE_PORT}`;
const SUPPORT_DIR = path.join(os.homedir(), "Library", "Application Support", "Kutkap");
const WEB_DIR = path.join(SUPPORT_DIR, "web", "apps", "web");
const SERVICE_DIR = path.join(SUPPORT_DIR, "reel-templates");
const LOG_FILE = path.join(os.homedir(), "Library", "Logs", "Kutkap.log");
const STARTUP_TIMEOUT_MS = 90_000;

// Apps opened from Finder get a minimal PATH; ffmpeg, node and tesseract live in Homebrew.
const ENV = {
	...process.env,
	PATH: ["/opt/homebrew/bin", "/usr/local/bin", process.env.PATH].join(":"),
};

/** Servers this app started, so they stop when Kutkap quits. */
const children = [];
let mainWindow = null;

app.setName("Kutkap");
// Projects and media saved by the editor (IndexedDB + OPFS) live here, apart from the app's own files.
app.setPath("userData", path.join(SUPPORT_DIR, "App Data"));

if (!app.requestSingleInstanceLock()) {
	app.quit();
}

function isUp(url) {
	return new Promise((resolve) => {
		const request = http.get(url, { timeout: 1000 }, (response) => {
			response.resume();
			resolve(response.statusCode < 500);
		});
		request.on("error", () => resolve(false));
		request.on("timeout", () => {
			request.destroy();
			resolve(false);
		});
	});
}

async function waitUntilUp(url) {
	const deadline = Date.now() + STARTUP_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (await isUp(url)) return true;
		await new Promise((resolve) => setTimeout(resolve, 400));
	}
	return false;
}

/** Reads KEY=VALUE lines (the editor's .env.local); tolerates CRLF and quotes. */
function readEnvFile(file) {
	if (!fs.existsSync(file)) return {};
	const env = {};
	for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith("#") || !line.includes("=")) continue;
		const index = line.indexOf("=");
		const key = line.slice(0, index).trim();
		env[key] = line.slice(index + 1).trim().replace(/^"(.*)"$/, "$1");
	}
	return env;
}

function startServer({ command, args, cwd, env }) {
	const log = fs.openSync(LOG_FILE, "a");
	// A process group of its own, so quitting also stops anything it spawns.
	const child = spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", log, log] });
	children.push(child);
	return child;
}

function stopServers() {
	for (const child of children) {
		try {
			process.kill(-child.pid, "SIGTERM");
		} catch {
			// Already stopped.
		}
	}
	children.length = 0;
}

async function startServices() {
	const missing = [];
	if (!fs.existsSync(path.join(WEB_DIR, "server.js"))) missing.push("the editor");
	if (!fs.existsSync(path.join(SERVICE_DIR, ".venv", "bin", "uvicorn"))) missing.push("the media service");
	if (missing.length > 0) {
		throw new Error(`Kutkap isn't fully installed (missing ${missing.join(" and ")}). Run scripts/mac/install-app.sh from the Kutkap repo.`);
	}

	if (!(await isUp(`${SERVICE_URL}/api/health`))) {
		startServer({
			command: path.join(SERVICE_DIR, ".venv", "bin", "uvicorn"),
			args: ["reel_templates.main:app", "--host", "127.0.0.1", "--port", String(SERVICE_PORT)],
			cwd: path.join(SERVICE_DIR, "app"),
			env: ENV,
		});
	}
	if (!(await isUp(`${WEB_URL}/projects`))) {
		startServer({
			command: "node",
			args: ["server.js"],
			cwd: WEB_DIR,
			env: {
				...ENV,
				...readEnvFile(path.join(WEB_DIR, ".env.local")),
				NODE_ENV: "production",
				PORT: String(WEB_PORT),
				HOSTNAME: "127.0.0.1",
			},
		});
	}

	const [webReady] = await Promise.all([
		waitUntilUp(`${WEB_URL}/projects`),
		waitUntilUp(`${SERVICE_URL}/api/health`),
	]);
	if (!webReady) {
		throw new Error(`The editor didn't start. Details are in ${LOG_FILE}.`);
	}
}

function isLocalUrl(url) {
	try {
		const { hostname, port } = new URL(url);
		return ["localhost", "127.0.0.1"].includes(hostname) && [String(WEB_PORT), String(SERVICE_PORT)].includes(port);
	} catch {
		return false;
	}
}

function configureWindow(window) {
	// Kutkap pages (e.g. Reel Templates) open in their own window; everything else in the browser.
	window.webContents.setWindowOpenHandler(({ url }) => {
		if (isLocalUrl(url)) {
			return {
				action: "allow",
				overrideBrowserWindowOptions: {
					width: 1180,
					height: 820,
					backgroundColor: "#0f0f13",
					webPreferences: { preload: path.join(__dirname, "preload.js") },
				},
			};
		}
		void shell.openExternal(url);
		return { action: "deny" };
	});
	window.webContents.on("will-navigate", (event, url) => {
		if (!isLocalUrl(url)) {
			event.preventDefault();
			void shell.openExternal(url);
		}
	});
	window.webContents.on("did-create-window", configureWindow);
}

function createSplash() {
	const splash = new BrowserWindow({
		width: 360,
		height: 260,
		frame: false,
		resizable: false,
		movable: true,
		backgroundColor: "#121218",
		show: false,
	});
	splash.loadFile(path.join(__dirname, "splash.html"));
	splash.once("ready-to-show", () => splash.show());
	return splash;
}

function createMainWindow() {
	mainWindow = new BrowserWindow({
		width: 1480,
		height: 920,
		minWidth: 1100,
		minHeight: 700,
		title: "Kutkap",
		titleBarStyle: "hiddenInset",
		trafficLightPosition: { x: 18, y: 19 },
		backgroundColor: "#111111",
		show: false,
		webPreferences: { preload: path.join(__dirname, "preload.js") },
	});
	configureWindow(mainWindow);
	mainWindow.loadURL(`${WEB_URL}/projects`);
	mainWindow.on("closed", () => {
		mainWindow = null;
	});
	return mainWindow;
}

function buildMenu() {
	Menu.setApplicationMenu(
		Menu.buildFromTemplate([
			{ role: "appMenu" },
			{
				label: "File",
				submenu: [
					{
						label: "All Projects",
						accelerator: "CmdOrCtrl+Shift+P",
						click: () => mainWindow?.loadURL(`${WEB_URL}/projects`),
					},
					{
						label: "Reel Templates",
						accelerator: "CmdOrCtrl+Shift+R",
						click: () => mainWindow?.webContents.executeJavaScript(`window.open(${JSON.stringify(SERVICE_URL)})`),
					},
					{ type: "separator" },
					{ role: "close" },
				],
			},
			{ role: "editMenu" },
			{
				label: "View",
				submenu: [{ role: "reload" }, { role: "togglefullscreen" }, { type: "separator" }, { role: "toggleDevTools" }],
			},
			{ role: "windowMenu" },
		]),
	);
}

app.on("second-instance", () => {
	if (!mainWindow) return;
	if (mainWindow.isMinimized()) mainWindow.restore();
	mainWindow.focus();
});

app.whenReady().then(async () => {
	buildMenu();
	session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
		callback(["clipboard-read", "clipboard-sanitized-write", "fullscreen"].includes(permission));
	});

	const splash = createSplash();
	try {
		await startServices();
	} catch (error) {
		splash.destroy();
		await dialog.showMessageBox({ type: "error", message: "Kutkap couldn't start", detail: error.message });
		app.quit();
		return;
	}

	const window = createMainWindow();
	window.once("ready-to-show", () => {
		splash.destroy();
		window.show();
	});
});

app.on("activate", () => {
	if (!mainWindow && app.isReady()) createMainWindow().once("ready-to-show", () => mainWindow?.show());
});

app.on("window-all-closed", () => app.quit());
app.on("will-quit", stopServers);
process.on("exit", stopServers);
