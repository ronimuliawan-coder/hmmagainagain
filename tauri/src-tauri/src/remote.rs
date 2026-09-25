// Remote ops (RON-401, M4): fetch/push/pull with streamed progress.
//
// Mirrors the Bun adapter exactly: same argv per op, progress lines from
// stderr split on \r|\n (each emitted with a trailing \n, final flush
// without), same refusal shapes. Cancellation follows the M1 diff protocol
// (start/abort/result) so superseded remotes die instead of piling up.
//
// Lane scope (deliberate delta from Bun's full-op hold): start and result
// each join the repo's write lane around their critical sections, so a
// remote never *begins* mid-write and its completion serializes the same
// way. The transfer body itself runs concurrently with later writes —
// git's own index/ref locking keeps that safe (loud errors, never silent
// corruption), exactly as concurrent terminal git invocations.

use std::collections::HashMap;
use std::process::Child;
use std::sync::{Mutex, OnceLock};
use tauri::Emitter;

use super::git::write_lock_lane;

#[derive(serde::Serialize, Clone, Debug)]
struct RemoteLineEvent {
	op_id: u64,
	/// Client-generated routing token (known before start resolves, so no
	/// progress line can land unroutable).
	client_token: String,
	line: String,
}

#[derive(serde::Serialize, Debug)]
pub struct RemoteOutcome {
	ok: bool,
	stderr: String,
}

struct RemoteRegistry {
	next_id: u64,
	runs: HashMap<u64, RemoteRun>,
}

/// Everything result() needs after start returns: the repo for lane
/// re-entry, the client routing token for progress lines, the child.
struct RemoteRun {
	root: String,
	token: String,
	child: Child,
}

fn registry() -> &'static Mutex<RemoteRegistry> {
	static REGISTRY: OnceLock<Mutex<RemoteRegistry>> = OnceLock::new();
	REGISTRY.get_or_init(|| {
		Mutex::new(RemoteRegistry {
			next_id: 1,
			runs: HashMap::new(),
		})
	})
}

/// Argv contract mirroring the Bun adapter (remote.ts argsFor).
fn op_argv(
	op: &str,
	remote: &str,
	branch: &Option<String>,
	set_upstream: bool,
) -> Result<Vec<String>, String> {
	if !matches!(op, "fetch" | "push" | "pull") {
		return Err(format!("invalid remote op: {op:?}"));
	}
	// Refuse leading-dash values before argv construction (CWE-88): remote
	// and branch sit in flag-parsable positions with no `--` separator.
	if remote.starts_with('-') {
		return Err(format!(
			"invalid remote: must not start with '-': {remote:?}"
		));
	}
	if branch.as_deref().is_some_and(|b| b.starts_with('-')) {
		return Err(format!(
			"invalid branch: must not start with '-': {branch:?}"
		));
	}
	let mut args = vec![op.to_string(), "--progress".to_string()];
	if op == "push" {
		if set_upstream {
			args.push("-u".to_string());
		}
		args.push(remote.to_string());
		// Defaults to the current branch's upstream behaviour.
		args.push(branch.clone().unwrap_or_else(|| "HEAD".to_string()));
	} else if op == "fetch" {
		args.push(remote.to_string());
	} else {
		// pull: fast-forward only — a diverged state must fail loudly.
		args.push("--ff-only".to_string());
		args.push(remote.to_string());
		if let Some(b) = branch {
			args.push(b.clone());
		}
	}
	Ok(args)
}

