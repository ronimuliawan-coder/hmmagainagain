// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod git;

#[tauri::command]
fn greet(name: &str) -> String {
	format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	tauri::Builder::default()
		.plugin(tauri_plugin_opener::init())
		.invoke_handler(tauri::generate_handler![
			greet,
			git::read_repo,
			git::git_status,
			git::git_worktree_paths,
			git::git_diff
		])
		.run(tauri::generate_context!())
		.expect("error while running tauri application");
}
