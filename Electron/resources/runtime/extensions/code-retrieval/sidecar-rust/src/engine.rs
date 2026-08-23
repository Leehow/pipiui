use crate::git;
use crate::util::{
    compile_line_regex, glob_match, index_root, join_project, literal_regex, looks_binary,
    sha256_hex, should_skip_file, tokens_from_query, walk_text_files, CONTEXT_RADIUS, DEFAULT_TOP_K,
    MAX_FILE_BYTES,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tantivy::collector::TopDocs;
use tantivy::query::{BooleanQuery, Occur, Query, TermQuery};
use tantivy::schema::{Schema, TantivyDocument, Value, INDEXED, STORED, STRING, TEXT};
use tantivy::{doc, Index, IndexReader, IndexWriter, ReloadPolicy, Term};

const WRITER_HEAP: usize = 32_000_000;
const COMMIT_EVERY: usize = 400;
const CANDIDATE_MULT: usize = 6;

#[derive(Clone, Copy)]
struct Fields {
    path: tantivy::schema::Field,
    content: tantivy::schema::Field,
    hash: tantivy::schema::Field,
}

struct Layer {
    writer: IndexWriter,
    reader: IndexReader,
}

#[derive(Debug, Clone, Serialize)]
pub struct Hit {
    pub path: String,
    #[serde(rename = "startLine")]
    pub start_line: u32,
    #[serde(rename = "endLine")]
    pub end_line: u32,
    pub score: f32,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct IndexState {
    head: Option<String>,
    file_count: u64,
    built_at: u64,
}

pub struct Engine {
    project_root: PathBuf,
    schema: Schema,
    fields: Fields,
    baseline: Option<Layer>,
    overlay: Option<Layer>,
    /// Overlay paths that hide the same path in baseline (live or tombstone).
    overlay_cover: HashSet<String>,
    overlay_deleted: HashSet<String>,
    pub ready: bool,
    pub head: Option<String>,
    pub baseline_docs: u64,
    pub overlay_docs: u64,
}

impl Engine {
    pub fn new(project_root: PathBuf) -> Self {
        let mut builder = Schema::builder();
        let path = builder.add_text_field("path", STRING | STORED);
        let content = builder.add_text_field("content", TEXT | STORED);
        let hash = builder.add_text_field("hash", STRING | STORED);
        let _deleted = builder.add_u64_field("deleted", INDEXED | STORED);
        let schema = builder.build();
        Self {
            project_root,
            schema,
            fields: Fields { path, content, hash },
            baseline: None,
            overlay: None,
            overlay_cover: HashSet::new(),
            overlay_deleted: HashSet::new(),
            ready: false,
            head: None,
            baseline_docs: 0,
            overlay_docs: 0,
        }
    }

    pub fn open_or_build(&mut self) -> Result<(), String> {
        let root = index_root(&self.project_root);
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        let baseline_dir = root.join("baseline");
        let overlay_dir = root.join("overlay");
        let state_path = root.join("state.json");

        let current_head = if git::git_available(&self.project_root) {
            git::head_sha(&self.project_root)
        } else {
            None
        };
        let prev = read_state(&state_path);
        let can_reuse = current_head.is_some()
            && current_head == prev.head
            && baseline_dir.join("meta.json").exists();

        if can_reuse {
            match open_layer(&baseline_dir, self.schema.clone()) {
                Ok(layer) => {
                    self.baseline_docs = count_docs(&layer);
                    self.baseline = Some(layer);
                }
                Err(_) => {
                    self.rebuild_baseline(&baseline_dir, current_head.as_deref())?;
                }
            }
        } else {
            self.rebuild_baseline(&baseline_dir, current_head.as_deref())?;
        }

        // Overlay is always rebuilt from the working tree dirty set (source of truth).
        if overlay_dir.exists() {
            let _ = fs::remove_dir_all(&overlay_dir);
        }
        self.overlay = Some(create_layer(&overlay_dir, self.schema.clone())?);
        self.overlay_cover.clear();
        self.overlay_deleted.clear();
        self.overlay_docs = 0;
        self.refresh_overlay_from_git()?;

        self.head = current_head.clone();
        write_state(
            &state_path,
            &IndexState {
                head: current_head,
                file_count: self.baseline_docs,
                built_at: crate::util::now_ms(),
            },
        );
        self.ready = true;
        Ok(())
    }

    fn rebuild_baseline(&mut self, dir: &Path, head: Option<&str>) -> Result<(), String> {
        if dir.exists() {
            let _ = fs::remove_dir_all(dir);
        }
        let mut layer = create_layer(dir, self.schema.clone())?;
        let mut count = 0u64;
        let mut pending = 0usize;

        if head.is_some() && git::git_available(&self.project_root) {
            let paths = git::ls_tree_head(&self.project_root);
            for chunk in paths.chunks(200) {
                let batch = git::cat_file_batch(&self.project_root, chunk);
                for (rel, bytes) in batch {
                    let Some(bytes) = bytes else { continue };
                    if !accept_bytes(&rel, &bytes) {
                        continue;
                    }
                    let Ok(text) = String::from_utf8(bytes) else { continue };
                    let hash = sha256_hex(text.as_bytes());
                    upsert(&mut layer, &self.fields, &rel, &text, &hash)?;
                    count += 1;
                    pending += 1;
                    if pending >= COMMIT_EVERY {
                        layer.commit()?;
                        pending = 0;
                    }
                }
            }
        } else {
            for rel in walk_text_files(&self.project_root) {
                let Some((text, hash)) = read_working_file(&self.project_root, &rel) else {
                    continue;
                };
                upsert(&mut layer, &self.fields, &rel, &text, &hash)?;
                count += 1;
                pending += 1;
                if pending >= COMMIT_EVERY {
                    layer.commit()?;
                    pending = 0;
                }
            }
        }
        if pending > 0 {
            layer.commit()?;
        } else {
            // empty index still needs a reader
            let _ = layer.reader.reload();
        }
        self.baseline_docs = count;
        self.baseline = Some(layer);
        Ok(())
    }

    pub fn refresh_overlay_from_git(&mut self) -> Result<(), String> {
        if !git::git_available(&self.project_root) {
            return Ok(());
        }
        let dirty = git::dirty_set(&self.project_root);
        for rel in dirty.deleted {
            self.delete_overlay_path(&rel, true)?;
        }
        for rel in dirty.changed {
            self.update_overlay_from_disk(&rel)?;
        }
        if let Some(layer) = self.overlay.as_mut() {
            layer.commit()?;
        }
        Ok(())
    }

    pub fn update_overlay_from_disk(&mut self, rel: &str) -> Result<(), String> {
        if should_skip_file(rel) {
            return Ok(());
        }
        let abs = join_project(&self.project_root, rel);
        if !abs.exists() {
            return self.delete_overlay_path(rel, true);
        }
        let Some((text, hash)) = read_working_file(&self.project_root, rel) else {
            return Ok(());
        };
        if let Some(head_bytes) = git::show_head_file(&self.project_root, rel) {
            if sha256_hex(&head_bytes) == hash {
                // Working tree matches HEAD — drop overlay so baseline wins.
                return self.delete_overlay_path(rel, false);
            }
        }
        let layer = self
            .overlay
            .as_mut()
            .ok_or_else(|| "overlay not open".to_string())?;
        upsert(layer, &self.fields, rel, &text, &hash)?;
        layer.commit()?;
        self.overlay_cover.insert(rel.to_string());
        self.overlay_deleted.remove(rel);
        self.overlay_docs = self.overlay_cover.len() as u64;
        Ok(())
    }

    pub fn update_overlay_content(&mut self, rel: &str, content: &str) -> Result<(), String> {
        if should_skip_file(rel) {
            return Ok(());
        }
        let hash = sha256_hex(content.as_bytes());
        let layer = self
            .overlay
            .as_mut()
            .ok_or_else(|| "overlay not open".to_string())?;
        upsert(layer, &self.fields, rel, content, &hash)?;
        layer.commit()?;
        self.overlay_cover.insert(rel.to_string());
        self.overlay_deleted.remove(rel);
        self.overlay_docs = self.overlay_cover.len() as u64;
        Ok(())
    }

    pub fn delete_overlay_path(&mut self, rel: &str, tombstone: bool) -> Result<(), String> {
        if let Some(layer) = self.overlay.as_mut() {
            layer
                .writer
                .delete_term(Term::from_field_text(self.fields.path, rel));
            layer.commit()?;
        }
        if tombstone {
            self.overlay_cover.insert(rel.to_string());
            self.overlay_deleted.insert(rel.to_string());
        } else {
            self.overlay_cover.remove(rel);
            self.overlay_deleted.remove(rel);
        }
        self.overlay_docs = self.overlay_cover.len() as u64;
        Ok(())
    }

    pub fn commit(&mut self) -> Result<(), String> {
        if let Some(layer) = self.baseline.as_mut() {
            layer.commit()?;
        }
        if let Some(layer) = self.overlay.as_mut() {
            layer.commit()?;
        }
        Ok(())
    }

    pub fn search(
        &self,
        query: &str,
        path_prefix: Option<&str>,
        glob: Option<&str>,
        top_k: Option<usize>,
        exclude_globs: &[String],
    ) -> Result<Vec<Hit>, String> {
        let top_k = top_k.unwrap_or(DEFAULT_TOP_K).clamp(1, 100);
        let terms = tokens_from_query(query);
        if terms.is_empty() {
            return Err("query has no indexable terms".into());
        }
        let line_re = compile_line_regex(query).unwrap_or_else(|_| literal_regex(query));
        let tantivy_q = build_term_query(self.fields.content, &terms)?;
        let cand = (top_k * CANDIDATE_MULT).max(24);

        let mut overlay_hits = Vec::new();
        if let Some(layer) = self.overlay.as_ref() {
            overlay_hits = search_layer(layer, self.fields, &*tantivy_q, cand)?;
        }

        let mut seen_paths: HashSet<String> = self.overlay_cover.clone();
        let mut merged: Vec<Hit> = Vec::new();

        for doc in overlay_hits {
            if self.overlay_deleted.contains(&doc.path) {
                continue;
            }
            push_line_hits(
                &mut merged,
                &doc,
                &line_re,
                path_prefix,
                glob,
                exclude_globs,
                top_k,
            );
            seen_paths.insert(doc.path);
            if merged.len() >= top_k {
                return Ok(merged);
            }
        }

        if let Some(layer) = self.baseline.as_ref() {
            let baseline_docs = search_layer(layer, self.fields, &*tantivy_q, cand)?;
            for doc in baseline_docs {
                if seen_paths.contains(&doc.path) {
                    continue;
                }
                push_line_hits(
                    &mut merged,
                    &doc,
                    &line_re,
                    path_prefix,
                    glob,
                    exclude_globs,
                    top_k,
                );
                if merged.len() >= top_k {
                    break;
                }
            }
        }
        Ok(merged)
    }
}

struct StoredDoc {
    path: String,
    content: String,
    score: f32,
}

fn build_term_query(
    field: tantivy::schema::Field,
    terms: &[String],
) -> Result<Box<dyn Query>, String> {
    let mut clauses: Vec<(Occur, Box<dyn Query>)> = Vec::new();
    for term in terms {
        let t = Term::from_field_text(field, term);
        clauses.push((
            Occur::Must,
            Box::new(TermQuery::new(t, tantivy::schema::IndexRecordOption::WithFreqs)),
        ));
    }
    Ok(Box::new(BooleanQuery::new(clauses)))
}

fn search_layer(
    layer: &Layer,
    fields: Fields,
    query: &dyn Query,
    limit: usize,
) -> Result<Vec<StoredDoc>, String> {
    let searcher = layer.reader.searcher();
    let top = searcher
        .search(query, &TopDocs::with_limit(limit).order_by_score())
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for (score, addr) in top {
        let retrieved: TantivyDocument = searcher.doc(addr).map_err(|e| e.to_string())?;
        let path = retrieved
            .get_first(fields.path)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let content = retrieved
            .get_first(fields.content)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if path.is_empty() {
            continue;
        }
        out.push(StoredDoc {
            path,
            content,
            score,
        });
    }
    Ok(out)
}

fn push_line_hits(
    out: &mut Vec<Hit>,
    doc: &StoredDoc,
    line_re: &regex::Regex,
    path_prefix: Option<&str>,
    glob: Option<&str>,
    exclude_globs: &[String],
    top_k: usize,
) {
    if !path_allowed(&doc.path, path_prefix, glob, exclude_globs) {
        return;
    }
    for (idx, line) in doc.content.split('\n').enumerate() {
        if out.len() >= top_k {
            return;
        }
        if !line_re.is_match(line) {
            continue;
        }
        let line_no = (idx + 1) as u32;
        let start = line_no.saturating_sub(CONTEXT_RADIUS as u32).max(1);
        let end = line_no + CONTEXT_RADIUS as u32;
        let text = if line.chars().count() > 240 {
            line.chars().take(240).collect::<String>() + "…"
        } else {
            line.to_string()
        };
        out.push(Hit {
            path: doc.path.clone(),
            start_line: start,
            end_line: end,
            score: doc.score,
            text,
        });
    }
}

fn path_allowed(
    rel: &str,
    path_prefix: Option<&str>,
    glob: Option<&str>,
    exclude_globs: &[String],
) -> bool {
    if let Some(prefix) = path_prefix {
        let p = prefix.trim_start_matches("./").replace('\\', "/");
        if !p.is_empty() {
            let norm = rel.replace('\\', "/");
            if !norm.starts_with(&p) && !norm.starts_with(&format!("{p}/")) && norm != p {
                return false;
            }
        }
    }
    if let Some(g) = glob {
        if !g.is_empty() && !glob_match(rel, g) {
            return false;
        }
    }
    for ex in exclude_globs {
        let g = ex.trim_start_matches('!');
        if !g.is_empty() && glob_match(rel, g) {
            return false;
        }
    }
    true
}

fn accept_bytes(rel: &str, bytes: &[u8]) -> bool {
    if should_skip_file(rel) {
        return false;
    }
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return false;
    }
    if looks_binary(bytes) {
        return false;
    }
    true
}

fn read_working_file(project_root: &Path, rel: &str) -> Option<(String, String)> {
    let abs = join_project(project_root, rel);
    let meta = fs::symlink_metadata(&abs).ok()?;
    if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
        return None;
    }
    let bytes = fs::read(&abs).ok()?;
    if !accept_bytes(rel, &bytes) {
        return None;
    }
    let text = String::from_utf8(bytes).ok()?;
    let hash = sha256_hex(text.as_bytes());
    Some((text, hash))
}

