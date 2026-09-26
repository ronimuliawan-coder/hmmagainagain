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
	let output = git_command()
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

/// Rejects leading-dash values that would parse as flags (CWE-88).
fn reject_dash(value: &Option<String>, what: &str) -> Result<(), String> {
	if value.as_deref().is_some_and(|v| v.starts_with('-')) {
		return Err(format!("invalid {what}: must not start with '-': {value:?}"));
	}
	Ok(())
}

/// Every git child process in this file is built here. Location variables
/// inherited from the app's own environment would redirect git at a
/// different repository, index, or object store than `root` — writes could
/// land in the wrong repo, or blobs could be stored where a later git
/// cannot find them. They are always removed; callers pass locations
/// explicitly via argv/cwd. Shared with remote.rs (same helper, same
/// guarantee for transfer processes).
pub(crate) fn git_command() -> Command {
	let mut command = Command::new("git");
	command
		.env_remove("GIT_DIR")
		.env_remove("GIT_WORK_TREE")
		.env_remove("GIT_INDEX_FILE")
		.env_remove("GIT_OBJECT_DIRECTORY")
		.env_remove("GIT_COMMON_DIR");
	command
}

/// Canonical lane key for a repository root. A subdirectory of a repo must
/// serialize on the same lane as the root (git discovers the same index
/// from both), so the key resolves the worktree top-level first. Falls back
/// to the canonicalized path, then the raw string when the path does not
/// (yet) exist; git itself then reports the real error. Only the lane key
/// is resolved — git always receives the original root.
fn lane_key(root: &str) -> String {
	if let Ok(output) = git_command()
		.args(["rev-parse", "--show-toplevel"])
		.current_dir(root)
		.output()
	{
		if output.status.success() {
			return String::from_utf8_lossy(&output.stdout).trim().to_string();
		}
	}
	std::fs::canonicalize(root)
		.map(|p| p.to_string_lossy().into_owned())
		.unwrap_or_else(|_| root.to_string())
}

// ---- Serialized index writes (per-repo lanes) ----
//
// Mirrors the Bun adapter's write queue: every mutation of a repository
// runs under that repo's lane so concurrent UI actions cannot interleave
// index writes. The lane lives only for the blocking section (never held
// across .await); a poisoned lane recovers instead of wedging the repo.

/// Per-repository write lanes, created on demand.
fn write_queues() -> &'static Mutex<HashMap<String, std::sync::Arc<Mutex<()>>>> {
	static QUEUES: OnceLock<Mutex<HashMap<String, std::sync::Arc<Mutex<()>>>>> =
		OnceLock::new();
	QUEUES.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Clones the repo's lane Arc without acquiring it. Remote start/result
/// join the same serialization point around their critical sections (see
/// remote.rs for the documented scope).
pub(crate) fn write_lock_lane(root: &str) -> std::sync::Arc<Mutex<()>> {
	// Key first: lane_key spawns git rev-parse, which must never run while
	// the global queues lock is held (every repo's writes would serialize
	// behind a subprocess spawn).
	let key = lane_key(root);
	let mut queues = write_queues()
		.lock()
		.unwrap_or_else(|e| e.into_inner());
	let lane = queues
		.entry(key)
		.or_insert_with(|| std::sync::Arc::new(Mutex::new(())))
		.clone();
	if queues.len() > 64 {
		queues.retain(|_, lane| std::sync::Arc::strong_count(lane) > 1);
	}
	lane
}

/// Runs `op` with the repo's write lane held, on the blocking pool.
async fn with_write_lock<F, T>(root: String, op: F) -> Result<T, String>
where
	F: FnOnce() -> Result<T, String> + Send + 'static,
	T: Send + 'static,
{
	let lane = write_lock_lane(&root);
	tauri::async_runtime::spawn_blocking(move || {
		let _held = lane.lock().unwrap_or_else(|e| e.into_inner());
		op()
	})
	.await
	.map_err(|e| format!("worker: {e}"))?
}

/// One-shot write: argv + optional stdin, stdout/stderr collected.
/// Failures carry stderr verbatim (hook output, "patch does not apply")
/// because the UI displays it as-is.
fn run_write(root: &str, args: &[&str], stdin: Option<&str>) -> Result<(), String> {
	run_write_env(root, args, stdin, &[])
}

