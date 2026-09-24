// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod git;
mod remote;
mod watch;

#[tauri::command]
fn greet(name: &str) -> String {
	format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	tauri::Builder::default()
		.plugin(tauri_plugin_opener::init())
		.plugin(tauri_plugin_dialog::init())
		.invoke_handler(tauri::generate_handler![
			greet,
			git::read_repo,
			git::git_status,
			git::git_worktree_paths,
			git::git_diff_start,
			git::git_diff_abort,
			git::git_diff_result,
			git::git_log_stream,
			git::git_branches,
			git::git_create_branch,
			git::git_switch_branch,
			git::stage_paths,
			git::unstage_paths,
			git::apply_index_patch,
			git::commit,
			remote::git_remote_start,
			remote::git_remote_abort,
			remote::git_remote_result,
			watch::watch_start,
			watch::watch_stop
		])
		.run(tauri::generate_context!())
		.expect("error while running tauri application");
}
