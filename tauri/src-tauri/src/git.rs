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
use tauri::Emitter;

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
	// -uall matches the Bun adapter: nested untracked files report
	// individually (nested/file.txt), not as a collapsed directory.
	run_git_async(
		root,
		vec![
			"status".to_string(),
			"--porcelain=v2".to_string(),
			"--branch".to_string(),
			"-z".to_string(),
			"-uall".to_string(),
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
pub async fn git_diff_abort(id: u64) -> Result<(), String> {	let mut registry = registry().lock().map_err(|e| format!("lock: {e}"))?;
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

#[derive(serde::Serialize, Clone, Debug)]
struct LogCommitEvent {
	run_id: String,
	commit: LogCommit,
}

#[derive(serde::Serialize, Clone, Debug)]
struct LogDoneEvent {
	run_id: String,
	count: usize,
}

/// Log argv contract (mirrors the Bun adapter). Pure for testability; the
/// streaming command below only adds process + emit plumbing around it.
fn log_argv(
	limit: Option<usize>,
	skip: Option<usize>,
	range: &Option<String>,
) -> Result<Vec<String>, String> {
	if let Some(r) = range.as_deref() {
		if r.starts_with('-') {
			return Err(format!("invalid range: must not start with '-': {r:?}"));
		}
	}
	let mut argv: Vec<String> = vec![
		"log".to_string(),
		"--format=%H\x1f%h\x1f%an\x1f%ae\x1f%aI\x1f%s\x1f%D\x00".to_string(),
	];
	if let Some(n) = limit {
		argv.push(format!("--max-count={n}"));
	}
	if let Some(n) = skip {
		argv.push(format!("--skip={n}"));
	}
	argv.push("--no-color".to_string());
	if let Some(r) = range.as_deref() {
		argv.push(r.to_string());
	}
	Ok(argv)
}

/// Streams history as `git-log-commit` events plus one `git-log-done`.
/// Same argv contract as the Bun adapter (format, max-count, skip,
/// --no-color, range). Records emit as they arrive so the History pane
/// renders before a long log finishes.
#[tauri::command]
pub async fn git_log_stream(
	app: tauri::AppHandle,
	root: String,
	run_id: String,
	limit: Option<usize>,
	skip: Option<usize>,
	range: Option<String>,
) -> Result<usize, String> {
	use std::io::{BufRead, BufReader};
	let argv = log_argv(limit, skip, &range)?;
	let emit_app = app.clone();
	let done_id = run_id.clone();
	let (count, status) = tauri::async_runtime::spawn_blocking(move || {
		let mut child = Command::new("git")
			.args(&argv)
			.current_dir(&root)
			.stdout(std::process::Stdio::piped())
			.stderr(std::process::Stdio::null())
			.spawn()
			.map_err(|e| format!("spawn: {e}"))?;
		let stdout = child.stdout.take().ok_or("stdout unavailable")?;
		let mut reader = BufReader::new(stdout);
		let mut count = 0;
		let mut buf = Vec::new();
		loop {
			buf.clear();
			let n = reader
				.read_until(b'\0', &mut buf)
				.map_err(|e| format!("read: {e}"))?;
			if n == 0 {
				break;
			}
			let record = String::from_utf8_lossy(&buf);
			let record = record.strip_prefix('\n').unwrap_or(&record);
			if record.is_empty() {
				continue;
			}
			if let Some(commit) = parse_log_record(record) {
				count += 1;
				emit_app
					.emit(
						"git-log-commit",
						LogCommitEvent {
							run_id: run_id.clone(),
							commit,
						},
					)
					.map_err(|e| format!("emit: {e}"))?;
			}
		}
		let status = child.wait().map_err(|e| format!("wait: {e}"))?;
		Ok::<_, String>((count, status))
	})
	.await
	.map_err(|e| format!("worker: {e}"))??;
	if !status.success() {
		return Err(format!("exit {}", status.code().unwrap_or(-1),));
	}
	app.emit(
		"git-log-done",
		LogDoneEvent {
			run_id: done_id,
			count,
		},
	)
	.map_err(|e| format!("emit: {e}"))?;
	Ok(count)
}

#[derive(serde::Serialize, Debug)]
pub struct RepoInfo {
	branch: String,
	head: String,
}

/// One history record. Field order mirrors the Bun adapter's LOG_FORMAT
/// (%H %h %an %ae %aI %s %D, US-separated, NUL-terminated) so both
/// adapters parse identical output.
#[derive(serde::Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LogCommit {
	oid: String,
	short_oid: String,
	author_name: String,
	author_email: String,
	date: String,
	subject: String,
	refs: String,
}

pub fn parse_log_record(record: &str) -> Option<LogCommit> {
	let mut fields = record.split('\x1f');
	Some(LogCommit {
		oid: fields.next()?.to_string(),
		short_oid: fields.next()?.to_string(),
		author_name: fields.next()?.to_string(),
		author_email: fields.next()?.to_string(),
		date: fields.next()?.to_string(),
		subject: fields.next()?.to_string(),
		refs: fields.next()?.to_string(),
	})
}

#[derive(serde::Serialize, Debug, Clone)]
pub struct BranchInfo {
	name: String,
	oid: String,
	current: bool,
	#[serde(skip_serializing_if = "Option::is_none")]
	upstream: Option<String>,
}

pub fn parse_branch_line(line: &str) -> Option<BranchInfo> {
	let mut fields = line.split('\0');
	let oid = fields.next()?.to_string();
	let name = fields.next()?.to_string();
	if name.is_empty() {
		return None;
	}
	let head = fields.next().unwrap_or("");
	let upstream = fields.next().unwrap_or("");
	Some(BranchInfo {
		name,
		oid,
		current: head == "*",
		upstream: if upstream.is_empty() {
			None
		} else {
			Some(upstream.to_string())
		},
	})
}

/// True when porcelain-v2 output holds any entry record (1/2/u/?).
/// Branch headers (#…) never count.
fn status_has_entries(raw: &str) -> bool {
	raw.split('\0')
		.filter(|r| !r.is_empty())
		.any(|r| matches!(r.chars().next(), Some('1' | '2' | 'u' | '?')))
}

#[tauri::command]
pub async fn git_branches(root: String) -> Result<Vec<BranchInfo>, String> {
	let raw = run_git_async(
		root,
		vec![
			"for-each-ref".to_string(),
			"--format=%(objectname)%00%(refname:short)%00%(HEAD)%00%(upstream:short)".to_string(),
			"refs/heads".to_string(),
		],
	)
	.await?;
	Ok(raw
		.split('\n')
		.filter(|line| !line.is_empty())
		.filter_map(parse_branch_line)
		.collect())
}

/// Refuses when the worktree or index holds ANY change — nothing is stashed,
/// nothing is discarded (mirrors the Bun adapter's safety centerpiece).
async fn assert_clean_worktree(root: &str) -> Result<(), String> {
	let raw = run_git_async(
		root.to_string(),
		vec![
			"status".to_string(),
			"--porcelain=v2".to_string(),
			"-z".to_string(),
			"-uall".to_string(),
		],
	)
	.await?;
	if status_has_entries(&raw) {
		let count = raw
			.split('\0')
			.filter(|r| !r.is_empty())
			.filter(|r| matches!(r.chars().next(), Some('1' | '2' | 'u' | '?')))
			.count();
		return Err(format!(
			"refusing to switch branches: the worktree has {count} change(s) (commit them first — nothing is auto-discarded)"
		));
	}
	Ok(())
}

fn reject_empty(value: &str, what: &str) -> Result<(), String> {
	if value.trim().is_empty() {
		return Err(format!("{what} is empty"));
	}
	if value.starts_with('-') {
		return Err(format!(
			"invalid {what}: must not start with '-': {value:?}"
		));
	}
	Ok(())
}

#[tauri::command]
pub async fn git_create_branch(
	root: String,
	name: String,
	switch_to: bool,
) -> Result<(), String> {
	reject_empty(&name, "branch name")?;
	// NOTE (M3): the Bun adapter serializes branch writes through the
	// per-repo write queue; the check-then-act above races under
	// concurrency until M3 ports the queue and absorbs these ops.
	if switch_to {
		assert_clean_worktree(&root).await?;
		run_git_async(root, vec!["switch".to_string(), "-c".to_string(), name]).await?;
	} else {
		run_git_async(root, vec!["branch".to_string(), name]).await?;
	}
	Ok(())
}

#[tauri::command]
pub async fn git_switch_branch(root: String, name: String) -> Result<(), String> {
	reject_empty(&name, "branch name")?;
	assert_clean_worktree(&root).await?;
	run_git_async(root, vec!["switch".to_string(), name]).await?;
	Ok(())
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
		std::fs::create_dir_all(dir.join("nested")).unwrap();
		std::fs::write(dir.join("nested").join("file.txt"), "new\n").unwrap();
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
		// -uall: nested untracked files report individually, never as a
		// collapsed directory entry the Changes view can't stage.
		assert!(status.contains("nested/file.txt"), "{status}");
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
		// The 100MB fixture must not outlive the test (nor survive a
		// panic): remove it on drop, not just on the happy path.
		struct Cleanup<'a>(&'a std::path::Path);
		impl Drop for Cleanup<'_> {
			fn drop(&mut self) {
				let _ = std::fs::remove_dir_all(self.0);
			}
		}
		let _cleanup = Cleanup(dir.as_path());
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
		// The registry is process-wide and tests run on parallel threads,
		// so only this diff's own entry may be asserted — never the total.
		let leaked = registry()
			.lock()
			.unwrap()
			.children
			.contains_key(&id);
		assert!(!leaked, "entry {id} leaked");
	}

	#[test]
	fn log_record_parses_all_fields() {
		let record = [
			"abc123",
			"abc",
			"Jane",
			"j@x",
			"2026-01-02T00:00:00+00:00",
			"do the thing",
			"HEAD -> main",
		]
		.join("\x1f");
		let commit = parse_log_record(&record).unwrap();
		assert_eq!(commit.oid, "abc123");
		assert_eq!(commit.short_oid, "abc");
		assert_eq!(commit.subject, "do the thing");
		assert_eq!(commit.refs, "HEAD -> main");
	}

	#[test]
	fn log_record_rejects_short_records() {
		assert!(parse_log_record("abc\x1fdef").is_none());
		assert!(parse_log_record("").is_none());
	}

	#[test]
	fn log_argv_mirrors_the_bun_contract() {
		assert_eq!(
			log_argv(Some(50), Some(10), &Some("main".to_string())).unwrap(),
			[
				"log",
				"--format=%H\x1f%h\x1f%an\x1f%ae\x1f%aI\x1f%s\x1f%D\x00",
				"--max-count=50",
				"--skip=10",
				"--no-color",
				"main",
			]
		);
		assert!(log_argv(None, None, &Some("--evil".to_string())).is_err());
	}

	#[test]
	fn branch_line_parses_current_and_upstream() {
		let current =
			parse_branch_line("abc123\x00main\x00*\x00origin/main").unwrap();
		assert_eq!(current.name, "main");
		assert!(current.current);
		assert_eq!(current.upstream.as_deref(), Some("origin/main"));
		let other = parse_branch_line("def456\x00side\x00\x00").unwrap();
		assert!(!other.current);
		assert_eq!(other.upstream, None);
		assert!(parse_branch_line("abc123\x00\x00*\x00").is_none());
	}

	#[tokio::test]
	async fn branches_and_switching_work() {
		let dir = fixture();
		let root = dir.to_str().unwrap().to_string();
		let list = git_branches(root.clone()).await.unwrap();
		assert_eq!(list.len(), 1);
		assert_eq!(list[0].name, "main");
		assert!(list[0].current);

		// Switching away from a dirty worktree refuses (data safety).
		let err = git_switch_branch(root.clone(), "other".to_string())
			.await
			.unwrap_err();
		assert!(err.contains("refusing to switch"), "{err}");

		// Clean the tree, then create + switch for real.
		let dir = fixture_clean();
		let root = dir.to_str().unwrap().to_string();
		git_create_branch(root.clone(), "feature".to_string(), false)
			.await
			.unwrap();
		let list = git_branches(root.clone()).await.unwrap();
		assert_eq!(list.len(), 2);
		git_switch_branch(root.clone(), "feature".to_string())
			.await
			.unwrap();
		let list = git_branches(root).await.unwrap();
		let current = list.iter().find(|b| b.current).unwrap();
		assert_eq!(current.name, "feature");

		// Empty and dash-led names reject before any git runs.
		assert!(
			git_create_branch("/tmp".to_string(), "  ".to_string(), false)
				.await
				.is_err()
		);
		assert!(
			git_switch_branch("/tmp".to_string(), "-x".to_string())
				.await
				.is_err()
		);
	}

	/// Like fixture() but with a clean worktree (committed, nothing pending).
	fn fixture_clean() -> std::path::PathBuf {
		let dir = fixture();
		let out = Command::new("git")
			.args(["stash", "-u"])
			.current_dir(&dir)
			.env("GIT_AUTHOR_NAME", "t")
			.env("GIT_AUTHOR_EMAIL", "t@t")
			.env("GIT_COMMITTER_NAME", "t")
			.env("GIT_COMMITTER_EMAIL", "t@t")
			.output()
			.unwrap();
		assert!(out.status.success());
		dir
	}
}