/// run_write plus extra environment variables for the child.
fn run_write_env(
	root: &str,
	args: &[&str],
	stdin: Option<&str>,
	extra_env: &[(&str, &str)],
) -> Result<(), String> {
	let mut child = git_command();
	child
		.args(args)
		.current_dir(root)
		.stdin(if stdin.is_some() {
			std::process::Stdio::piped()
		} else {
			std::process::Stdio::null()
		})
		.stdout(std::process::Stdio::piped())
		.stderr(std::process::Stdio::piped());
	for (key, value) in extra_env {
		child.env(key, value);
	}
	let mut child = child.spawn().map_err(|e| format!("spawn: {e}"))?;
	if let Some(text) = stdin {
		use std::io::Write;
		child
			.stdin
			.as_mut()
			.ok_or("stdin unavailable")?
			.write_all(text.as_bytes())
			.map_err(|e| format!("stdin: {e}"))?;
		// Explicit close (then drop): commands waiting on stdin see EOF.
		child.stdin.take();
	}
	let output = child
		.wait_with_output()
		.map_err(|e| format!("wait: {e}"))?;
	if !output.status.success() {
		return Err(format!(
			"git {} failed: {}",
			args[0],
			String::from_utf8_lossy(&output.stderr)
		));
	}
	Ok(())
}

/// Diff argv contract mirroring the Bun adapter (ranges + --no-color).
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
			// Unmerged paths would otherwise list once per index stage.
			"--deduplicate".to_string(),
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

/// Live diff runs for the start/abort/result protocol.
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
		git_command()
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
		// Best effort kill, then reap so no zombie remains (same shape as
		// the remote abort; Child has no Drop impl that waits).
		let _ = child.kill();
		let _ = child.wait();
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
		"--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D%x00".to_string(),
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
		let mut child = git_command()
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
		// Reap-before-return: every error below kills and waits first, or
		// the child stays a zombie (review catch).
		let mut drain = || -> Result<usize, String> {
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
			Ok(count)
		};
		let count = match drain() {
			Ok(count) => count,
			Err(error) => {
				let _ = child.kill();
				let _ = child.wait();
				return Err(error);
			}
		};
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

/// Parses one NUL-terminated log record (US-separated fields).
pub fn parse_log_record(record: &str) -> Option<LogCommit> {
	// read_until keeps the NUL terminator: strip it here so refs never
	// ends in "\0" (truthy in JS, breaks empty-ref checks downstream).
	let record = record.strip_suffix('\0').unwrap_or(record);
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
	/// Remote-tracking branches (refs/remotes/*) list under their short
	/// name (origin/main); the UI routes them to the tracking checkout.
	#[serde(default)]
	remote: bool,
}

/// Parses one for-each-ref record (NUL-separated fields).
pub fn parse_branch_line(line: &str) -> Option<BranchInfo> {
	let mut fields = line.split('\0');
	let oid = fields.next()?.to_string();
	let full = fields.next()?.to_string();
	let name = fields.next()?.to_string();
	if name.is_empty() {
		return None;
	}
	// origin/HEAD-style aliases select nothing checkout-able.
	if name.ends_with("/HEAD") {
		return None;
	}
	let remote = full.starts_with("refs/remotes/");
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
		remote,
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
			"--format=%(objectname)%00%(refname)%00%(refname:short)%00%(HEAD)%00%(upstream:short)".to_string(),
			"refs/heads".to_string(),
			"refs/remotes".to_string(),
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
/// Synchronous: runs inside a held write lane.
fn assert_clean_worktree_sync(root: &str) -> Result<(), String> {
	let raw = run_git(root, &["status", "--porcelain=v2", "-z", "-uall"])?;
	if !status_has_entries(&raw) {
		return Ok(());
	}
	let count = raw
		.split('\0')
		.filter(|r| !r.is_empty())
		.filter(|r| matches!(r.chars().next(), Some('1' | '2' | 'u' | '?')))
		.count();
	Err(format!(
		"refusing to switch branches: the worktree has {count} change(s) (commit them first — nothing is auto-discarded)"
	))
}

/// Rejects blank or leading-dash names before argv construction.
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
	with_write_lock(root.clone(), move || {
		if switch_to {
			assert_clean_worktree_sync(&root)?;
			run_write(&root, &["switch", "-c", &name], None)
		} else {
			run_write(&root, &["branch", &name], None)
		}
	})
	.await
}

