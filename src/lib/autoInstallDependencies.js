/**
 * Código Mobile / Acode Developer Edition
 * ----------------------------------------
 * Auto npm install: when a folder containing a package.json is opened (and
 * becomes the active project), open a terminal and run `npm install`
 * automatically, so dependencies are there without the user having to type
 * the command themselves. Mirrors the honesty rules the rest of Developer
 * Edition follows - this only runs real commands against a real,
 * terminal-accessible project; it never fakes success or guesses a path.
 *
 * Off switch: Settings → Developer Edition →
 * "Install npm dependencies automatically" (on by default).
 */
import toast from "components/toast";
import fsOperation from "fileSystem";
import appSettings from "lib/settings";
import Url from "utils/Url";
import projectContext from "./projectContext";

/** @type {Set<string>} folder urls already handled this session */
const handledThisSession = new Set();

function text(key, fallback) {
	return strings?.[key] || fallback;
}

/**
 * @param {{url: string, name: string}} folder
 */
export default async function maybeAutoInstallDependencies(folder) {
	try {
		if (!folder?.url) return;
		if (appSettings.value.developerEdition?.autoInstallDependencies === false) {
			return;
		}
		if (handledThisSession.has(folder.url)) return;

		const packageJsonUrl = Url.join(folder.url, "package.json");
		const nodeModulesUrl = Url.join(folder.url, "node_modules");

		const hasPackageJson = await fsOperation(packageJsonUrl)
			.exists()
			.catch(() => false);
		if (!hasPackageJson) return;

		handledThisSession.add(folder.url);

		const hasNodeModules = await fsOperation(nodeModulesUrl)
			.exists()
			.catch(() => false);
		if (hasNodeModules) return;

		if (typeof Terminal === "undefined" || typeof Executor === "undefined") {
			return;
		}
		const alpineInstalled = await Terminal.isInstalled().catch(() => false);
		if (!alpineInstalled) return;

		// Only the active project's accessibility is resolvable right now
		// (see lib/projectContext.js); this hook always runs for whatever
		// folder was just set as active, so that's exactly this folder.
		const { accessible } = projectContext.getTerminalAccessibility();
		if (!accessible) return;

		const { TerminalManager } = await import(
			/* webpackChunkName: "terminal" */ "components/terminal"
		);
		const terminal = await TerminalManager.createTerminal({
			name: text("install dependencies", "Instalar dependências"),
			render: true,
		});
		if (!terminal?.component) return;

		await new Promise((resolve, reject) => {
			const start = Date.now();
			const check = () => {
				if (terminal.component.isConnected) return resolve();
				if (Date.now() - start > 8000) {
					return reject(new Error("Terminal connection timeout"));
				}
				setTimeout(check, 50);
			};
			check();
		});

		toast(
			text(
				"installing dependencies",
				"Instalando dependências do projeto (npm install)…",
			),
		);
		// createTerminal already cd'd into the active project. `command -v
		// npm` first, since a fresh Alpine sandbox doesn't ship npm
		// pre-installed (see apk add npm in docs) - installs it once,
		// silently, only when missing.
		terminal.component.write(
			"command -v npm >/dev/null 2>&1 || apk add --no-interactive npm; npm install\n",
		);
	} catch (error) {
		// Best-effort convenience feature - never block opening the folder.
		console.warn("autoInstallDependencies: failed", error);
	}
}
