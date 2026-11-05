import { describe, expect, it, beforeEach } from "vitest";
import {
	convertToProotPath,
	getTerminalAccessibility,
	isTerminalAccessiblePath,
	isTerminalSafUri,
} from "utils/terminalPath";

beforeEach(() => {
	delete window.BuildInfo;
});

const DATA_DIR = "/data/user/0/com.foxdebug.acode";

describe("terminalPath", () => {
	it("recognizes paths under the app's alpine root and public dir as accessible", () => {
		expect(
			isTerminalAccessiblePath(`file://${DATA_DIR}/files/alpine/root/foo`),
		).toBe(true);
		expect(
			isTerminalAccessiblePath(`file://${DATA_DIR}/files/public/my-project`),
		).toBe(true);
		expect(isTerminalAccessiblePath(`file:///storage/emulated/0/Download`)).toBe(
			false,
		);
	});

	it("converts a public-dir file:// url into its /public proot path", () => {
		expect(
			convertToProotPath(`file://${DATA_DIR}/files/public/my-project/src`),
		).toBe("/public/my-project/src");
	});

	it("converts an alpine-root file:// url into its rootfs-relative proot path", () => {
		expect(
			convertToProotPath(`file://${DATA_DIR}/files/alpine/root/foo`),
		).toBe("/root/foo");
	});

	it("returns null instead of guessing a path it does not recognize", () => {
		expect(convertToProotPath("file:///storage/emulated/0/Download")).toBeNull();
	});

	it("getTerminalAccessibility flags an unbridged SAF tree instead of faking a path", () => {
		const result = getTerminalAccessibility(
			"content://com.android.externalstorage.documents/tree/primary%3ADownload",
		);
		expect(result).toEqual({
			accessible: false,
			prootPath: null,
			reason: "unbridged-saf",
		});
	});

	it("getTerminalAccessibility resolves an accessible path with reason ok", () => {
		const result = getTerminalAccessibility(
			`file://${DATA_DIR}/files/public/my-project`,
		);
		expect(result).toEqual({
			accessible: true,
			prootPath: "/public/my-project",
			reason: "ok",
		});
	});

	it("getTerminalAccessibility reports an empty url as unknown-scheme", () => {
		expect(getTerminalAccessibility("")).toEqual({
			accessible: false,
			prootPath: null,
			reason: "unknown-scheme",
		});
	});

	it("recognizes Termux and Acode terminal SAF uris", () => {
		expect(
			isTerminalSafUri("content://com.termux.documents/tree/primary%3Ahome"),
		).toBe(true);
		expect(
			isTerminalSafUri(
				"content://com.foxdebug.acode.documents/tree/public%3Amy-project",
			),
		).toBe(true);
		expect(
			isTerminalSafUri(
				"content://com.android.externalstorage.documents/tree/primary%3ADownload",
			),
		).toBe(false);
	});
});