fn upsert(layer: &mut Layer, fields: &Fields, path: &str, content: &str, hash: &str) -> Result<(), String> {
    layer
        .writer
        .delete_term(Term::from_field_text(fields.path, path));
    layer
        .writer
        .add_document(doc!(
            fields.path => path,
            fields.content => content,
            fields.hash => hash,
        ))
        .map_err(|e| e.to_string())?;
    Ok(())
}

impl Layer {
    fn commit(&mut self) -> Result<(), String> {
        self.writer.commit().map_err(|e| e.to_string())?;
        self.reader.reload().map_err(|e| e.to_string())?;
        Ok(())
    }
}

fn create_layer(dir: &Path, schema: Schema) -> Result<Layer, String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let index = Index::create_in_dir(dir, schema).map_err(|e| e.to_string())?;
    layer_from_index(index)
}

fn open_layer(dir: &Path, _schema: Schema) -> Result<Layer, String> {
    let index = Index::open_in_dir(dir).map_err(|e| e.to_string())?;
    layer_from_index(index)
}

fn layer_from_index(index: Index) -> Result<Layer, String> {
    let writer = index.writer(WRITER_HEAP).map_err(|e| e.to_string())?;
    let reader = index
        .reader_builder()
        .reload_policy(ReloadPolicy::Manual)
        .try_into()
        .map_err(|e| e.to_string())?;
    Ok(Layer { writer, reader })
}

fn count_docs(layer: &Layer) -> u64 {
    layer.reader.searcher().num_docs()
}

fn read_state(path: &Path) -> IndexState {
    let Ok(raw) = fs::read_to_string(path) else {
        return IndexState::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn write_state(path: &Path, state: &IndexState) {
    if let Ok(text) = serde_json::to_string(state) {
        let _ = fs::write(path, text);
    }
}
