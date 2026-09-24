// M1 git commands (RON-400): thin shells over the system git binary,
// mirroring the spawnGit argv contract (arrays only, cwd pinned to root,
// verbatim stderr). Parsing stays in TypeScript for M1 (existing pure
// parsers); M2 ports it with fixture oracles. Anything not listed here
// rejects on the TS side until its owning unit lands.
//
// Threading: every command is async and blocking process work runs on the
// blocking pool (never the UI thread). The diff protocol is start/abort/
// result so superseded diffs die instead of piling up (matches the Bun
// adapter's cancellation contract); the same shape serves log streaming
// (M2) and remote ops (M4).

use std::collections::HashMap;
use std::process::{Child, Command};
use std::sync::{Mutex, OnceLock};

fn run_git(root: &str, args: &[&str]) -> Result<String, String> {
	let output = Command::new("git")
		.args(args)
		.current_dir(root)
		.output()
		.map_err(|e| format!("spawn: {e}"))?;
	if !output.status.success() {
		return Err(format!(
			"exit {}: {}",
			output.status.code().unwrap_or(-1),
			String::from_utf8_lossy(&output.stderr)
		));
	}
	Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Blocking git work always runs here, never on the UI thread.
async fn run_git_async(root: String, args: Vec<String>) -> Result<String, String> {
	tauri::async_runtime::spawn_blocking(move || {
		let refs: Vec<&str> = args.iter().map(String::as_str).collect();
		run_git(&root, &refs)
	})
	.await
	.map_err(|e| format!("worker: {e}"))?
}

fn reject_dash(value: &Option<String>, what: &str) -> Result<(), String> {
	if value.as_deref().is_some_and(|v| v.starts_with('-')) {
		return Err(format!("invalid {what}: must not start with '-': {value:?}"));
	}
	Ok(())
}

fn diff_argv(staged: bool, from: &Option<String>, to: &Option<String>) -> Vec<String> {
	// Mirrors the Bun adapter's ranges plus --no-color (a forced color
	// config would otherwise poison the patch with escape sequences).
	let mut args = vec!["diff".to_string(), "--no-color".to_string()];
	if staged {
		args.push("--cached".to_string());
	} else if let Some(f) = from {
		args.push(f.clone());
		if let Some(t) = to {
			args.push(t.clone());
		}
	}
	args
}

#[tauri::command]
pub async fn read_repo(root: String) -> Result<RepoInfo, String> {
	// An unborn branch (no commits yet) is still a valid worktree: branch
	// via --show-current, empty head — the Bun adapter's contract.
	let branch = run_git_async(
		root.clone(),
		vec!["branch".to_string(), "--show-current".to_string()],
	)
	.await?;
	let head = run_git_async(root, vec!["rev-parse".to_string(), "HEAD".to_string()])
		.await
		.unwrap_or_default();
	let branch = branch.trim();
	Ok(RepoInfo {
		branch: if branch.is_empty() {
			"(detached)".to_string()
		} else {
			branch.to_string()
		},
		head: head.trim().to_string(),
	})
}

#[tauri::command]
pub async fn git_status(root: String) -> Result<String, String> {
	run_git_async(
		root,
		vec![
			"status".to_string(),
			"--porcelain=v2".to_string(),
			"--branch".to_string(),
			"-z".to_string(),
		],
	)
	.await
}

#[tauri::command]
pub async fn git_worktree_paths(root: String) -> Result<String, String> {
	run_git_async(
		root,
		vec![
			"ls-files".to_string(),
			"-co".to_string(),
			"--exclude-standard".to_string(),
			"-z".to_string(),
		],
	)
	.await
}

// ---- Cancellable diff protocol (start/abort/result) ----

struct DiffRegistry {
	next_id: u64,
	children: HashMap<u64, Child>,
}

fn registry() -> &'static Mutex<DiffRegistry> {
	static REGISTRY: OnceLock<Mutex<DiffRegistry>> = OnceLock::new();
	REGISTRY.get_or_init(|| {
		Mutex::new(DiffRegistry {
			next_id: 1,
			children: HashMap::new(),
		})
	})
}

