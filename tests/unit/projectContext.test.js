// @vitest-environment happy-dom
//
// Unit tests for the Developer Edition "ACODE_PROJECT_ROOT" context
// (lib/projectContext.js). These only cover the pure state-management and
// path-resolution logic; the terminal auto-cd behaviour that consumes this
// module (components/terminal/terminalManager.js) runs against the real
// Cordova Executor/Terminal plugins and is NOT exercised here - it is listed
// as "manual/on-device only" in docs/DEVELOPER_EDITION.md.

import { beforeEach, describe, expect, it } from "vitest";

beforeEach(() => {
	localStorage.clear();
	delete window.BuildInfo;
});

async function freshModule() {
	const { default: projectContext } = await import("lib/projectContext");
	return projectContext;
}

describe("projectContext", () => {
	it("reports no active project before anything is opened", async () => {
		const projectContext = await freshModule();
		expect(projectContext.getActiveProject()).toBeNull();
		expect(projectContext.getTerminalAccessibility()).toEqual({
			project: null,
			accessible: false,
			prootPath: null,
			reason: "no-project",
		});
	});

	it("sets, persists and restores the active project", async () => {
		const projectContext = await freshModule();
		projectContext.setActiveProject({
			url: "file:///data/user/0/com.foxdebug.acode/files/public/my-app",
			name: "my-app",
		});

		expect(projectContext.getActiveProject()).toEqual({
			url: "file:///data/user/0/com.foxdebug.acode/files/public/my-app",
			name: "my-app",
		});

		// Simulate an app restart: a brand new module instance should read
		// the same project back from localStorage ("preservar o contexto
		// entre sessões, quando possível").
		const reloaded = await freshModule();
		expect(reloaded.getActiveProject()).toEqual({
			url: "file:///data/user/0/com.foxdebug.acode/files/public/my-app",
			name: "my-app",
		});
	});

	it("switches the active project when a different folder is opened", async () => {
		const projectContext = await freshModule();
		projectContext.setActiveProject({ url: "file:///a", name: "a" });
		projectContext.setActiveProject({ url: "file:///b", name: "b" });
		expect(projectContext.getActiveProject().url).toBe("file:///b");
	});

	it("clears the active project only when the closed folder was the active one", async () => {
		const projectContext = await freshModule();
		projectContext.setActiveProject({ url: "file:///a", name: "a" });

		projectContext.clearIfActive("file:///not-the-active-one");
		expect(projectContext.getActiveProject()?.url).toBe("file:///a");

		projectContext.clearIfActive("file:///a");
		expect(projectContext.getActiveProject()).toBeNull();
	});

	it("notifies subscribers on change and stops after unsubscribing", async () => {
		const projectContext = await freshModule();
		const seen = [];
		const unsubscribe = projectContext.onChange((project) => seen.push(project));

		projectContext.setActiveProject({ url: "file:///a", name: "a" });
		unsubscribe();
		projectContext.setActiveProject({ url: "file:///b", name: "b" });

		expect(seen).toHaveLength(1);
		expect(seen[0].url).toBe("file:///a");
	});

	it("requireOpen filters out a project the registered checker says is closed", async () => {
		const projectContext = await freshModule();
		projectContext.setActiveProject({ url: "file:///a", name: "a" });
		projectContext.registerOpenChecker((url) => url === "file:///still-open");

		expect(projectContext.getActiveProject({ requireOpen: true })).toBeNull();
		expect(projectContext.getActiveProject({ requireOpen: false })).not.toBeNull();
	});

	it("resolves terminal accessibility for a path inside the app's public dir", async () => {
		const projectContext = await freshModule();
		projectContext.setActiveProject({
			url: "file:///data/user/0/com.foxdebug.acode/files/public/my-app",
			name: "my-app",
		});

		expect(projectContext.getTerminalAccessibility()).toEqual({
			project: {
				url: "file:///data/user/0/com.foxdebug.acode/files/public/my-app",
				name: "my-app",
			},
			accessible: true,
			prootPath: "/public/my-app",
			reason: "ok",
		});
	});

	it("reports an unbridged SAF project honestly instead of inventing a path", async () => {
		const projectContext = await freshModule();
		projectContext.setActiveProject({
			url: "content://com.android.externalstorage.documents/tree/primary%3ASomeFolder",
			name: "SomeFolder",
		});

		const result = projectContext.getTerminalAccessibility();
		expect(result.accessible).toBe(false);
		expect(result.prootPath).toBeNull();
		expect(result.reason).toBe("unbridged-saf");
	});
});
