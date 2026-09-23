// M1 git commands (RON-400): thin shells over the system git binary,
// mirroring the spawnGit argv contract (arrays only, cwd pinned to root,
// verbatim stderr). Parsing stays in TypeScript for M1 (existing pure
// parsers); M2 ports it with fixture oracles. Anything not listed here
// rejects on the TS side until its owning unit lands.

use std::process::Command;

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

fn reject_dash(value: &Option<String>, what: &str) -> Result<(), String> {
	if value.as_deref().is_some_and(|v| v.starts_with('-')) {
		return Err(format!("invalid {what}: must not start with '-': {value:?}"));
	}
	Ok(())
}

#[tauri::command]
pub fn read_repo(root: String) -> Result<RepoInfo, String> {
	let branch = run_git(&root, &["rev-parse", "--abbrev-ref", "HEAD"])?;
	let head = run_git(&root, &["rev-parse", "HEAD"])?;
	Ok(RepoInfo {
		branch: branch.trim().to_string(),
		head: head.trim().to_string(),
	})
}

#[tauri::command]
pub fn git_status(root: String) -> Result<String, String> {
	run_git(&root, &["status", "--porcelain=v2", "--branch", "-z"])
}

#[tauri::command]
pub fn git_worktree_paths(root: String) -> Result<String, String> {
	run_git(
		&root,
		&["ls-files", "-co", "--exclude-standard", "-z"],
	)
}

#[tauri::command]
pub fn git_diff(
	root: String,
	staged: bool,
	from: Option<String>,
	to: Option<String>,
) -> Result<String, String> {
	reject_dash(&from, "from ref")?;
	reject_dash(&to, "to ref")?;
	let mut args: Vec<&str> = vec!["diff"];
	if staged {
		args.push("--cached");
	} else if let Some(f) = from.as_deref() {
		args.push(f);
		if let Some(t) = to.as_deref() {
			args.push(t);
		}
	}
	run_git(&root, &args)
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

	#[test]
	fn read_repo_reports_branch_and_head() {
		let dir = fixture();
		let root = dir.to_str().unwrap().to_string();
		let info = read_repo(root).unwrap();
		assert_eq!(info.branch, "main");
		assert_eq!(info.head.len(), 40);
	}

	#[test]
	fn non_repo_rejects() {
		let err = read_repo("/no/such/dir-ever".to_string()).unwrap_err();
		assert!(err.contains("exit") || err.contains("spawn"), "{err}");
	}

	#[test]
	fn status_and_paths_and_diff_agree() {
		let dir = fixture();
		let root = dir.to_str().unwrap().to_string();
		let status = git_status(root.clone()).unwrap();
		assert!(status.contains(".M") && status.contains("f.txt"), "{status}");
		let paths = git_worktree_paths(root.clone()).unwrap();
		assert!(paths.split('\0').any(|p| p == "f.txt"), "{paths}");
		let patch = git_diff(root, false, None, None).unwrap();
		assert!(patch.contains("+two"), "{patch}");
	}

	#[test]
	fn dash_refs_reject() {
		let err = git_diff(
			"/tmp".to_string(),
			false,
			Some("--upload-pack=x".to_string()),
			None,
		)
		.unwrap_err();
		assert!(err.contains("must not start with"), "{err}");
	}
}