#[tauri::command]
pub async fn git_switch_branch(root: String, name: String) -> Result<(), String> {
	reject_empty(&name, "branch name")?;
	with_write_lock(root.clone(), move || {
		assert_clean_worktree_sync(&root)?;
		run_write(&root, &["switch", &name], None)
	})
	.await
}

/// Checks out a remote-tracking branch: a same-named local branch takes a
/// plain switch, otherwise a tracking branch is created explicitly (no
/// DWIM guessing on names with slashes).
#[tauri::command]
pub async fn git_switch_remote_branch(
	root: String,
	remote_ref: String,
) -> Result<(), String> {
	reject_empty(&remote_ref, "remote branch")?;
	let Some((_remote, short)) = remote_ref.split_once('/') else {
		return Err(format!("not a remote-tracking ref: {remote_ref:?}"));
	};
	if short.is_empty() || short.starts_with('-') {
		return Err(format!("invalid remote-tracking ref: {remote_ref:?}"));
	}
	let short = short.to_string();
	with_write_lock(root.clone(), move || {
		assert_clean_worktree_sync(&root)?;
		// Probe, don't guess: rev-parse --quiet reports existence by
		// status instead of failing loudly (run_git would).
		let exists = git_command()
			.args([
				"rev-parse",
				"--verify",
				"--quiet",
				&format!("refs/heads/{short}"),
			])
			.current_dir(&root)
			.output()
			.map_err(|e| format!("spawn: {e}"))?
			.status
			.success();
		if exists {
			run_write(&root, &["switch", &short], None)
		} else {
			run_write(&root, &["switch", "--track", "-c", &short, &remote_ref], None)
		}
	})
	.await
}

#[tauri::command]
pub async fn stage_paths(root: String, paths: Vec<String>) -> Result<(), String> {
	if paths.is_empty() {
		return Ok(());
	}
	with_write_lock(root.clone(), move || {
		let mut args = vec!["add", "-A", "--"];
		args.extend(paths.iter().map(String::as_str));
		// Literal pathspecs: a file like app/[id]/page.tsx must not
		// stage its glob lookalikes (review catch; Bun twin tracked
		// separately).
		run_write_env(&root, &args, None, &[("GIT_LITERAL_PATHSPECS", "1")])
	})
	.await
}

#[tauri::command]
pub async fn unstage_paths(root: String, paths: Vec<String>) -> Result<(), String> {
	if paths.is_empty() {
		return Ok(());
	}
	with_write_lock(root.clone(), move || {
		let mut args = vec!["restore", "--staged", "--"];
		args.extend(paths.iter().map(String::as_str));
		run_write_env(&root, &args, None, &[("GIT_LITERAL_PATHSPECS", "1")])
	})
	.await
}

#[tauri::command]
pub async fn apply_index_patch(root: String, patch: String) -> Result<(), String> {
	if patch.trim().is_empty() {
		return Ok(());
	}
	with_write_lock(root.clone(), move || {
		// The patch goes in via stdin; `-` reads it. A patch whose context
		// no longer matches fails here with git's own message.
		run_write(
			&root,
			&["apply", "--cached", "--whitespace=nowarn", "-"],
			Some(&patch),
		)
	})
	.await
}

#[tauri::command]
pub async fn commit(root: String, message: String) -> Result<(), String> {
	with_write_lock(root.clone(), move || run_write(&root, &["commit", "-m", &message], None))
		.await
}

