// CI bundle reporter shared by the Tauri matrix jobs. A file (not
// `node -e`) because PowerShell mangles inline backticks and quotes;
// this runs byte-identical on bash, pwsh, and sh.
//
// Only top-level artifacts count: files directly inside a bundle/<format>
// dir (AppImage, deb, rpm, dmg, msi, nsis installer) plus macOS .app
// directories. Staging trees (AppDir, intermediate objects) are noise.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FORMATS = new Set(["appimage", "deb", "rpm", "dmg", "msi", "nsis"]);
const root = "src-tauri/target/release/bundle";
const found = [];

if (existsSync(root)) {
	for (const format of readdirSync(root, { withFileTypes: true })) {
		if (!format.isDirectory()) continue;
		const dir = join(root, format.name);
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (!/hmmagainagain/i.test(entry.name)) continue;
			if (entry.isFile() && FORMATS.has(format.name)) found.push(full);
			else if (entry.isDirectory() && entry.name.endsWith(".app")) {
				found.push(full);
			}
		}
	}
}
if (found.length === 0) {
	console.error("no bundle artifact found");
	process.exit(1);
}
for (const file of found) {
	const bytes = statSync(file).isDirectory()
		? [...walkBytes(file)].reduce((a, b) => a + b, 0)
		: statSync(file).size;
	console.log(
		`bundle=${file} bytes=${bytes} (${(bytes / 1024 / 1024).toFixed(1)} MiB)`,
	);
}

function* walkBytes(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) yield* walkBytes(full);
		else if (entry.isFile()) yield statSync(full).size;
	}
}
