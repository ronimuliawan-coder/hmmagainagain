// Repository watcher (RON-401, M4): recursive fs watch with the Bun
// adapter's debounce contract — first event opens a fixed 100ms window,
// every path in the window ships as one batch, then the cycle repeats.
// Paths are root-relative, deduplicated, insertion-ordered.

use notify::Watcher;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{
	Arc, Mutex, OnceLock,
	atomic::{AtomicBool, Ordering},
	mpsc,
};
use tauri::Emitter;

#[derive(serde::Serialize, Clone, Debug)]
struct FsEventsEvent {
	watch_id: String,
	paths: Vec<String>,
}

struct WatchRegistry {
	/// watch_id (client-generated) → stop flag for its thread.
	stops: HashMap<String, Arc<AtomicBool>>,
}

fn registry() -> &'static Mutex<WatchRegistry> {
	static REGISTRY: OnceLock<Mutex<WatchRegistry>> = OnceLock::new();
	REGISTRY.get_or_init(|| Mutex::new(WatchRegistry { stops: HashMap::new() }))
}

/// Root-relative path strings for one notify event; skips the unmappable.
fn relative_paths(root: &str, event: &notify::Event) -> Vec<String> {
	let base = Path::new(root);
	event
		.paths
		.iter()
		.filter_map(|p| {
			p.strip_prefix(base)
				.ok()
				.map(|rel| rel.to_string_lossy().into_owned())
		})
		.filter(|p| !p.is_empty())
		.collect()
}

/// Collects one debounced batch: blocks for the first event, then drains
/// everything arriving within the fixed window. Returns None when stopped
/// with nothing pending.
fn next_batch(
	rx: &mpsc::Receiver<Result<notify::Event, notify::Error>>,
	stop: &AtomicBool,
	root: &str,
) -> Option<Vec<String>> {
	let mut pending: Vec<String> = Vec::new();
	// Wait for the window opener, noticing stop while idle.
	loop {
		if stop.load(Ordering::Relaxed) {
			return None;
		}
		match rx.recv_timeout(std::time::Duration::from_millis(500)) {
			Ok(Ok(event)) => {
				for path in relative_paths(root, &event) {
					if !pending.contains(&path) {
						pending.push(path);
					}
				}
				break;
			}
			Ok(Err(_)) => continue,
			Err(_) => continue,
		}
	}
	// Fixed (non-sliding) 100ms window, mirroring the Bun adapter.
	std::thread::sleep(std::time::Duration::from_millis(100));
	while let Ok(result) = rx.try_recv() {
		if let Ok(event) = result {
			for path in relative_paths(root, &event) {
				if !pending.contains(&path) {
					pending.push(path);
				}
			}
		}
	}
	if stop.load(Ordering::Relaxed) {
		return None;
	}
	Some(pending)
}

#[tauri::command]
pub async fn watch_start(
	app: tauri::AppHandle,
	root: String,
	watch_id: String,
) -> Result<(), String> {
	let (tx, rx) = mpsc::channel();
	let mut watcher =
		notify::RecommendedWatcher::new(tx, notify::Config::default())
			.map_err(|e| format!("watch: {e}"))?;
	watcher
		.watch(Path::new(&root), notify::RecursiveMode::Recursive)
		.map_err(|e| format!("watch: {e}"))?;
	let stop = Arc::new(AtomicBool::new(false));
	registry()
		.lock()
		.map_err(|e| format!("lock: {e}"))?
		.stops
		.insert(watch_id.clone(), stop.clone());
	std::thread::spawn(move || {
		// The watcher must stay alive: dropping it unwatches.
		let _watcher = watcher;
		while let Some(paths) = next_batch(&rx, &stop, &root) {
			if paths.is_empty() {
				continue;
			}
			let _ = app.emit("fs-events", FsEventsEvent {
				watch_id: watch_id.clone(),
				paths,
			});
		}
	});
	Ok(())
}

#[tauri::command]
pub async fn watch_stop(watch_id: String) -> Result<(), String> {
	let removed = registry()
		.lock()
		.map_err(|e| format!("lock: {e}"))?
		.stops
		.remove(&watch_id);
	if let Some(stop) = removed {
		stop.store(true, Ordering::Relaxed);
	}
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;

	fn test_event(paths: &[&str]) -> notify::Event {
		notify::Event {
			kind: notify::EventKind::Any,
			paths: paths.iter().map(std::path::PathBuf::from).collect(),
			attrs: Default::default(),
		}
	}

	#[test]
	fn batch_collects_burst_into_one_window() {
		let (tx, rx) = mpsc::channel();
		let stop = AtomicBool::new(false);
		tx.send(Ok(test_event(&["/r/a.txt"]))).unwrap();
		tx.send(Ok(test_event(&["/r/b.txt", "/r/a.txt"]))).unwrap();
		let batch = next_batch(&rx, &stop, "/r").unwrap();
		assert_eq!(batch, vec!["a.txt", "b.txt"]);
	}

	#[test]
	fn stop_with_no_events_yields_none() {
		let (_tx, rx) = mpsc::channel::<Result<notify::Event, notify::Error>>();
		let stop = AtomicBool::new(true);
		assert!(next_batch(&rx, &stop, "/r").is_none());
	}

	#[test]
	fn relative_paths_skip_outside_paths() {
		let event = test_event(&["/r/a.txt", "/elsewhere/b.txt"]);
		assert_eq!(relative_paths("/r", &event), vec!["a.txt"]);
	}
}