#[cfg(test)]
mod tests {
	use super::*;

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
			git_command()
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
		// Identity lives in the repo config (not ambient env): every later
		// command in the fixture — including commit() under test, which
		// inherits the process environment — has it (review catch).
		assert!(git(&["config", "user.email", "t@t"]).status.success());
		assert!(git(&["config", "user.name", "t"]).status.success());
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
		let out = git_command()
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
		let argv = log_argv(Some(50), Some(10), &Some("main".to_string())).unwrap();
		// No raw control bytes: Command rejects NUL in argv, so the format
		// must use git's %x placeholders (review catch).
		assert!(argv.iter().all(|a| !a.contains('\0')));
		assert_eq!(
			argv,
			[
				"log",
				"--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D%x00",
				"--max-count=50",
				"--skip=10",
				"--no-color",
				"main",
			]
		);
		assert!(log_argv(None, None, &Some("--evil".to_string())).is_err());
	}

	#[test]
	fn log_record_strips_the_nul_terminator() {
		// read_until keeps the delimiter: refs must not end in "\0".
		let record = "abc\x1fo\x1fJane\x1fj@x\x1f2026\x1fsubj\x1f\x00";
		let commit = parse_log_record(record).unwrap();
		assert_eq!(commit.refs, "");
	}

	#[test]
	fn branch_line_parses_current_and_upstream() {
		let current = parse_branch_line(
			"abc123\x00refs/heads/main\x00main\x00*\x00origin/main",
		)
		.unwrap();
		assert_eq!(current.name, "main");
		assert!(current.current);
		assert_eq!(current.upstream.as_deref(), Some("origin/main"));
		assert!(!current.remote);
		let other =
			parse_branch_line("def456\x00refs/heads/side\x00side\x00\x00").unwrap();
		assert!(!other.current);
		assert_eq!(other.upstream, None);
		assert!(!other.remote);
		assert!(parse_branch_line("abc123\x00refs/heads/\x00\x00\x00").is_none());
	}

	#[test]
	fn branch_line_marks_remotes_and_skips_aliases() {
		let tracked = parse_branch_line(
			"abc123\x00refs/remotes/origin/main\x00origin/main\x00\x00",
		)
		.unwrap();
		assert_eq!(tracked.name, "origin/main");
		assert!(tracked.remote);
		assert!(!tracked.current);
		assert!(parse_branch_line(
			"abc123\x00refs/remotes/origin/HEAD\x00origin/HEAD\x00\x00"
		)
		.is_none());
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
	fn fixture_clean() -> std::path::PathBuf {		let dir = fixture();
		let out = git_command()
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

	#[tokio::test]
	async fn stage_unstage_round_trip() {
		let dir = fixture();
		let root = dir.to_str().unwrap().to_string();
		stage_paths(root.clone(), vec!["f.txt".to_string()])
			.await
			.unwrap();
		let status = git_status(root.clone()).await.unwrap();
		assert!(status.contains("1 M.") && status.contains("f.txt"), "{status}");
		unstage_paths(root.clone(), vec!["f.txt".to_string()])
			.await
			.unwrap();
		let status = git_status(root).await.unwrap();
		assert!(status.contains(".M"), "{status}");
		// Empty path lists are no-ops, like the Bun adapter.
		stage_paths("/tmp".to_string(), vec![]).await.unwrap();
		unstage_paths("/tmp".to_string(), vec![]).await.unwrap();
	}

	#[tokio::test]
	async fn apply_patch_round_trip() {
		let dir = fixture();
		let root = dir.to_str().unwrap().to_string();
		// Capture the worktree diff, revert, re-apply to the index.
		let id = git_diff_start(root.clone(), false, None, None)
			.await
			.unwrap();
		let patch = git_diff_result(id).await.unwrap();
		assert!(patch.contains("+two"));
		run_git(&root, &["checkout", "--", "f.txt"]).unwrap();
		apply_index_patch(root.clone(), patch).await.unwrap();
		let status = git_status(root).await.unwrap();
		// Index holds the change while the reverted worktree does not:
		// staged-modified AND worktree-modified is the correct outcome.
		assert!(status.contains("1 MM") && status.contains("f.txt"), "{status}");
		// Blank patches are no-ops; bad patches surface git's message.
		apply_index_patch("/tmp".to_string(), "  ".to_string())
			.await
			.unwrap();
		let err = apply_index_patch("/tmp".to_string(), "bogus".to_string())
			.await
			.unwrap_err();
		assert!(err.contains("git apply failed"), "{err}");
	}

	#[tokio::test]
	async fn commit_records_message() {
		let dir = fixture();
		let root = dir.to_str().unwrap().to_string();
		stage_paths(root.clone(), vec!["f.txt".to_string()])
			.await
			.unwrap();
		commit(root.clone(), "m3 test commit".to_string())
			.await
			.unwrap();
		let log = run_git(&root, &["log", "--format=%s", "-1"]).unwrap();
		assert!(log.contains("m3 test commit"), "{log}");
	}

		#[tokio::test]
	async fn concurrent_writes_all_succeed() {		let dir = fixture();
		let root = dir.to_str().unwrap().to_string();
		// Ten overlapping stage/unstage pairs through the per-repo lane:
		// every op resolves, none interleaves the index into an error.
		let mut handles = Vec::new();
		for _ in 0..10 {
			let root = root.clone();
			handles.push(tokio::spawn(async move {
				stage_paths(root.clone(), vec!["f.txt".to_string()]).await?;
				unstage_paths(root, vec!["f.txt".to_string()]).await
			}));
		}
		for handle in handles {
			handle.await.expect("task panicked").unwrap();
		}
	}

	#[test]
	fn lane_key_unifies_spellings() {
		let dir = std::env::temp_dir();
		let dotted = dir.join("..").join(
			dir.file_name()
				.unwrap_or_default()
				.to_string_lossy()
				.as_ref(),
		);
		assert_eq!(
			lane_key(dir.to_str().unwrap()),
			lane_key(dotted.to_str().unwrap())
		);
		// Missing paths fall back to the raw string (git reports the error).
		assert_eq!(
			lane_key("/no/such/dir-ever"),
			"/no/such/dir-ever".to_string()
		);
	}

	#[test]
	fn lane_key_unifies_subdirectories() {
		// A subdirectory resolves to the same worktree lane as the root.
		let base = std::env::temp_dir().join(format!(
			"tauri-lane-fixture-{}",
			std::time::SystemTime::now()
				.duration_since(std::time::UNIX_EPOCH)
				.map(|d| d.as_nanos())
				.unwrap_or(0)
		));
		std::fs::create_dir_all(base.join("sub")).unwrap();
		let git = |args: &[&str], dir: &std::path::Path| {
			git_command()
				.args(args)
				.current_dir(dir)
				.env("GIT_CONFIG_NOSYSTEM", "1")
				.output()
				.unwrap()
		};
		assert!(git(&["init", "-b", "main"], &base).status.success());
		assert_eq!(
			lane_key(base.to_str().unwrap()),
			lane_key(base.join("sub").to_str().unwrap())
		);
		let _ = std::fs::remove_dir_all(&base);
	}

	#[tokio::test]
	async fn bracket_paths_stage_literally() {
		let dir = fixture();
		let root = dir.to_str().unwrap().to_string();
		std::fs::create_dir_all(dir.join("app").join("[id]")).unwrap();
		std::fs::create_dir_all(dir.join("app").join("i")).unwrap();
		std::fs::write(dir.join("app").join("[id]").join("page.tsx"), "x\n").unwrap();
		std::fs::write(dir.join("app").join("i").join("page.tsx"), "x\n").unwrap();
		// Without GIT_LITERAL_PATHSPECS the [id] class would also match i/.
		stage_paths(root.clone(), vec!["app/[id]/page.tsx".to_string()])
			.await
			.unwrap();
		let status = git_status(root).await.unwrap();
		assert!(status.contains("app/[id]/page.tsx"), "{status}");
		// The lookalike stays untracked: no staged/unstaged record for it.
		assert!(status.contains("? app/i/page.tsx"), "{status}");
		assert!(
			!status
				.split('\0')
				.any(|r| r.contains("app/i/page.tsx") && !r.starts_with('?')),
			"{status}"
		);
	}

	#[tokio::test]
	async fn location_env_never_redirects() {
		// The scrub contract, asserted structurally: every git child is
		// built by git_command(), which removes the location variables.
		// (Deliberately no process-env mutation here: set_var races with
		// parallel tests sharing the process environment.)
		let removed: Vec<String> = git_command()
			.get_envs()
			.filter_map(|(key, value)| {
				if value.is_none() {
					key.to_str().map(String::from)
				} else {
					None
				}
			})
			.collect();
		for var in [
			"GIT_DIR",
			"GIT_WORK_TREE",
			"GIT_INDEX_FILE",
			"GIT_OBJECT_DIRECTORY",
			"GIT_COMMON_DIR",
		] {
			assert!(removed.iter().any(|k| k == var), "{removed:?}");
		}
		// And the lane still resolves the fixture worktree on its own.
		let dir = fixture();
		let root = dir.to_str().unwrap().to_string();
		let key = lane_key(&root);
		assert!(
			key.ends_with(dir.file_name().unwrap().to_str().unwrap()),
			"{key}"
		);
	}

	#[tokio::test]
	async fn remote_branches_list_and_check_out() {
		let dir = fixture();
		let root = dir.to_str().unwrap().to_string();
		let git = |args: &[&str]| {
			git_command()
				.args(args)
				.current_dir(&dir)
				.env("GIT_CONFIG_NOSYSTEM", "1")
				.output()
				.unwrap()
		};
		let origin = dir.parent().unwrap().join(format!(
			"tauri-remote-origin-{}",
			std::time::SystemTime::now()
				.duration_since(std::time::UNIX_EPOCH)
				.map(|d| d.as_nanos())
				.unwrap_or(0)
		));
		std::fs::create_dir_all(&origin).unwrap();
		// NOTE: runs in the ORIGIN dir, not the worktree.
		assert!(
			git_command()
				.args(["init", "--bare", "-q", "-b", "main"])
				.current_dir(&origin)
				.env("GIT_CONFIG_NOSYSTEM", "1")
				.output()
				.unwrap()
				.status
				.success()
		);
		assert!(git(&["checkout", "-qb", "feature"]).status.success());
		std::fs::write(dir.join("g.txt"), "feat\n").unwrap();
		assert!(git(&["add", "-A"]).status.success());
		assert!(git(&["commit", "-qm", "feat"]).status.success());
		assert!(
			git(&[
				"remote",
				"add",
				"origin",
				&origin.to_string_lossy()
			])
			.status
			.success()
		);
		assert!(git(&["push", "-q", "origin", "main", "feature"]).status.success());
		assert!(git(&["checkout", "-q", "main"]).status.success());

		let list = git_branches(root.clone()).await.unwrap();
		let tracked = list
			.iter()
			.find(|b| b.name == "origin/feature")
			.expect("remote-tracking entry listed");
		assert!(tracked.remote);
		assert!(!tracked.current);

		// Checkout creates the tracking branch and moves HEAD onto it.
		git_switch_remote_branch(root.clone(), "origin/feature".to_string())
			.await
			.unwrap();
		let info = read_repo(root.clone()).await.unwrap();
		assert_eq!(info.branch, "feature");

		// Second time the short name exists: plain switch, same result.
		git_switch_branch(root.clone(), "main".to_string())
			.await
			.unwrap();
		git_switch_remote_branch(root.clone(), "origin/feature".to_string())
			.await
			.unwrap();
		assert_eq!(read_repo(root.clone()).await.unwrap().branch, "feature");

		// Shapes that are not remote-tracking refs refuse.
		assert!(git_switch_remote_branch(root.clone(), "main".to_string())
			.await
			.is_err());
		assert!(git_switch_remote_branch(root.clone(), "".to_string())
			.await
			.is_err());
		assert!(git_switch_remote_branch(root.clone(), "-x/y".to_string())
			.await
			.is_err());
	}

	#[tokio::test]
	async fn unmerged_paths_list_once() {
		let dir = fixture();
		let root = dir.to_str().unwrap().to_string();
		let git = |args: &[&str]| {
			git_command()
				.args(args)
				.current_dir(&dir)
				.env("GIT_CONFIG_NOSYSTEM", "1")
				.output()
				.unwrap()
		};
		// Diverge f.txt on two branches, then merge into conflict: the
		// path sits unmerged in the index (stages 1-3), which ls-files
		// would list once per stage without --deduplicate.
		assert!(git(&["checkout", "-qb", "other"]).status.success());
		std::fs::write(dir.join("f.txt"), "other\n").unwrap();
		assert!(git(&["commit", "-qam", "other"]).status.success());
		assert!(git(&["checkout", "-q", "main"]).status.success());
		std::fs::write(dir.join("f.txt"), "main\n").unwrap();
		assert!(git(&["commit", "-qam", "main"]).status.success());
		assert!(!git(&["merge", "other"]).status.success());
		let raw = git_worktree_paths(root).await.unwrap();
		let hits: Vec<&str> = raw.split('\0').filter(|r| *r == "f.txt").collect();
		assert_eq!(hits.len(), 1, "{raw:?}");
	}
}