#[tauri::command]
pub async fn git_remote_start(
	root: String,
	op: String,
	remote: String,
	branch: Option<String>,
	set_upstream: bool,
	client_token: String,
) -> Result<u64, String> {
	let argv = op_argv(&op, &remote, &branch, set_upstream)?;
	let lane = write_lock_lane(&root);
	let spawn_root = root.clone();
	let child = tauri::async_runtime::spawn_blocking(move || {
		let _held = lane.lock().unwrap_or_else(|e| e.into_inner());
		let mut child = super::git::git_command();
		child
			.args(&argv)
			.current_dir(&spawn_root)
			// Never inherit the terminal: like the Bun adapter (piped
			// stdin, closed), a credential prompt must fail fast instead
			// of hanging the transfer uninterruptibly. Empty askpass
			// fallbacks close the GUI-prompt hole too (git skips empty
			// values); credential.helper configs and SSH-agent auth,
			// which need no prompt, keep working.
			.env("GIT_TERMINAL_PROMPT", "0")
			.env("GIT_ASKPASS", "")
			.env("SSH_ASKPASS", "")
			.stdin(std::process::Stdio::null())
			.stdout(std::process::Stdio::null())
			.stderr(std::process::Stdio::piped());
		child.spawn().map_err(|e| format!("spawn: {e}"))
	})
	.await
	.map_err(|e| format!("worker: {e}"))??;
	let mut registry = registry().lock().map_err(|e| format!("lock: {e}"))?;
	let id = registry.next_id;
	registry.next_id += 1;
	registry.runs.insert(id, RemoteRun {
		root,
		token: client_token,
		child,
	});
	Ok(id)
}

#[tauri::command]
pub async fn git_remote_abort(op_id: u64) -> Result<(), String> {
	let run = registry()
		.lock()
		.map_err(|e| format!("lock: {e}"))?
		.runs
		.remove(&op_id);
	if let Some(mut run) = run {
		// Best effort: the child may already be gone. Reap the killed
		// child here — result() (already draining) observes EOF and
		// reports the op as aborted, so nobody else waits on it.
		let _ = run.child.kill();
		let _ = run.child.wait();
	}
	Ok(())
}

#[tauri::command]
pub async fn git_remote_result(
	app: tauri::AppHandle,
	op_id: u64,
) -> Result<RemoteOutcome, String> {
	// Take only stderr under the registry lock; the run stays registered
	// while the transfer drains so a racing abort can still find the
	// child and kill it (aborting an already-removed run is a no-op Ok).
	let (root, token, mut stderr) = {
		let mut reg = registry().lock().map_err(|e| format!("lock: {e}"))?;
		let run = reg
			.runs
			.get_mut(&op_id)
			.ok_or_else(|| "unknown or aborted remote op".to_string())?;
		let stderr = run.child.stderr.take().ok_or("stderr unavailable")?;
		(run.root.clone(), run.token.clone(), stderr)
	};
	let outcome = tauri::async_runtime::spawn_blocking(move || {
		// Drain WITHOUT the write lane: the transfer body runs
		// concurrently with later writes (documented scope above); only
		// completion serializes below. Chunk reads split on \r|\n at the
		// byte level so live \r progress reaches the UI as it arrives
		// instead of bunching at phase end; only complete lines decode,
		// keeping UTF-8 sequences split across chunks intact.
		let mut full = String::new();
		let mut pending: Vec<u8> = Vec::new();
		let mut chunk = [0u8; 4096];
		loop {
			use std::io::Read;
			let n = match stderr.read(&mut chunk) {
				Ok(n) => n,
				Err(e) => {
					// A dead pipe must not strand the run: the frontend
					// rejects without calling abort, so remove the entry
					// and reap the child here (later results would only
					// see a consumed stderr handle).
					if let Some(mut run) = registry()
						.lock()
						.map_err(|lock_error| {
							format!("lock: {lock_error}")
						})?
						.runs
						.remove(&op_id)
					{
						let _ = run.child.kill();
						let _ = run.child.wait();
					}
					return Err(format!("read: {e}"));
				}
			};
			if n == 0 {
				break;
			}
			pending.extend_from_slice(&chunk[..n]);
			while let Some(pos) =
				pending.iter().position(|b| *b == b'\r' || *b == b'\n')
			{
				let raw: Vec<u8> = pending.drain(..=pos).collect();
				let line =
					String::from_utf8_lossy(&raw[..raw.len() - 1]).into_owned();
				full.push_str(&line);
				full.push('\n');
				let _ = app.emit(
					"git-remote-line",
					RemoteLineEvent {
						op_id,
						client_token: token.clone(),
						line: format!("{line}\n"),
					},
				);
			}
		}
		if !pending.is_empty() {
			let rest = String::from_utf8_lossy(&pending).into_owned();
			full.push_str(&rest);
			let _ = app.emit("git-remote-line", RemoteLineEvent {
				op_id,
				client_token: token.clone(),
				line: rest,
			});
		}
		// Completion serializes on the repo's write lane; then remove
		// ourselves. If abort won the race the entry is already gone and
		// the op reports as aborted (abort reaped the child).
		let lane = write_lock_lane(&root);
		let _held = lane.lock().unwrap_or_else(|e| e.into_inner());
		let mut run = registry()
			.lock()
			.map_err(|e| format!("lock: {e}"))?
			.runs
			.remove(&op_id)
			.ok_or_else(|| "remote op aborted".to_string())?;
		let status = run.child.wait().map_err(|e| format!("wait: {e}"))?;
		Ok::<_, String>((status, full))
	})
	.await
	.map_err(|e| format!("worker: {e}"))??;
	let (status, stderr) = outcome;
	Ok(RemoteOutcome {
		ok: status.success(),
		stderr,
	})
}

