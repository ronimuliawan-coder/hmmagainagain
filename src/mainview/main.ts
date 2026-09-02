import "./style.css";
import { getPlatform } from "./platform";

const app = document.getElementById("app")!;

let count = 0;
let lastRoot = "";
let smokeOutput = "";

function render() {
	app.innerHTML = `
		<main>
			<div class="container">
				<h1>hmmagainagain</h1>
				<p class="subtitle">A lightweight desktop git client — U1: platform adapter online</p>

				<div class="card">
					<h2>Interactive Counter</h2>
					<p>
						The original template demo — kept until the real UI lands in U3.
					</p>
					<div class="button-group">
						<button class="primary" id="increment-btn">
							Count: ${count}
						</button>
						<button class="secondary" id="reset-btn">
							Reset
						</button>
					</div>
				</div>

				<div class="card">
					<h2>Platform smoke (U1)</h2>
					<p>
						Type a local git repository path, then open it and stream
						<code>git log</code> through the platform adapter (RPC in the app,
						in-memory fake in a plain browser — try <code>/virtual/repo</code>).
					</p>
					<div class="button-group">
						<input id="repo-path" placeholder="/path/to/repo" value="${lastRoot}" />
						<button class="primary" id="open-btn">Open</button>
						<button class="secondary" id="stream-btn">Stream git log</button>
					</div>
					<pre id="smoke-out">${smokeOutput || "—"}</pre>
				</div>

				<div class="footer">
					<p>
						Stack: Electrobun · vanilla TypeScript · subprocess git ·
						@pierre/diffs + @pierre/trees (from U3/U4)
					</p>
				</div>
			</div>
		</main>
	`;

	document.getElementById("increment-btn")!.addEventListener("click", () => {
		count++;
		render();
	});

	document.getElementById("reset-btn")!.addEventListener("click", () => {
		count = 0;
		render();
	});

	document.getElementById("open-btn")!.addEventListener("click", () => {
		void openRepo();
	});

	document.getElementById("stream-btn")!.addEventListener("click", () => {
		void streamLog();
	});
}

async function openRepo(): Promise<void> {
	lastRoot = (
		document.getElementById("repo-path") as HTMLInputElement
	).value.trim();
	smokeOutput = `opening ${lastRoot} …`;
	render();
	try {
		const info = await getPlatform().readRepo(lastRoot);
		smokeOutput = `branch=${info.branch} head=${info.head.slice(0, 7)} root=${info.root}`;
	} catch (error) {
		smokeOutput = `error: ${String(error)}`;
	}
	render();
}

async function streamLog(): Promise<void> {
	if (!lastRoot) {
		smokeOutput = "open a repository first";
		render();
		return;
	}
	smokeOutput = "streaming …";
	render();
	const chunks: string[] = [];
	try {
		const result = await getPlatform().runGit(
			lastRoot,
			["log", "--oneline", "-5"],
			{
				onStdout: (chunk) => chunks.push(new TextDecoder().decode(chunk)),
			},
		);
		smokeOutput = `exit=${result.code} chunks=${chunks.length}\n${chunks.join("")}`;
	} catch (error) {
		smokeOutput = `error: ${String(error)}`;
	}
	render();
}

render();
