use crate::util::{
    is_skip_dir_name, join_project, should_ignore_watch_rel, to_project_rel, walk_text_files_from,
};
use notify::event::{ModifyKind, RenameMode};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const DEFAULT_WATCH_DEBOUNCE_MS: u64 = 80;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WatchOp {
    Upsert(String),
    Delete(String),
}

impl WatchOp {
    pub fn path(&self) -> &str {
        match self {
            WatchOp::Upsert(p) | WatchOp::Delete(p) => p,
        }
    }
}

pub fn watch_debounce() -> Duration {
    let ms = std::env::var("PIPIUI_CODE_RETRIEVAL_WATCH_DEBOUNCE_MS")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .filter(|n| *n > 0)
        .unwrap_or(DEFAULT_WATCH_DEBOUNCE_MS)
        .min(5_000);
    Duration::from_millis(ms)
}

pub fn spawn_watcher(
    project_root: PathBuf,
    engine: Arc<Mutex<crate::engine::Engine>>,
) -> Result<(), String> {
    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
    let mut watcher = RecommendedWatcher::new(tx, notify::Config::default())
        .map_err(|e| e.to_string())?;
    watch_project_filtered(&mut watcher, &project_root)?;

    let debounce = watch_debounce();
    std::thread::Builder::new()
        .name("tantivy-watch".into())
        .spawn(move || {
            let mut watcher = watcher;
            loop {
                let first = match rx.recv() {
                    Ok(ev) => ev,
                    Err(_) => break,
                };
                let mut pending: HashMap<String, WatchOp> = HashMap::new();
                ingest_event(&project_root, &mut watcher, first, &mut pending);
                drain_window(&rx, debounce, |ev| {
                    ingest_event(&project_root, &mut watcher, ev, &mut pending);
                });
                if pending.is_empty() {
                    continue;
                }
                apply_ops(&project_root, &engine, pending.into_values().collect());
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Collect items for `window` after the first event, then drain anything that
/// arrived while we were receiving. Bounds commit rate to ~1 / debounce.
pub(crate) fn drain_window<T>(
    rx: &mpsc::Receiver<T>,
    window: Duration,
    mut on_item: impl FnMut(T),
) {
    let deadline = Instant::now() + window;
    loop {
        let rem = deadline.saturating_duration_since(Instant::now());
        if rem.is_zero() {
            break;
        }
        match rx.recv_timeout(rem) {
            Ok(item) => on_item(item),
            Err(RecvTimeoutError::Timeout) => break,
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
    while let Ok(item) = rx.try_recv() {
        on_item(item);
    }
}

fn watch_project_filtered(
    watcher: &mut RecommendedWatcher,
    project_root: &Path,
) -> Result<(), String> {
    watcher
        .watch(project_root, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;
    let rd = match std::fs::read_dir(project_root) {
        Ok(v) => v,
        Err(_) => return Ok(()),
    };
    for entry in rd.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !path.is_dir() {
            continue;
        }
        if is_skip_dir_name(&name) {
            continue;
        }
        watcher
            .watch(&path, RecursiveMode::Recursive)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn maybe_watch_new_dir(
    watcher: &mut RecommendedWatcher,
    project_root: &Path,
    abs: &Path,
    rel: &str,
) {
    if rel.contains('/') || !abs.is_dir() {
        return;
    }
    if is_skip_dir_name(rel) {
        return;
    }
    let _ = watcher.watch(abs, RecursiveMode::Recursive);
    let _ = project_root;
}

fn ingest_event(
    project_root: &Path,
    watcher: &mut RecommendedWatcher,
    ev: notify::Result<Event>,
    pending: &mut HashMap<String, WatchOp>,
) {
    let Ok(event) = ev else { return };
    for op in classify_event(project_root, &event) {
        if let WatchOp::Upsert(rel) = &op {
            let abs = join_project(project_root, rel);
            maybe_watch_new_dir(watcher, project_root, &abs, rel);
        }
        push_op(pending, op);
    }
}

pub(crate) fn push_op(pending: &mut HashMap<String, WatchOp>, op: WatchOp) {
    pending.insert(op.path().to_string(), op);
}

/// Last op per path wins; first-seen order is preserved.
pub(crate) fn coalesce_ops(ops: impl IntoIterator<Item = WatchOp>) -> Vec<WatchOp> {
    let mut last: HashMap<String, WatchOp> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    for op in ops {
        let key = op.path().to_string();
        if last.insert(key.clone(), op).is_none() {
            order.push(key);
        }
    }
    order.into_iter().filter_map(|k| last.remove(&k)).collect()
}

pub(crate) fn classify_event(project_root: &Path, event: &Event) -> Vec<WatchOp> {
    let mut ops = Vec::new();
    let renamed = matches!(
        event.kind,
        EventKind::Modify(ModifyKind::Name(
            RenameMode::From | RenameMode::To | RenameMode::Both | RenameMode::Any
        ))
    );
    let deleted = matches!(event.kind, EventKind::Remove(_)) || renamed;
    for abs in &event.paths {
        let Some(rel) = to_project_rel(project_root, abs) else {
            continue;
        };
        if should_ignore_watch_rel(&rel) {
            continue;
        }
        if matches!(event.kind, EventKind::Remove(_)) || !abs.exists() {
            ops.push(WatchOp::Delete(rel));
        } else if abs.is_file() {
            if should_ignore_watch_rel(&rel) {
                continue;
            }
            ops.push(WatchOp::Upsert(rel));
        } else if abs.is_dir() {
            if is_skip_dir_name(rel.rsplit(['/', '\\']).next().unwrap_or(&rel)) {
                continue;
            }
            for child in walk_text_files_from(project_root, abs) {
                if !should_ignore_watch_rel(&child) {
                    ops.push(WatchOp::Upsert(child));
                }
            }
        } else if deleted {
            ops.push(WatchOp::Delete(rel));
        }
    }
    ops
}

pub(crate) fn apply_ops(
    project_root: &Path,
    engine: &Arc<Mutex<crate::engine::Engine>>,
    ops: Vec<WatchOp>,
) {
    let last = coalesce_ops(ops);
    if last.is_empty() {
        return;
    }
    let mut eng = match engine.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    let mut changed = false;
    for op in last {
        let rel = op.path().to_string();
        if should_ignore_watch_rel(&rel) {
            continue;
        }
        let result = match op {
            WatchOp::Upsert(rel) => {
                let abs = join_project(project_root, &rel);
                if abs.is_file() {
                    eng.stage_overlay_from_disk(&rel)
                } else {
                    eng.stage_overlay_delete_tree(&rel)
                }
            }
            WatchOp::Delete(rel) => eng.stage_overlay_delete_tree(&rel),
        };
        match result {
            Ok(did) => changed |= did,
            Err(_) => {}
        }
    }
    if changed {
        let _ = eng.commit_overlay();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::Engine;
    use notify::event::{CreateKind, DataChange, Event, EventKind, ModifyKind, RemoveKind};
    use std::fs;
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    fn temp_project(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "tantivy-watch-{tag}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(dir.join("src")).unwrap();
        dir
    }

    fn write_file(root: &Path, rel: &str, body: &str) {
        let abs = join_project(root, rel);
        if let Some(parent) = abs.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(abs, body).unwrap();
    }

    fn ev(root: &Path, kind: EventKind, rels: &[&str]) -> Event {
        let mut event = Event::new(kind);
        for rel in rels {
            event = event.add_path(join_project(root, rel));
        }
        event
    }

    fn open_engine(root: &Path) -> Arc<Mutex<Engine>> {
        let mut eng = Engine::new(root.to_path_buf());
        eng.open_or_build().expect("open overlay");
        Arc::new(Mutex::new(eng))
    }

    #[test]
    fn excluded_paths_are_not_queued() {
        let root = temp_project("skip");
        write_file(&root, ".pi/agent/code-retrieval/index/overlay/meta.json", "{}");
        write_file(&root, ".git/HEAD", "ref: refs/heads/main");
        write_file(&root, ".worktrees/foo/src/a.ts", "export const a = 1;");
        write_file(&root, "pipiui-wt/foo/src/a.ts", "export const a = 1;");
        write_file(&root, "node_modules/pkg/index.js", "module.exports = 1;");
        write_file(&root, "dist/bundle.js", "console.log(1)");
        write_file(&root, "build/out.js", "console.log(1)");
        write_file(&root, "src/ok.ts", "export const ok = 1;");

        let kinds = [
            EventKind::Create(CreateKind::File),
            EventKind::Modify(ModifyKind::Data(DataChange::Content)),
            EventKind::Remove(RemoveKind::File),
        ];
        for kind in kinds {
            for rel in [
                ".pi/agent/code-retrieval/index/overlay/meta.json",
                ".git/HEAD",
                ".worktrees/foo/src/a.ts",
                "pipiui-wt/foo/src/a.ts",
                "node_modules/pkg/index.js",
                "dist/bundle.js",
                "build/out.js",
            ] {
                let ops = classify_event(&root, &ev(&root, kind, &[rel]));
                assert!(ops.is_empty(), "queued {ops:?} for {rel} {kind:?}");
            }
        }
        let ops = classify_event(
            &root,
            &ev(&root, EventKind::Create(CreateKind::File), &["src/ok.ts"]),
        );
        assert_eq!(ops, vec![WatchOp::Upsert("src/ok.ts".into())]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn same_path_events_coalesce_to_last() {
        let ops = vec![
            WatchOp::Upsert("src/a.ts".into()),
            WatchOp::Delete("src/a.ts".into()),
            WatchOp::Upsert("src/a.ts".into()),
            WatchOp::Upsert("src/b.ts".into()),
            WatchOp::Delete("src/b.ts".into()),
        ];
        let last = coalesce_ops(ops);
        assert_eq!(last.len(), 2);
        let map: HashMap<_, _> = last.into_iter().map(|op| (op.path().to_string(), op)).collect();
        assert_eq!(map.get("src/a.ts"), Some(&WatchOp::Upsert("src/a.ts".into())));
        assert_eq!(map.get("src/b.ts"), Some(&WatchOp::Delete("src/b.ts".into())));
    }

    #[test]
    fn storm_is_bounded_by_unique_paths() {
        let mut ops = Vec::new();
        for i in 0..2_000 {
            let path = format!("src/f{}.ts", i % 5);
            ops.push(if i % 3 == 0 {
                WatchOp::Delete(path)
            } else {
                WatchOp::Upsert(path)
            });
        }
        let last = coalesce_ops(ops);
        assert_eq!(last.len(), 5);
    }

    #[test]
    fn rename_emits_delete_source_and_upsert_dest() {
        let root = temp_project("rename");
        write_file(&root, "src/b.ts", "export const b = 1;");
        let event = ev(
            &root,
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
            &["src/a.ts", "src/b.ts"],
        );
        let ops = classify_event(&root, &event);
        assert!(ops.contains(&WatchOp::Delete("src/a.ts".into())), "{ops:?}");
        assert!(ops.contains(&WatchOp::Upsert("src/b.ts".into())), "{ops:?}");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn drain_window_collects_burst_then_stops() {
        let (tx, rx) = mpsc::channel::<u32>();
        tx.send(1).unwrap();
        let handle = thread::spawn(move || {
            let mut got = vec![0];
            drain_window(&rx, Duration::from_millis(40), |n| got.push(n));
            got
        });
        tx.send(2).unwrap();
        tx.send(3).unwrap();
        thread::sleep(Duration::from_millis(80));
        // Window already closed; a late send must not be observed.
        let _ = tx.send(4);
        let got = handle.join().unwrap();
        assert_eq!(got, vec![0, 1, 2, 3]);
    }

    #[test]
    fn batch_of_many_files_commits_once_and_keeps_last_state() {
        let root = temp_project("batch");
        write_file(&root, "src/keep.ts", "export const keep = 'alphaunique';");
        let engine = open_engine(&root);
        {
            let mut eng = engine.lock().unwrap();
            eng.overlay_commits = 0;
        }

        write_file(&root, "src/a.ts", "export const a = 'alphaunique';");
        write_file(&root, "src/b.ts", "export const b = 'betaunique';");
        write_file(&root, "src/c.ts", "export const c = 'gammaunique';");
        write_file(&root, ".pi/agent/noise.ts", "export const noise = 'nope';");

        let mut ops = Vec::new();
        for _ in 0..20 {
            ops.push(WatchOp::Upsert("src/a.ts".into()));
            ops.push(WatchOp::Upsert("src/b.ts".into()));
            ops.push(WatchOp::Upsert("src/c.ts".into()));
            ops.push(WatchOp::Upsert(".pi/agent/noise.ts".into()));
        }
        // last state: delete a, keep b, rewrite c
        ops.push(WatchOp::Delete("src/a.ts".into()));
        fs::remove_file(join_project(&root, "src/a.ts")).unwrap();
        write_file(&root, "src/c.ts", "export const c = 'gammaunique-final';");
        ops.push(WatchOp::Upsert("src/c.ts".into()));

        apply_ops(&root, &engine, ops);

        let eng = engine.lock().unwrap();
        assert_eq!(eng.overlay_commits, 1, "one commit/reload per batch");
        assert!(!eng.overlay_deleted.contains("src/b.ts"));
        assert!(eng.overlay_deleted.contains("src/a.ts"));
        assert!(!eng.overlay_cover.contains(".pi/agent/noise.ts"));

        let hits_a = eng.search("alphaunique", None, None, Some(20), &[]).unwrap();
        assert!(
            hits_a.iter().all(|h| h.path != "src/a.ts"),
            "deleted file must not remain searchable: {hits_a:?}"
        );
        let hits_b = eng.search("betaunique", None, None, Some(20), &[]).unwrap();
        assert!(hits_b.iter().any(|h| h.path == "src/b.ts"), "{hits_b:?}");
        let hits_c = eng
            .search("gammaunique-final", None, None, Some(20), &[])
            .unwrap();
        assert!(hits_c.iter().any(|h| h.path == "src/c.ts"), "{hits_c:?}");
        drop(eng);

        // second batch: recreate a — still one additional commit
        write_file(&root, "src/a.ts", "export const a = 'alphaunique';");
        apply_ops(&root, &engine, vec![WatchOp::Upsert("src/a.ts".into())]);
        let eng = engine.lock().unwrap();
        assert_eq!(eng.overlay_commits, 2);
        let hits_a = eng.search("alphaunique", None, None, Some(20), &[]).unwrap();
        assert!(hits_a.iter().any(|h| h.path == "src/a.ts"), "{hits_a:?}");
        drop(eng);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn directory_delete_tombstones_baseline_only_children() {
        let root = temp_project("dir-del");
        write_file(&root, "src/a.ts", "export const a = 'baselinedeleteunique';");
        write_file(&root, "src/nested/b.ts", "export const b = 'baselinedeleteunique';");
        write_file(&root, "keep.ts", "export const keep = 'baselinedeleteunique';");
        let engine = open_engine(&root);
        {
            let mut eng = engine.lock().unwrap();
            assert!(eng.baseline_paths.contains("src/a.ts"), "{0:?}", eng.baseline_paths);
            eng.overlay_commits = 0;
            let hits = eng
                .search("baselinedeleteunique", None, None, Some(20), &[])
                .unwrap();
            assert!(hits.iter().any(|h| h.path == "src/a.ts"), "{hits:?}");
        }
        let _ = fs::remove_dir_all(join_project(&root, "src"));
        apply_ops(&root, &engine, vec![WatchOp::Delete("src".into())]);
        let eng = engine.lock().unwrap();
        assert_eq!(eng.overlay_commits, 1, "one commit/reload per batch");
        assert!(eng.overlay_deleted.contains("src/a.ts"));
        assert!(eng.overlay_deleted.contains("src/nested/b.ts"));
        let hits = eng
            .search("baselinedeleteunique", None, None, Some(20), &[])
            .unwrap();
        assert!(hits.iter().all(|h| h.path != "src/a.ts"), "{hits:?}");
        assert!(hits.iter().all(|h| h.path != "src/nested/b.ts"), "{hits:?}");
        assert!(hits.iter().any(|h| h.path == "keep.ts"), "{hits:?}");
        drop(eng);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn directory_rename_hides_old_baseline_and_indexes_dest() {
        let root = temp_project("dir-ren");
        write_file(&root, "src/a.ts", "export const a = 'baselinerenameunique';");
        let engine = open_engine(&root);
        {
            engine.lock().unwrap().overlay_commits = 0;
        }
        fs::rename(join_project(&root, "src"), join_project(&root, "lib")).unwrap();
        apply_ops(
            &root,
            &engine,
            vec![
                WatchOp::Delete("src".into()),
                WatchOp::Upsert("lib/a.ts".into()),
            ],
        );
        let eng = engine.lock().unwrap();
        assert_eq!(eng.overlay_commits, 1, "one commit/reload per batch");
        assert!(eng.overlay_deleted.contains("src/a.ts"));
        let hits = eng
            .search("baselinerenameunique", None, None, Some(20), &[])
            .unwrap();
        assert!(hits.iter().all(|h| h.path != "src/a.ts"), "{hits:?}");
        assert!(hits.iter().any(|h| h.path == "lib/a.ts"), "{hits:?}");
        drop(eng);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn apply_ops_recovers_from_poisoned_mutex() {
        let root = temp_project("poison");
        write_file(&root, "src/keep.ts", "export const keep = 'poisonkeepunique';");
        let engine = open_engine(&root);
        {
            engine.lock().unwrap().overlay_commits = 0;
        }
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = engine.lock().unwrap();
            panic!("poison watcher mutex");
        }));
        assert!(engine.lock().is_err(), "mutex should be poisoned");
        write_file(&root, "src/new.ts", "export const n = 'poisonnewunique';");
        apply_ops(&root, &engine, vec![WatchOp::Upsert("src/new.ts".into())]);
        let eng = match engine.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        assert_eq!(eng.overlay_commits, 1);
        let hits = eng
            .search("poisonnewunique", None, None, Some(20), &[])
            .unwrap();
        assert!(hits.iter().any(|h| h.path == "src/new.ts"), "{hits:?}");
        drop(eng);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn excluded_only_batch_does_not_commit() {
        let root = temp_project("nocommit");
        let engine = open_engine(&root);
        {
            engine.lock().unwrap().overlay_commits = 0;
        }
        apply_ops(
            &root,
            &engine,
            vec![
                WatchOp::Upsert(".git/HEAD".into()),
                WatchOp::Upsert("dist/x.js".into()),
                WatchOp::Delete(".pi/agent/code-retrieval/index/overlay/meta.json".into()),
            ],
        );
        assert_eq!(engine.lock().unwrap().overlay_commits, 0);
        let _ = fs::remove_dir_all(&root);
    }
}
