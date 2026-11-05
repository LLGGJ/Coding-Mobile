import "./style.scss";
import Page from "components/page";
import toast from "components/toast";
import prompt from "dialogs/prompt";
import actionStack from "lib/actionStack";
import projectContext from "lib/projectContext";
import appSettings from "lib/settings";

const text = (key, fallback) => strings?.[key] || fallback;

/**
 * Agents this panel knows how to detect/launch. Detection is always a real
 * command run inside the Alpine sandbox (`Executor.execute(cmd, true)`) -
 * nothing here is simulated. If the terminal/Alpine environment is not
 * installed, every agent is reported as "unknown", never as installed.
 */
const AGENT_DEFINITIONS = [
	{
		id: "claude-code",
		name: "Claude Code",
		defaultBin: "claude",
		homepage: "https://github.com/anthropics/claude-code",
		notes:
			text(
				"ai-agent-notes-claude-code",
				"Auth runs through Claude Code's own `claude /login` flow inside the terminal - this panel never touches its credentials.",
			),
	},
	{
		id: "codex",
		name: "OpenAI Codex CLI",
		defaultBin: "codex",
		homepage: "https://github.com/openai/codex",
		notes: text(
			"ai-agent-notes-codex",
			"Auth runs through Codex CLI's own login flow inside the terminal.",
		),
	},
	{
		id: "opencode",
		name: "OpenCode CLI",
		defaultBin: "opencode",
		homepage: "https://github.com/sst/opencode",
		notes: text(
			"ai-agent-notes-opencode",
			"Auth runs through OpenCode's own login flow inside the terminal.",
		),
	},
];

const STATUS = {
	UNKNOWN: "unknown", // not checked yet, or could not be checked
	CHECKING: "checking",
	INSTALLED: "installed",
	NOT_INSTALLED: "not-installed",
	ERROR: "error", // detection itself failed (not "not installed")
};

function getDevEditionSettings() {
	const values = appSettings.value;
	if (!values.developerEdition) {
		values.developerEdition = { aiAgents: {}, autoCdToActiveProject: true };
	}
	if (!values.developerEdition.aiAgents) {
		values.developerEdition.aiAgents = {};
	}
	return values.developerEdition;
}

function getCustomBin(agentId) {
	return getDevEditionSettings().aiAgents[agentId]?.bin || null;
}

function saveCustomBin(agentId, bin) {
	const settings = getDevEditionSettings();
	settings.aiAgents[agentId] = { ...(settings.aiAgents[agentId] || {}), bin };
	appSettings.update({ developerEdition: settings }, false);
}

/**
 * @returns {Promise<{terminalReady: boolean, alpineInstalled: boolean, reason?: string}>}
 */
async function getEnvironmentState() {
	if (typeof Terminal === "undefined" || typeof Executor === "undefined") {
		return {
			terminalReady: false,
			alpineInstalled: false,
			reason: text(
				"terminal plugin unavailable",
				"Terminal plugin not available in this build.",
			),
		};
	}

	try {
		const installed = await Terminal.isInstalled();
		return { terminalReady: true, alpineInstalled: !!installed };
	} catch (error) {
		return {
			terminalReady: false,
			alpineInstalled: false,
			reason: error?.message || String(error),
		};
	}
}

/**
 * Runs a real detection command inside Alpine. Never returns a fabricated
 * "installed" result - every field here is either read straight from a
 * command's real stdout or explicitly null/unknown.
 * @param {string} bin
 * @returns {Promise<{status: string, path: string|null, version: string|null, error: string|null}>}
 */
async function detectAgent(bin) {
	try {
		const whichResult = (
			await Executor.execute(`command -v ${bin} 2>/dev/null`, true)
		)?.trim();

		if (!whichResult) {
			return { status: STATUS.NOT_INSTALLED, path: null, version: null, error: null };
		}

		let version = null;
		try {
			const versionOutput = (
				await Executor.execute(`${bin} --version 2>&1`, true)
			)?.trim();
			// Keep only the first line - some CLIs print multi-line banners.
			version = versionOutput ? versionOutput.split("\n")[0] : null;
		} catch (versionError) {
			// Installed but --version failed/unsupported: still "installed",
			// just without a version string. Do not claim a version we
			// didn't actually read.
			version = null;
		}

		return { status: STATUS.INSTALLED, path: whichResult, version, error: null };
	} catch (error) {
		return {
			status: STATUS.ERROR,
			path: null,
			version: null,
			error: error?.message || String(error),
		};
	}
}

