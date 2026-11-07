/**
 * Shared helpers for translating between Acode's own file URLs (file://, SAF
 * content:// trees, etc.) and the paths visible *inside* the Alpine/PRoot
 * terminal sandbox (components/terminal, see src/plugins/terminal).
 *
 * This module exists so that every part of the app that needs to reason
 * about "is this path visible to the terminal, and under what name" shares a
 * single implementation instead of re-deriving it (lib/openFolder.js,
 * lib/projectContext.js and components/terminal/terminalManager.js all use
 * it). The conversion rules here mirror exactly what
 * src/plugins/terminal/scripts/init-sandbox.sh binds into the PRoot
 * environment:
 *   - $PREFIX/public  is bound to /public, /home and /root
 *   - everything else under the app's Alpine rootfs keeps its relative path
 *
 * IMPORTANT: a SAF tree URI (content://...) that does NOT come from the
 * terminal's own public document provider (`isAcodeTerminalPublicSafUri`) or
 * from Termux's provider (`isTermuxSafUri`) is NOT guaranteed to resolve to a
 * real POSIX path PRoot can bind. For those cases this module reports the
 * project as not terminal-accessible rather than inventing a fake path - see
 * `getTerminalAccessibility()`.
 */

import Path from "utils/Path";
import Uri from "utils/Uri";

/**
 * @param {string} value
 */
export const isTermuxSafUri = (value = "") =>
	value.startsWith("content://com.termux.documents/tree/");

/**
 * @param {string} value
 */
export const isAcodeTerminalPublicSafUri = (value = "") =>
	value.startsWith("content://com.codigomobile.editor.documents/tree/");

/**
 * @param {string} value
 */
export const isTerminalSafUri = (value = "") =>
	isTermuxSafUri(value) || isAcodeTerminalPublicSafUri(value);

/**
 * Resolve the Android data-directory paths the terminal sandbox is rooted
 * under for the package currently running (paid/free/fdroid all share this
 * layout; only the package id changes).
 * @returns {{alpineRoot: string, publicDir: string, dataDir: string}}
 */
export function getTerminalPaths() {
	const packageName =
		(typeof window !== "undefined" && window.BuildInfo?.packageName) ||
		"com.codigomobile.editor";
	const dataDir = `/data/user/0/${packageName}`;
	const alpineRoot = `${dataDir}/files/alpine`;
	const publicDir = `${dataDir}/files/public`;
	return { alpineRoot, publicDir, dataDir };
}

/**
 * Whether a given Acode file/folder URL lives somewhere the Alpine terminal
 * can already reach directly (no bridging needed).
 * @param {string} url
 * @returns {boolean}
 */
export function isTerminalAccessiblePath(url = "") {
	if (isAcodeTerminalPublicSafUri(url)) return true;
	const { alpineRoot, publicDir } = getTerminalPaths();
	const cleanUrl = url.replace(/^file:\/\//, "");
	if (cleanUrl.startsWith(alpineRoot) || cleanUrl.startsWith(publicDir)) {
		return true;
	}
	return false;
}

/**
 * Convert an Acode file/folder URL into the path the terminal would see for
 * it *inside* the PRoot sandbox. Only call this after confirming
 * `isTerminalAccessiblePath()` (or getting "safUnresolvable: false" from
 * `getTerminalAccessibility`) - for anything else this intentionally returns
 * `null` instead of guessing a POSIX path for a URI PRoot cannot bind.
 * @param {string} url
 * @returns {string|null}
 */
export function convertToProotPath(url = "") {
	const { alpineRoot, publicDir } = getTerminalPaths();

	if (isAcodeTerminalPublicSafUri(url)) {
		try {
			// Uri is a global utility already used throughout the app
			// (utils/Uri.js) for parsing content:// tree/document URIs.
			const { docId } = Uri.parse(url);
			const cleanDocId = /::/.test(url)
				? decodeURIComponent(docId || "")
				: docId || "";
			if (!cleanDocId) return "/public";
			if (cleanDocId.startsWith(publicDir)) {
				return cleanDocId.replace(publicDir, "/public") || "/public";
			}
			if (cleanDocId.startsWith("/public")) {
				return cleanDocId;
			}
			if (cleanDocId.startsWith("public:")) {
				const relativePath = cleanDocId.slice("public:".length);
				return relativePath ? Path.join("/public", relativePath) : "/public";
			}
			const relativePath = cleanDocId
				.replace(/^\/+/, "")
				.replace(/^public\//, "");
			return relativePath ? Path.join("/public", relativePath) : "/public";
		} catch (error) {
			console.warn(
				`Failed to parse public SAF URI for terminal conversion: ${url}`,
			);
			return "/public";
		}
	}

	const cleanUrl = url.replace(/^file:\/\//, "");
	if (cleanUrl.startsWith(publicDir)) {
		return cleanUrl.replace(publicDir, "/public");
	}
	if (cleanUrl.startsWith(alpineRoot)) {
		return cleanUrl.replace(alpineRoot, "") || "/";
	}

	// Not a path PRoot understands - caller must have already checked
	// accessibility. Returning the raw (wrong) value would let a caller
	// silently `cd` the terminal into a path that does not exist inside the
	// sandbox, which is exactly the "pretend a SAF URI is a POSIX path"
	// behaviour we must not do.
	console.warn(`Unrecognized path for terminal conversion: ${url}`);
	return null;
}

/**
 * Full accessibility verdict for a project root url, used by project
 * context / AI agent integration to decide whether they can safely give the
 * terminal (and therefore any coding agent run inside it) a real path, or
 * whether they must tell the user a bridge is required instead.
 * @param {string} url
 * @returns {{
 *   accessible: boolean,
 *   prootPath: string|null,
 *   reason: "ok"|"unbridged-saf"|"unknown-scheme"
 * }}
 */
export function getTerminalAccessibility(url = "") {
	if (!url)
		return { accessible: false, prootPath: null, reason: "unknown-scheme" };

	if (isTerminalAccessiblePath(url)) {
		const prootPath = convertToProotPath(url);
		return prootPath
			? { accessible: true, prootPath, reason: "ok" }
			: { accessible: false, prootPath: null, reason: "unknown-scheme" };
	}

	if (/^content:\/\//.test(url)) {
		// A SAF tree that is neither the terminal's own public provider nor
		// Termux's: we cannot assume PRoot can bind it. This is the "ponte
		// segura e documentada" case called out in the project brief - until
		// that bridge exists, report it honestly instead of faking a path.
		return { accessible: false, prootPath: null, reason: "unbridged-saf" };
	}

	return { accessible: false, prootPath: null, reason: "unknown-scheme" };
}