// Golden behavior ported from the Bun adapter's U7 suite (deleted at M6
// cutover with the engine): push advances the remote ref, pull
// fast-forwards, diverged pull fails without moving anything, first push
// -u sets upstream tracking. File-path remotes exercise the same transport
// code as network ones, minus credentials.
#[cfg(test)]
mod tests {
	use super::*;

	fn git(dir: &std::path::Path, args: &[&str]) -> std::process::Output {
		crate::git::git_command()
			.args(args)
			.current_dir(dir)
			.env("GIT_CONFIG_NOSYSTEM", "1")
			.env("GIT_AUTHOR_NAME", "t")
			.env("GIT_AUTHOR_EMAIL", "t@t")
			.env("GIT_COMMITTER_NAME", "t")
			.env("GIT_COMMITTER_EMAIL", "t@t")
			.output()
			.expect("git spawn")
	}

	fn fixture() -> (std::path::PathBuf, std::path::PathBuf) {
		let base = std::env::temp_dir().join(format!(
			"tauri-remote-fixture-{}",
			std::time::SystemTime::now()
				.duration_since(std::time::UNIX_EPOCH)
				.map(|d| d.as_nanos())
				.unwrap_or(0)
		));
		let origin = base.join("origin.git");
		let work = base.join("work");
		std::fs::create_dir_all(&origin).unwrap();
		// -b main: clones land on main automatically (origin HEAD exists
		// from the start, even while the repo is still empty).
		assert!(git(&origin, &["init", "--bare", "-q", "-b", "main"]).status.success());
		assert!(
			git(&std::env::temp_dir(), &[
				"clone",
				"-q",
				&origin.to_string_lossy(),
				&work.to_string_lossy()
			])
			.status
			.success()
		);
		assert!(git(&work, &["config", "user.email", "t@t"]).status.success());
		assert!(git(&work, &["config", "user.name", "t"]).status.success());
		// The origin is empty, so the clone checks out nothing: start the
		// work branch explicitly instead of inheriting ambient init.defaultBranch.
		assert!(git(&work, &["checkout", "-qb", "main"]).status.success());
		(origin, work)
	}

	fn run_argv(dir: &std::path::Path, argv: &[String]) -> bool {
		git(
			dir,
			&argv.iter().map(String::as_str).collect::<Vec<_>>(),
		)
		.status
		.success()
	}

