// Changed-files list: Unstaged/Staged groups with stage checkboxes.
// Pure DOM rendering (jsdom-tested); main.ts owns the write queue behind
// the callbacks. A both-modified file appears in both groups — that is git
// semantics, not duplication: each row acts on its own side.

// Porcelain letters (?, ., !) can't be CSS class names — slug them instead.
const STATUS_SLUGS: Record<string, string> = {
	M: "m",
	A: "a",
	D: "d",
	R: "r",
	C: "c",
	U: "u",
	"?": "untracked",
	"!": "ignored",
	".": "clean",
};

export const statusSlug = (letter: string): string =>
	STATUS_SLUGS[letter] ?? "other";

/** True when the index letter means "will commit": untracked (?) and ignored
 * (!) entries are worktree-only — grouping or counting them as staged
 * misrepresents state and arms bulk-unstage against paths git rejects. */
export const isStagedStatus = (letter: string): boolean =>
	letter !== "." && letter !== "?" && letter !== "!";

export interface StatusListEntry {
	path: string;
	indexStatus: string;
	worktreeStatus: string;
	renamedFrom?: string;
}

export interface StatusListCallbacks {
	/** Checkbox flipped: stage (unstage=false) or unstage a path. A rename
	 * forwards both sides: git needs old+new to stage or unstage the
	 * rename as one unit, not a half-staged split. */
	onToggle: (path: string, unstage: boolean, renamedFrom?: string) => void;
	/** Row body clicked: jump the diff view to the file. */
	onJump: (path: string) => void;
	/** Group header button: stage/unstage every path on that side. */
	onToggleAll: (unstage: boolean) => void;
}

function displayPath(entry: StatusListEntry): string {
	return entry.renamedFrom !== undefined
		? `${entry.renamedFrom} → ${entry.path}`
		: entry.path;
}

function buildRow(
	entry: StatusListEntry,
	stagedSide: boolean,
	callbacks: StatusListCallbacks,
): HTMLElement {
	const item = document.createElement("li");
	item.dataset.path = entry.path;
	item.dataset.side = stagedSide ? "staged" : "unstaged";
	item.tabIndex = 0;
	const active = stagedSide ? entry.indexStatus : entry.worktreeStatus;

	const check = document.createElement("input");
	check.type = "checkbox";
	check.className = "status-check";
	check.checked = stagedSide;
	check.setAttribute(
		"aria-label",
		`${stagedSide ? "Unstage" : "Stage"} ${entry.path}`,
	);
	check.addEventListener("change", () => {
		callbacks.onToggle(entry.path, stagedSide, entry.renamedFrom);
	});

	const letter = document.createElement("span");
	// CSS classes can't carry raw porcelain letters (?, ., !) — slug them.
	letter.className = `status-letter status-${statusSlug(active)}`;
	letter.textContent = active;

	const label = document.createElement("span");
	label.className = "status-path";
	label.textContent = displayPath(entry);

	item.append(check, letter, label);
	item.addEventListener("click", (event) => {
		if ((event.target as HTMLElement | null)?.closest("input")) return;
		callbacks.onJump(entry.path);
	});
	// Arrows walk rows, Enter jumps the diff; Space toggles the focused
	// checkbox natively.
	item.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			event.preventDefault();
			callbacks.onJump(entry.path);
			return;
		}
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		event.preventDefault();
		const parent = item.parentElement;
		if (!parent) return;
		const rows = [...parent.querySelectorAll("li[data-path]")] as HTMLElement[];
		const next = rows.indexOf(item) + (event.key === "ArrowDown" ? 1 : -1);
		rows[Math.min(rows.length - 1, Math.max(0, next))]?.focus();
	});
	return item;
}

function buildGroupHeader(
	title: string,
	count: number,
	actionLabel: string,
	unstage: boolean,
	callbacks: StatusListCallbacks,
): HTMLElement {
	const header = document.createElement("li");
	header.className = "status-group-header";
	header.dataset.side = unstage ? "staged" : "unstaged";
	const name = document.createElement("span");
	name.className = "status-group-title";
	name.textContent = `${title} (${count})`;
	const action = document.createElement("button");
	action.type = "button";
	action.className = "status-action";
	action.textContent = actionLabel;
	action.addEventListener("click", () => callbacks.onToggleAll(unstage));
	header.append(name, action);
	return header;
}

export function renderStatusList(
	list: HTMLUListElement,
	entries: readonly StatusListEntry[],
	callbacks: StatusListCallbacks,
): void {
	list.innerHTML = "";
	if (entries.length === 0) {
		const empty = document.createElement("li");
		empty.className = "status-empty";
		empty.textContent =
			"Working tree clean — pick a commit in History to review.";
		list.append(empty);
		return;
	}
	const unstaged = entries.filter((e) => e.worktreeStatus !== ".");
	const staged = entries.filter((e) => isStagedStatus(e.indexStatus));
	if (unstaged.length > 0) {
		list.append(
			buildGroupHeader(
				"Unstaged",
				unstaged.length,
				"Stage all",
				false,
				callbacks,
			),
		);
		for (const entry of unstaged) {
			list.append(buildRow(entry, false, callbacks));
		}
	}
	if (staged.length > 0) {
		list.append(
			buildGroupHeader("Staged", staged.length, "Unstage all", true, callbacks),
		);
		for (const entry of staged) {
			list.append(buildRow(entry, true, callbacks));
		}
	}
}
