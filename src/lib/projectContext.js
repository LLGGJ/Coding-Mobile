/**
 * Project Context (Developer Edition)
 * ------------------------------------
 * Central place that tracks which open folder is the "active project" -
 * the Acode Developer Edition equivalent of an `ACODE_PROJECT_ROOT`
 * environment variable, requested in the project brief.
 *
 * Design notes (see docs/DEVELOPER_EDITION.md for the full write-up):
 *  - Acode's file explorer already supports MULTIPLE open roots at once
 *    (lib/openFolder.js `addedFolder`). There is no single native concept of
 *    "the" open project, so this module layers one on top: the active
 *    project is whichever open root was most recently opened or explicitly
 *    picked by the user ("Set as active project" in the root's context
 *    menu), and it updates automatically when the user opens a new folder or
 *    closes the current one.
 *  - The terminal and the AI Coding Agents panel both read
 *    `projectContext.getActiveProject()` / `getTerminalRoot()` instead of
 *    guessing a path themselves.
 *  - Paths are resolved through utils/terminalPath.js, which only returns a
 *    POSIX path the Alpine/PRoot sandbox can actually bind. A project that
 *    lives on an unbridged SAF tree (e.g. a folder picked via the system
 *    file picker on removable storage) is reported as NOT terminal
 *    accessible instead of being papered over with a fake path - see
 *    `getTerminalAccessibility()` below and `reason` in its result.
 *  - The active project id is persisted to localStorage so it survives
 *    across app restarts "quando possível" (when the same folder is still
 *    open next launch); if it is gone, callers fall back to null and the
 *    app behaves as if nothing is active yet, it is never invented.
 */

import { getTerminalAccessibility } from "utils/terminalPath";

const STORAGE_KEY = "acodeDevEdition:activeProjectRoot";

/** @type {{url: string, name: string}|null} */
let activeProject = null;
let hasRestored = false;
const listeners = new Set();
/**
 * Set by lib/openFolder.js (via `registerOpenChecker`) so this module can
 * verify the persisted/active project is still an open root without
 * creating a circular import between the two modules.
 * @type {((url: string) => boolean)|null}
 */
let isUrlOpen = null;

function readPersisted() {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed.url === "string") return parsed;
		return null;
	} catch (error) {
		console.warn("projectContext: failed to read persisted project", error);
		return null;
	}
}

function writePersisted(project) {
	try {
		if (project) {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
		} else {
			localStorage.removeItem(STORAGE_KEY);
		}
	} catch (error) {
		// localStorage can throw (private mode, quota, etc). The in-memory
		// state still works for the rest of the session.
		console.warn("projectContext: failed to persist active project", error);
	}
}

function notify() {
	for (const listener of listeners) {
		try {
			listener(activeProject);
		} catch (error) {
			console.error("projectContext: listener threw", error);
		}
	}
}

const projectContext = {
	/**
	 * Restore the last active project id from the previous session, if any.
	 * This does NOT verify the folder is still open - callers that need that
	 * guarantee (terminal auto-cd, AI agents panel) should cross-check
	 * against `lib/openFolder`'s `addedFolder`/`find()` before trusting it,
	 * which `getActiveProject({ requireOpen: true })` does for them.
	 * @returns {{url: string, name: string}|null}
	 */
	restore() {
		if (!hasRestored) {
			hasRestored = true;
			activeProject = readPersisted();
		}
		return activeProject;
	},

	/**
	 * @param {{url: string, name: string}|string} folder
	 * @param {{persist?: boolean, silent?: boolean}} [options]
	 */
	setActiveProject(folder, options = {}) {
		const { persist = true, silent = false } = options;
		const next =
			typeof folder === "string"
				? { url: folder, name: folder }
				: folder
					? { url: folder.url, name: folder.name || folder.title || folder.url }
					: null;

		if (!next || !next.url) return;
		if (activeProject?.url === next.url) return;

		activeProject = next;
		if (persist) writePersisted(activeProject);
		if (!silent) notify();
	},

	/**
	 * Clear the active project if it currently points at `url` (called when
	 * a root folder is closed/removed). If other open roots remain, callers
	 * (lib/openFolder) are expected to pick a new one explicitly rather than
	 * have this module guess.
	 * @param {string} url
	 */
	clearIfActive(url) {
		if (activeProject?.url !== url) return;
		activeProject = null;
		writePersisted(null);
		notify();
	},

	/**
	 * @param {{requireOpen?: boolean}} [options]
	 * @returns {{url: string, name: string}|null}
	 */
	getActiveProject(options = {}) {
		this.restore();
		if (!activeProject) return null;

		if (options.requireOpen && isUrlOpen && !isUrlOpen(activeProject.url)) {
			return null;
		}

		return activeProject;
	},

	/**
	 * Called once by lib/openFolder.js so this module can check whether the
	 * active project is still an open root, without importing openFolder
	 * directly (which imports this module).
	 * @param {(url: string) => boolean} checker
	 */
	registerOpenChecker(checker) {
		isUrlOpen = checker;
	},

	/**
	 * Resolve whether the active project can be handed to the terminal /
	 * AI coding agents, and the real sandbox path to use if so.
	 * @returns {{
	 *   project: {url: string, name: string}|null,
	 *   accessible: boolean,
	 *   prootPath: string|null,
	 *   reason: "no-project"|"ok"|"unbridged-saf"|"unknown-scheme"
	 * }}
	 */
	getTerminalAccessibility() {
		const project = this.getActiveProject();
		if (!project) {
			return {
				project: null,
				accessible: false,
				prootPath: null,
				reason: "no-project",
			};
		}
		const result = getTerminalAccessibility(project.url);
		return { project, ...result };
	},

	/**
	 * @param {(project: {url: string, name: string}|null) => void} listener
	 * @returns {() => void} unsubscribe
	 */
	onChange(listener) {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
};

export default projectContext;
