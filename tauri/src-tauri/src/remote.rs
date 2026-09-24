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
	let mut registry = registry().lock().map_err(|e| format!("lock: {e}"))?;
	if let Some(mut run) = registry.runs.remove(&op_id) {
		// Best effort: the child may already be gone.
		let _ = run.child.kill();
	}
	Ok(())
}

#[tauri::command]
pub async fn git_remote_result(
	app: tauri::AppHandle,
	op_id: u64,
) -> Result<RemoteOutcome, String> {
	let run = registry()
		.lock()
		.map_err(|e| format!("lock: {e}"))?
		.runs
		.remove(&op_id)
		.ok_or_else(|| "unknown or aborted remote op".to_string())?;
	let lane = write_lock_lane(&run.root);
	let token = run.token;
	let mut child = run.child;
	let outcome = tauri::async_runtime::spawn_blocking(move || {
		let _held = lane.lock().unwrap_or_else(|e| e.into_inner());
		let stderr = child.stderr.take().ok_or("stderr unavailable")?;
		let mut reader = std::io::BufReader::new(stderr);
		let mut full = String::new();
		let mut rest = String::new();
		let mut buf = Vec::new();
		loop {
			use std::io::BufRead;
			buf.clear();
			let n = reader
				.read_until(b'\n', &mut buf)
				.map_err(|e| format!("read: {e}"))?;
			if n == 0 {
				break;
			}
			rest.push_str(&String::from_utf8_lossy(&buf));
			// Git progress uses \r as well as \n over pipes.
			let mut parts: Vec<String> =
				rest.split(['\r', '\n']).map(str::to_string).collect();
			rest = parts.pop().unwrap_or_default();
			for line in &parts {
				full.push_str(line);
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
		if !rest.is_empty() {
			full.push_str(&rest);
			let _ = app.emit("git-remote-line", RemoteLineEvent {
				op_id,
				client_token: token.clone(),
				line: rest,
			});
		}
		let status = child.wait().map_err(|e| format!("wait: {e}"))?;
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