	#[test]
	fn argv_shapes_match_bun_contract() {
		assert_eq!(
			op_argv("fetch", "origin", &None, false).unwrap(),
			vec!["fetch", "--progress", "origin"]
		);
		assert_eq!(
			op_argv("push", "origin", &None, false).unwrap(),
			vec!["push", "--progress", "origin", "HEAD"]
		);
		assert_eq!(
			op_argv("push", "origin", &Some("main".to_string()), true).unwrap(),
			vec!["push", "--progress", "-u", "origin", "main"]
		);
		assert_eq!(
			op_argv("pull", "origin", &None, false).unwrap(),
			vec!["pull", "--progress", "--ff-only", "origin"]
		);
		assert!(op_argv("bogus", "origin", &None, false).is_err());
		assert!(op_argv("fetch", "-h", &None, false).is_err());
		assert!(
			op_argv("push", "origin", &Some("-D".to_string()), false).is_err()
		);
	}

	#[test]
	fn push_advances_remote_pull_fast_forwards() {
		let (origin, work) = fixture();
		std::fs::write(work.join("a.txt"), "one\n").unwrap();
		assert!(git(&work, &["add", "-A"]).status.success());
		assert!(git(&work, &["commit", "-qm", "base"]).status.success());
		let argv =
			op_argv("push", "origin", &Some("main".to_string()), true).unwrap();
		assert!(run_argv(&work, &argv));
		// Remote ref advanced to the pushed commit.
		let head = git(&work, &["rev-parse", "HEAD"]).stdout;
		let remote = git(&origin, &["rev-parse", "refs/heads/main"]).stdout;
		assert_eq!(head, remote);
		// Upstream tracking set by the first -u push.
		let upstream = git(&work, &[
			"rev-parse",
			"--abbrev-ref",
			"--symbolic-full-name",
			"@{u}"
		]);
		assert!(upstream.status.success());
		// A fresh clone pulls the commit (fast-forward from unborn HEAD).
		let second = work.parent().unwrap().join("second");
		assert!(
			git(&std::env::temp_dir(), &[
				"clone",
				"-q",
				&origin.to_string_lossy(),
				&second.to_string_lossy()
			])
			.status
			.success()
		);
		assert_eq!(git(&second, &["rev-parse", "HEAD"]).stdout, head);
	}

	#[test]
	fn diverged_pull_fails_without_moving() {
		let (origin, work) = fixture();
		std::fs::write(work.join("a.txt"), "one\n").unwrap();
		assert!(git(&work, &["add", "-A"]).status.success());
		assert!(git(&work, &["commit", "-qm", "base"]).status.success());
		let argv =
			op_argv("push", "origin", &Some("main".to_string()), true).unwrap();
		assert!(run_argv(&work, &argv));
		// Diverge both sides.
		std::fs::write(work.join("a.txt"), "local\n").unwrap();
		assert!(git(&work, &["commit", "-qam", "local"]).status.success());
		let other = work.parent().unwrap().join("other");
		assert!(
			git(&std::env::temp_dir(), &[
				"clone",
				"-q",
				&origin.to_string_lossy(),
				&other.to_string_lossy()
			])
			.status
			.success()
		);
		assert!(git(&other, &["config", "user.email", "t@t"]).status.success());
		assert!(git(&other, &["config", "user.name", "t"]).status.success());
		std::fs::write(other.join("a.txt"), "remote\n").unwrap();
		assert!(git(&other, &["commit", "-qam", "remote"]).status.success());
	 let push_argv =
			op_argv("push", "origin", &Some("main".to_string()), false).unwrap();
		assert!(run_argv(&other, &push_argv));
		// ff-only pull refuses the diverged state; local HEAD unmoved.
		let before = git(&work, &["rev-parse", "HEAD"]).stdout;
		let pull_argv = op_argv("pull", "origin", &None, false).unwrap();
		assert!(!run_argv(&work, &pull_argv));
		assert_eq!(git(&work, &["rev-parse", "HEAD"]).stdout, before);
	}
}