#[tauri::command]
pub async fn git_diff_start(
	root: String,
	staged: bool,
	from: Option<String>,
	to: Option<String>,
) -> Result<u64, String> {
	reject_dash(&from, "from ref")?;
	reject_dash(&to, "to ref")?;
	let argv = diff_argv(staged, &from, &to);
	let child = tauri::async_runtime::spawn_blocking(move || {
		Command::new("git")
			.args(&argv)
			.current_dir(&root)
			.stdout(std::process::Stdio::piped())
			.stderr(std::process::Stdio::piped())
			.spawn()
			.map_err(|e| format!("spawn: {e}"))
	})
	.await
	.map_err(|e| format!("worker: {e}"))??;
	let mut registry = registry().lock().map_err(|e| format!("lock: {e}"))?;
	let id = registry.next_id;
	registry.next_id += 1;
	registry.children.insert(id, child);
	Ok(id)
}

#[tauri::command]
pub async fn git_diff_abort(id: u64) -> Result<(), String> {
	let mut registry = registry().lock().map_err(|e| format!("lock: {e}"))?;
	if let Some(mut child) = registry.children.remove(&id) {
		// Best effort: the child may already be gone.
		let _ = child.kill();
	}
	Ok(())
}

#[tauri::command]
pub async fn git_diff_result(id: u64) -> Result<String, String> {
	// Pipes are taken while the Child stays registered, so a concurrent
	// abort still finds something to kill; draining both avoids a pipe
	// deadlock on large output.
	let (mut stdout, mut stderr) = {
		let mut registry = registry().lock().map_err(|e| format!("lock: {e}"))?;
		let child = registry
			.children
			.get_mut(&id)
			.ok_or_else(|| "unknown or aborted diff".to_string())?;
		(
			child.stdout.take().ok_or("stdout already taken")?,
			child.stderr.take().ok_or("stderr already taken")?,
		)
	};
	let (out_bytes, err_bytes) =
		tauri::async_runtime::spawn_blocking(move || {
			use std::io::Read;
			let err_reader = std::thread::spawn(move || {
				let mut buf = Vec::new();
				let _ = stderr.read_to_end(&mut buf);
				buf
			});
			let mut out = Vec::new();
			let _ = stdout.read_to_end(&mut out);
			(out, err_reader.join().unwrap_or_default())
		})
		.await
		.map_err(|e| format!("worker: {e}"))?;
	// An abort during the drain removed and killed the child: surface it
	// instead of a phantom success.
	let mut child = registry()
		.lock()
		.map_err(|e| format!("lock: {e}"))?
		.children
		.remove(&id)
		.ok_or_else(|| "unknown or aborted diff".to_string())?;
	let status = tauri::async_runtime::spawn_blocking(move || child.wait())
		.await
		.map_err(|e| format!("worker: {e}"))?
		.map_err(|e| format!("wait: {e}"))?;
	if !status.success() {
		return Err(format!(
			"exit {}: {}",
			status.code().unwrap_or(-1),
			String::from_utf8_lossy(&err_bytes)
		));
	}
	Ok(String::from_utf8_lossy(&out_bytes).into_owned())
}

#[derive(serde::Serialize, Debug)]
pub struct RepoInfo {
	branch: String,
	head: String,
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::process::Command;

	fn fixture() -> std::path::PathBuf {
		let dir = std::env::temp_dir().join(format!(
			"tauri-git-fixture-{}",
			std::time::SystemTime::now()
				.duration_since(std::time::UNIX_EPOCH)
				.map(|d| d.as_nanos())
				.unwrap_or(0)
		));
		std::fs::create_dir_all(&dir).unwrap();
		let git = |args: &[&str]| {
			Command::new("git")
				.args(args)
				.current_dir(&dir)
				.env("GIT_CONFIG_NOSYSTEM", "1")
				.env("GIT_AUTHOR_NAME", "t")
				.env("GIT_AUTHOR_EMAIL", "t@t")
				.env("GIT_COMMITTER_NAME", "t")
				.env("GIT_COMMITTER_EMAIL", "t@t")
				.output()
				.unwrap()
		};
		assert!(git(&["init", "-b", "main"]).status.success());
		std::fs::write(dir.join("f.txt"), "one\n").unwrap();
		assert!(git(&["add", "."]).status.success());
		assert!(git(&["commit", "-m", "init"]).status.success());
		std::fs::write(dir.join("f.txt"), "one\ntwo\n").unwrap();
		dir
	}

