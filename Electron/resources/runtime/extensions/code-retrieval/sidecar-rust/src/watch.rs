use crate::util::{join_project, rel_has_skip_component, to_project_rel};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub enum WatchOp {
    Upsert(String),
    Delete(String),
}

pub fn spawn_watcher(
    project_root: PathBuf,
    engine: Arc<Mutex<crate::engine::Engine>>,
) -> Result<(), String> {
    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
    let mut watcher = RecommendedWatcher::new(tx, notify::Config::default())
        .map_err(|e| e.to_string())?;
    watcher
        .watch(&project_root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    std::thread::Builder::new()
        .name("tantivy-watch".into())
        .spawn(move || {
            // Keep watcher alive for the process lifetime.
            let _watcher = watcher;
            loop {
                let mut ops: Vec<WatchOp> = Vec::new();
                match rx.recv_timeout(Duration::from_millis(80)) {
                    Ok(ev) => collect_event(&project_root, ev, &mut ops),
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => break,
                }
                while let Ok(ev) = rx.try_recv() {
                    collect_event(&project_root, ev, &mut ops);
                }
                if ops.is_empty() {
                    continue;
                }
                apply_ops(&project_root, &engine, ops);
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn collect_event(project_root: &Path, ev: notify::Result<Event>, ops: &mut Vec<WatchOp>) {
    let Ok(event) = ev else { return };
    let deleted = matches!(event.kind, EventKind::Remove(_));
    for abs in event.paths {
        let Some(rel) = to_project_rel(project_root, &abs) else {
            continue;
        };
        if rel_has_skip_component(&rel) {
            continue;
        }
        if deleted || !abs.exists() {
            ops.push(WatchOp::Delete(rel));
        } else if abs.is_file() {
            ops.push(WatchOp::Upsert(rel));
        } else if abs.is_dir() {
            // New directory: index immediate text files; recursive create events follow.
            if let Ok(rd) = std::fs::read_dir(&abs) {
                for entry in rd.flatten() {
                    let p = entry.path();
                    if p.is_file() {
                        if let Some(child) = to_project_rel(project_root, &p) {
                            if !rel_has_skip_component(&child) {
                                ops.push(WatchOp::Upsert(child));
                            }
                        }
                    }
                }
            }
        }
    }
}

fn apply_ops(
    project_root: &Path,
    engine: &Arc<Mutex<crate::engine::Engine>>,
    ops: Vec<WatchOp>,
) {
    let mut seen = HashSet::new();
    // Last op per path wins.
    let mut last: Vec<WatchOp> = Vec::new();
    for op in ops.into_iter().rev() {
        let key = match &op {
            WatchOp::Upsert(p) | WatchOp::Delete(p) => p.clone(),
        };
        if !seen.insert(key) {
            continue;
        }
        last.push(op);
    }
    last.reverse();
    let Ok(mut eng) = engine.lock() else {
        return;
    };
    for op in last {
        match op {
            WatchOp::Upsert(rel) => {
                let abs = join_project(project_root, &rel);
                if abs.is_file() {
                    let _ = eng.update_overlay_from_disk(&rel);
                }
            }
            WatchOp::Delete(rel) => {
                let _ = eng.delete_overlay_path(&rel, true);
            }
        }
    }
}
