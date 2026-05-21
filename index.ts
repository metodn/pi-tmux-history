/**
 * tmux-history extension for pi
 *
 * Captures tmux pane scrollback and injects it as context into the current session.
 * Useful for recovering conversation context from previous pi sessions or terminal work.
 *
 * Usage:
 *   /tmux-history              — capture current pane's full scrollback
 *   /tmux-history %5           — capture specific pane by ID
 *   /tmux-history -n 200       — capture last 200 lines
 *   /tmux-history -p "error"   — capture and grep for pattern
 *   /tmux-history -B 5 -A 10 -p "failed"  — grep with context lines
 *   /tmux-history --list       — list all tmux panes
 *
 * Install:
 *   pi install /path/to/pi_tmux_history
 *   # or link directly:
 *   # add to settings.json extensions array
 *
 * @author metodn
 * @license MIT
 */

import { execSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ---- helpers ----

function isTmuxAvailable(): boolean {
	try {
		execSync("tmux list-sessions", { stdio: "pipe", timeout: 3000 });
		return true;
	} catch {
		return false;
	}
}

function getCurrentPaneId(): string | null {
	try {
		return execSync("tmux display-message -p '#{pane_id}'", {
			encoding: "utf8",
			timeout: 3000,
		}).trim();
	} catch {
		return null;
	}
}

interface PaneInfo {
	id: string;
	session: string;
	window: string;
	command: string;
	title: string;
	cwd: string;
}

function listPanes(): PaneInfo[] {
	try {
		const raw = execSync(
			`tmux list-panes -a -F '#{pane_id}\\t#{session_name}#{window_index}.#{pane_index}\\t#{pane_current_command}\\t#{pane_title}\\t#{pane_current_path}'`,
			{ encoding: "utf8", timeout: 3000 },
		).trim();

		if (!raw) return [];

		return raw.split("\n").map((line) => {
			const [id, window, command, title, cwd] = line.split("\t");
			return { id, session: window, window, command, title, cwd };
		});
	} catch {
		return [];
	}
}

function capturePane(paneId: string, lines: number): string {
	try {
		// -S -N means start N lines from bottom of history
		// -E -1 means end at bottom of pane
		return execSync(`tmux capture-pane -t ${paneId} -p -S -${lines} -E -1`, {
			encoding: "utf8",
			timeout: 5000,
			maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large scrollbacks
		});
	} catch (e) {
		throw new Error(
			`Failed to capture pane ${paneId}: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
}

function grepFilter(
	text: string,
	pattern: string,
	before: number,
	after: number,
): string {
	try {
		const parts = ["grep"];
		if (before > 0) parts.push(`-B`, String(before));
		if (after > 0) parts.push(`-A`, String(after));
		parts.push("-E", "--", pattern);
		const result = execSync(parts.join(" "), {
			input: text,
			encoding: "utf8",
			timeout: 5000,
			maxBuffer: 10 * 1024 * 1024,
		});
		return result;
	} catch (e: any) {
		// grep exits with code 1 when no matches — that's not an error for us
		if (e.status === 1) {
			return "";
		}
		throw new Error(`grep failed: ${e.message}`);
	}
}

function parseArgs(args: string): {
	paneId: string | null;
	lines: number;
	pattern: string | null;
	before: number;
	after: number;
	listOnly: boolean;
} {
	const result = {
		paneId: null as string | null,
		lines: 5000, // default: capture a lot
		pattern: null as string | null,
		before: 5,
		after: 5,
		listOnly: false,
	};

	const parts = args.trim().split(/\s+/);
	let i = 0;

	while (i < parts.length) {
		const part = parts[i];

		if (part === "--list" || part === "-l") {
			result.listOnly = true;
			i++;
		} else if (part === "-n" && parts[i + 1]) {
			result.lines = parseInt(parts[i + 1], 10) || 5000;
			i += 2;
		} else if ((part === "-p" || part === "--pattern") && parts[i + 1]) {
			result.pattern = parts[i + 1];
			i += 2;
		} else if (part === "-B" && parts[i + 1]) {
			result.before = parseInt(parts[i + 1], 10) || 0;
			i += 2;
		} else if (part === "-A" && parts[i + 1]) {
			result.after = parseInt(parts[i + 1], 10) || 0;
			i += 2;
		} else if (part.startsWith("%")) {
			// tmux pane ID like %5
			result.paneId = part;
			i++;
		} else {
			// Unknown arg — treat as pane ID if it looks like one, else ignore
			i++;
		}
	}

	return result;
}

// ---- main extension ----

export default function (pi: ExtensionAPI) {
	pi.registerCommand("tmux-history", {
		description:
			"Capture tmux pane scrollback as context. Usage: /tmux-history [%pane_id] [-n lines] [-p pattern] [-B before] [-A after] [--list]",
		getArgumentCompletions: (prefix: string) => {
			if (!isTmuxAvailable()) return null;

			const completions: { value: string; label: string }[] = [];

			// Suggest flags
			const flags = ["--list", "-n ", "-p ", "-B ", "-A "];
			for (const flag of flags) {
				if (flag.startsWith(prefix)) {
					completions.push({ value: flag, label: flag.trim() });
				}
			}

			// Suggest pane IDs
			const panes = listPanes();
			for (const pane of panes) {
				const entry = `${pane.id}`;
				if (entry.startsWith(prefix)) {
					completions.push({
						value: entry,
						label: `${pane.id} — ${pane.session} (${pane.command})`,
					});
				}
			}

			return completions.length > 0 ? completions : null;
		},
		handler: async (args, ctx) => {
			// Check tmux availability
			if (!isTmuxAvailable()) {
				ctx.ui.notify("tmux is not running or not installed", "error");
				return;
			}

			const parsed = parseArgs(args);

			// --list: just show panes
			if (parsed.listOnly) {
				const panes = listPanes();
				if (panes.length === 0) {
					ctx.ui.notify("No tmux panes found", "warning");
					return;
				}

				const lines = panes.map(
					(p) =>
						`  ${p.id.padEnd(6)} ${p.session.padEnd(20)} ${p.command.padEnd(15)} ${p.cwd}`,
				);
				ctx.ui.notify(["Tmux panes:", ...lines].join("\n"), "info");
				return;
			}

			// Determine which pane to capture
			const paneId = parsed.paneId || getCurrentPaneId();
			if (!paneId) {
				ctx.ui.notify(
					"Could not determine tmux pane. Are you in tmux?",
					"error",
				);
				return;
			}

			ctx.ui.notify(
				`Capturing pane ${paneId} (last ${parsed.lines} lines)...`,
				"info",
			);

			// Capture
			let captured: string;
			try {
				captured = capturePane(paneId, parsed.lines);
			} catch (e) {
				ctx.ui.notify(
					e instanceof Error ? e.message : "Capture failed",
					"error",
				);
				return;
			}

			if (!captured.trim()) {
				ctx.ui.notify(`Pane ${paneId} has no scrollback content`, "warning");
				return;
			}

			// Filter with grep if pattern specified
			let output = captured;
			if (parsed.pattern) {
				output = grepFilter(
					captured,
					parsed.pattern,
					parsed.before,
					parsed.after,
				);
				if (!output.trim()) {
					ctx.ui.notify(
						`No matches for pattern "${parsed.pattern}" in pane ${paneId}`,
						"warning",
					);
					return;
				}
				ctx.ui.notify(
					`Found matches for "${parsed.pattern}" (${output.split("\n").length} lines with context)`,
					"info",
				);
			} else {
				const lineCount = output.split("\n").filter((l) => l.trim()).length;
				ctx.ui.notify(
					`Captured ${lineCount} non-empty lines from pane ${paneId}`,
					"info",
				);
			}

			// Truncate if too large (keep reasonable for LLM context)
			const MAX_CHARS = 50_000;
			if (output.length > MAX_CHARS) {
				output = output.slice(-MAX_CHARS);
				output = `[... truncated to last ${MAX_CHARS} chars ...]\n\n${output}`;
			}

			// Inject as a custom message into the conversation
			// This gives the LLM the captured context to work with
			const header = parsed.pattern
				? `--- tmux pane ${paneId} scrollback (grep "${parsed.pattern}", -B${parsed.before} -A${parsed.after}) ---`
				: `--- tmux pane ${paneId} scrollback (last ${parsed.lines} lines) ---`;

			pi.sendMessage(
				{
					customType: "tmux-history",
					content: `${header}\n\`\`\`\n${output}\n\`\`\``,
					display: true,
					details: { paneId, lines: parsed.lines, pattern: parsed.pattern },
				},
				{ triggerTurn: true, deliverAs: "steer" },
			);
		},
	});

	// Also expose as a tool so the LLM can proactively capture tmux history
	// when the user asks about something in their terminal
}
