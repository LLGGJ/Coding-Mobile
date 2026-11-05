import settingsPage from "components/settingsPage";
import toast from "components/toast";
import AiCodingAgents from "pages/aiCodingAgents";
import projectContext from "lib/projectContext";
import appSettings from "lib/settings";

const text = (key, fallback) => strings?.[key] || fallback;

/**
 * "Developer Edition" settings section (see brief, item 7): groups the
 * settings that are specific to this fork instead of scattering them
 * through the original settings pages. It does not duplicate anything
 * that already has a home (terminal appearance stays in Terminal
 * settings, LSP stays in Language servers, etc.) - only project-context
 * and AI-agent related toggles live here.
 */
export default function developerEditionSettings() {
	const title = text("developer edition", "Developer Edition");
	const values = appSettings.value;

	if (!values.developerEdition) {
		values.developerEdition = { aiAgents: {}, autoCdToActiveProject: true };
	}
	const devValues = values.developerEdition;
	if (devValues.autoCdToActiveProject === undefined) {
		devValues.autoCdToActiveProject = true;
	}

	const categories = {
		project: text("settings-category-project-context", "Project context"),
		agents: text("settings-category-ai-agents", "AI coding agents"),
	};

	const items = [
		{
			key: "active-project-info",
			text: text("active project", "Active project"),
			value: activeProjectLabel(),
			info: text(
				"info-active-project",
				"The folder treated as ACODE_PROJECT_ROOT: new terminals and AI agents start here. Set a different one from a root folder's context menu (⋮ → Set as active project).",
			),
			category: categories.project,
		},
		{
			key: "autoCdToActiveProject",
			text: text(
				"auto cd to active project",
				"Start terminal in active project",
			),
			checkbox: devValues.autoCdToActiveProject !== false,
			info: text(
				"info-auto-cd-to-active-project",
				"New terminal sessions automatically change into the active project's folder when it is reachable by the terminal.",
			),
			category: categories.project,
		},
		{
			key: "ai-coding-agents",
			text: text("ai coding agents", "AI Coding Agents"),
			info: text(
				"info-ai-coding-agents",
				"Detect Claude Code, Codex CLI and OpenCode, check their status and open them in the active project.",
			),
			category: categories.agents,
			chevron: true,
		},
	];

	const page = settingsPage(title, items, callback, undefined, {
		preserveOrder: true,
		pageClassName: "detail-settings-page",
		listClassName: "detail-settings-list",
		infoAsDescription: true,
		valueInTail: true,
	});

	const unsubscribe = projectContext.onChange(() => {
		page.updateValue?.("active-project-info", activeProjectLabel());
	});
	page.onClose?.(unsubscribe);

	return page;

	function activeProjectLabel() {
		const project = projectContext.getActiveProject();
		return project
			? project.name
			: text("no active project", "None - open a folder first");
	}

	/**
	 * @param {string} key
	 * @param {any} value
	 */
	async function callback(key, value) {
		switch (key) {
			case "ai-coding-agents":
				AiCodingAgents();
				return;

			case "active-project-info":
				// Informational only - nothing to toggle, the control exists so
				// the active project is visible without opening the file
				// explorer.
				return;

			default:
				appSettings.update({
					developerEdition: {
						...values.developerEdition,
						[key]: value,
					},
				});
				if (key === "autoCdToActiveProject" && value === false) {
					toast(
						text(
							"auto cd disabled",
							"New terminals will no longer auto-cd into the active project.",
						),
					);
				}
				break;
		}
	}
}