	#[tokio::test]
	async fn read_repo_reports_branch_and_head() {
		let dir = fixture();
		let root = dir.to_str().unwrap().to_string();
		let info = read_repo(root).await.unwrap();
		assert_eq!(info.branch, "main");
		assert_eq!(info.head.len(), 40);
	}

	#[tokio::test]
	async fn unborn_head_returns_empty_head() {
		let dir = std::env::temp_dir().join(format!(
			"tauri-git-unborn-{}",
			std::time::SystemTime::now()
				.duration_since(std::time::UNIX_EPOCH)
				.map(|d| d.as_nanos())
				.unwrap_or(0)
		));
		std::fs::create_dir_all(&dir).unwrap();
		let out = Command::new("git")
			.args(["init", "-b", "main"])
			.current_dir(&dir)
			.output()
			.unwrap();
		assert!(out.status.success());
		let info = read_repo(dir.to_str().unwrap().to_string())
			.await
			.unwrap();
		assert_eq!(info.branch, "main");
		assert_eq!(info.head, "");
	}

	#[tokio::test]
	async fn non_repo_rejects() {
		let err = read_repo("/no/such/dir-ever".to_string())
			.await
			.unwrap_err();
		assert!(err.contains("exit") || err.contains("spawn"), "{err}");
	}

	#[tokio::test]
	async fn status_and_paths_and_diff_agree() {
		let dir = fixture();
		let root = dir.to_str().unwrap().to_string();
		let status = git_status(root.clone()).await.unwrap();
		assert!(status.contains(".M") && status.contains("f.txt"), "{status}");
		let paths = git_worktree_paths(root.clone()).await.unwrap();
		assert!(paths.split('\0').any(|p| p == "f.txt"), "{paths}");
		let id = git_diff_start(root, false, None, None).await.unwrap();
		let patch = git_diff_result(id).await.unwrap();
		assert!(patch.contains("+two"), "{patch}");
	}

	#[tokio::test]
	async fn dash_refs_reject() {
		let err = git_diff_start(
			"/tmp".to_string(),
			false,
			Some("--upload-pack=x".to_string()),
			None,
		)
		.await
		.unwrap_err();
		assert!(err.contains("must not start with"), "{err}");
	}

	#[tokio::test]
	async fn abort_before_result_errors() {
		let dir = fixture();
		let root = dir.to_str().unwrap().to_string();
		let id = git_diff_start(root, false, None, None).await.unwrap();
		git_diff_abort(id).await.unwrap();
		let err = git_diff_result(id).await.unwrap_err();
		assert!(
			err.contains("unknown or aborted"),
			"unexpected error: {err}"
		);
	}

	#[tokio::test]
	async fn abort_during_result_errors() {
		let dir = fixture();
		// A 100MB repetitive worktree change keeps git generating (and the
		// drain blocked) long enough that the abort below lands mid-flight
		// on any real machine — no timing luck required.
		let big = "x".repeat(100) + "\n";
		let mut blob = String::with_capacity(100 * 1024 * 1024);
		for _ in 0..(1024 * 1024) {
			blob.push_str(&big);
		}
		std::fs::write(dir.join("f.txt"), blob).unwrap();
		let root = dir.to_str().unwrap().to_string();
		let id = git_diff_start(root, false, None, None).await.unwrap();
		let result_task = tokio::spawn(async move { git_diff_result(id).await });
		tokio::time::sleep(std::time::Duration::from_millis(300)).await;
		git_diff_abort(id).await.unwrap();
		let err = result_task
			.await
			.expect("result task panicked")
			.unwrap_err();
		assert!(
			err.contains("unknown or aborted"),
			"aborted drain must reject, got: {err}"
		);
		// No leaked registry entries after the race.
		let left = registry().lock().unwrap().children.len();
		assert_eq!(left, 0, "{left} entries leaked");
	}
}