export default function AiCodingAgents() {
	const $page = Page(text("ai coding agents", "AI Coding Agents"));

	const $refreshAll = (
		<span
			className="icon refresh"
			attr-action="refresh"
			aria-label={text("refresh", "Refresh")}
			onclick={() => refreshAll()}
		></span>
	);
	$page.header.append($refreshAll);

	const $envBanner = <div className="ai-agents-env-banner hidden"></div>;
	const $projectBanner = <div className="ai-agents-project-banner"></div>;
	const $list = <div className="ai-agents-list"></div>;

	$page.body = (
		<div id="ai-coding-agents">
			{$envBanner}
			{$projectBanner}
			{$list}
			<p className="ai-agents-disclaimer">
				{text(
					"ai-agents-disclaimer",
					"Status here reflects what was actually found on this device. Nothing is assumed installed, and credentials are never read, stored or printed by this panel.",
				)}
			</p>
		</div>
	);

	app.append($page);
	actionStack.push({ id: "ai-coding-agents", action: $page.hide });

	const agentState = new Map(
		AGENT_DEFINITIONS.map((agent) => [
			agent.id,
			{ status: STATUS.UNKNOWN, path: null, version: null, error: null },
		]),
	);
	const unsubscribeProject = projectContext.onChange(renderProjectBanner);

	$page.onhide = () => {
		unsubscribeProject();
		actionStack.remove("ai-coding-agents");
	};

	renderProjectBanner(projectContext.getActiveProject());
	renderAgentCards();
	refreshAll();

	function renderProjectBanner(project) {
		if (!project) {
			$projectBanner.textContent = text(
				"no active project",
				"No active project is open. Open a folder to let agents work on it.",
			);
			$projectBanner.classList.remove("ok");
			return;
		}

		const { accessible, reason } = projectContext.getTerminalAccessibility();
		$projectBanner.classList.toggle("ok", accessible);
		if (accessible) {
			$projectBanner.textContent = `${text("active project", "Active project")}: ${project.name}`;
		} else if (reason === "unbridged-saf") {
			$projectBanner.textContent = `${text("active project", "Active project")}: ${project.name} (${text(
				"project not bridged to terminal",
				"not reachable by the terminal yet - needs a storage bridge",
			)})`;
		} else {
			$projectBanner.textContent = `${text("active project", "Active project")}: ${project.name} (${text(
				"path unresolved",
				"path could not be resolved",
			)})`;
		}
	}

	function renderAgentCards() {
		$list.textContent = "";
		for (const agent of AGENT_DEFINITIONS) {
			$list.append(renderAgentCard(agent));
		}
	}

	/**
	 * @param {typeof AGENT_DEFINITIONS[number]} agent
	 */
	function renderAgentCard(agent) {
		const state = agentState.get(agent.id);
		const effectiveBin = getCustomBin(agent.id) || agent.defaultBin;

		const $status = <span className={`ai-agent-status ${state.status}`}></span>;
		const $statusText = <span className="ai-agent-status-text"></span>;
		const $details = <div className="ai-agent-details"></div>;

		const $openBtn = (
			<button
				type="button"
				className="ai-agent-action primary"
				disabled={state.status !== STATUS.INSTALLED}
				onclick={() => openAgentInProject(agent, effectiveBin)}
			>
				{text("open in project", "Open in project")}
			</button>
		);

		const $recheckBtn = (
			<button
				type="button"
				className="ai-agent-action"
				onclick={() => recheckAgent(agent, $card)}
			>
				{text("check again", "Check again")}
			</button>
		);

		const $configureBtn = (
			<button
				type="button"
				className="ai-agent-action"
				onclick={() => configureBinary(agent, $card)}
			>
				{text("configure", "Configure")}
			</button>
		);

		const $card = (
			<div className="ai-agent-card" data-agent={agent.id}>
				<div className="ai-agent-head">
					{$status}
					<span className="ai-agent-name">{agent.name}</span>
					{$statusText}
				</div>
				{$details}
				<p className="ai-agent-notes">{agent.notes}</p>
				<div className="ai-agent-actions">
					{$openBtn}
					{$recheckBtn}
					{$configureBtn}
				</div>
			</div>
		);

		$card._update = updateStatusNodes;
		updateStatusNodes();
		return $card;

		function updateStatusNodes() {
			const current = agentState.get(agent.id);
			$status.className = `ai-agent-status ${current.status}`;

			const labels = {
				[STATUS.UNKNOWN]: text("not checked", "Not checked yet"),
				[STATUS.CHECKING]: text("checking", "Checking..."),
				[STATUS.INSTALLED]: text("installed", "Installed"),
				[STATUS.NOT_INSTALLED]: text("not installed", "Not installed"),
				[STATUS.ERROR]: text("check failed", "Check failed"),
			};
			$statusText.textContent = labels[current.status] || current.status;

			const lines = [];
			lines.push(`${text("binary", "Binary")}: ${effectiveBin}`);
			if (current.status === STATUS.INSTALLED) {
				lines.push(`${text("path", "PATH")}: ${current.path}`);
				lines.push(
					`${text("version", "Version")}: ${current.version || text("unknown", "unknown")}`,
				);
			}
			if (current.status === STATUS.ERROR && current.error) {
				lines.push(`${text("error", "Error")}: ${current.error}`);
			}
			$details.textContent = "";
			for (const line of lines) {
				$details.append(<div className="ai-agent-detail-line">{line}</div>);
			}

			if ($openBtn) $openBtn.disabled = current.status !== STATUS.INSTALLED;
		}
	}

	/**
	 * @param {typeof AGENT_DEFINITIONS[number]} agent
	 * @param {HTMLElement} $card
	 */
	async function recheckAgent(agent, $card) {
		const envState = await getEnvironmentState();
		if (!envState.terminalReady || !envState.alpineInstalled) {
			agentState.set(agent.id, {
				status: STATUS.UNKNOWN,
				path: null,
				version: null,
				error: envState.reason || null,
			});
			$card._update();
			renderEnvBanner(envState);
			return;
		}
		renderEnvBanner(envState);

		agentState.set(agent.id, { status: STATUS.CHECKING, path: null, version: null, error: null });
		$card._update();

		const bin = getCustomBin(agent.id) || agent.defaultBin;
		const result = await detectAgent(bin);
		agentState.set(agent.id, result);
		$card._update();
	}

	async function refreshAll() {
		$refreshAll.classList.add("spinning");
		try {
			const envState = await getEnvironmentState();
			renderEnvBanner(envState);
			for (const $card of Array.from($list.children)) {
				const agentId = $card.dataset.agent;
				const agent = AGENT_DEFINITIONS.find((a) => a.id === agentId);
				if (!agent) continue;

				if (!envState.terminalReady || !envState.alpineInstalled) {
					agentState.set(agent.id, {
						status: STATUS.UNKNOWN,
						path: null,
						version: null,
						error: envState.reason || null,
					});
					$card._update();
					continue;
				}

				agentState.set(agent.id, {
					status: STATUS.CHECKING,
					path: null,
					version: null,
					error: null,
				});
				$card._update();

				const bin = getCustomBin(agent.id) || agent.defaultBin;
				const result = await detectAgent(bin);
				agentState.set(agent.id, result);
				$card._update();
			}
		} finally {
			$refreshAll.classList.remove("spinning");
		}
	}

	function renderEnvBanner(envState) {
		if (envState.terminalReady && envState.alpineInstalled) {
			$envBanner.classList.add("hidden");
			$envBanner.textContent = "";
			return;
		}

		$envBanner.classList.remove("hidden");
		$envBanner.textContent = !envState.terminalReady
			? text(
					"terminal plugin unavailable",
					"Terminal plugin not available in this build.",
				)
			: text(
					"alpine not installed",
					"Alpine terminal is not installed. Install it from Settings → Terminal settings to detect AI coding agents.",
				);
	}

	/**
	 * @param {typeof AGENT_DEFINITIONS[number]} agent
	 * @param {string} bin
	 */
	async function openAgentInProject(agent, bin) {
		try {
			const { TerminalManager } = await import(
				/* webpackChunkName: "terminal" */ "components/terminal"
			);
			const terminal = await TerminalManager.createTerminal({
				name: `${agent.name}`,
				render: true,
			});

			if (!terminal?.component) {
				throw new Error("Terminal did not initialize");
			}

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

			// createTerminal already attempted the active-project auto-cd;
			// this just actually starts the agent in whatever directory the
			// terminal ended up in.
			terminal.component.write(`${bin}\n`);
			Sidebar.hide();
		} catch (error) {
			console.error(`Failed to open ${agent.name}:`, error);
			toast(
				`${text("failed to open agent", "Failed to open")} ${agent.name}: ${
					error?.message || error
				}`,
			);
		}
	}

	/**
	 * @param {typeof AGENT_DEFINITIONS[number]} agent
	 * @param {HTMLElement} $card
	 */
	async function configureBinary(agent, $card) {
		const current = getCustomBin(agent.id) || agent.defaultBin;
		const value = await prompt(
			text("custom binary name", "Binary name or path"),
			current,
			"text",
			{ required: true },
		);
		if (!value || value === current) return;

		saveCustomBin(agent.id, value === agent.defaultBin ? null : value);
		await recheckAgent(agent, $card);
	}
}
