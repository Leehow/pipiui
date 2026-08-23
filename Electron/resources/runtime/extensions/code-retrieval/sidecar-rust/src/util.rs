use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub const MAX_FILE_BYTES: u64 = 1_048_576;
pub const CONTEXT_RADIUS: usize = 8;
pub const DEFAULT_TOP_K: usize = 20;

const SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "dist",
    "build",
    ".pi",
    ".worktrees",
    "target",
    "__pycache__",
    ".venv",
    "venv",
    ".tox",
    ".mypy_cache",
    ".pytest_cache",
    ".idea",
    ".vscode",
    "vendor",
];

const SKIP_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "woff", "woff2", "ttf", "otf", "eot", "zip",
    "gz", "bz2", "xz", "7z", "rar", "pdf", "class", "so", "dylib", "dll", "exe", "bin", "wasm",
    "pyc", "pyo", "o", "a", "rlib", "mp3", "mp4", "mov", "avi", "jar", "whl", "egg", "lock",
    "pack", "idx", "parquet", "sqlite", "db",
];

fn skip_dir_set() -> &'static HashSet<&'static str> {
    static SET: OnceLock<HashSet<&'static str>> = OnceLock::new();
    SET.get_or_init(|| SKIP_DIRS.iter().copied().collect())
}

fn skip_ext_set() -> &'static HashSet<&'static str> {
    static SET: OnceLock<HashSet<&'static str>> = OnceLock::new();
    SET.get_or_init(|| SKIP_EXTS.iter().copied().collect())
}

pub fn is_skip_dir_name(name: &str) -> bool {
    skip_dir_set().contains(name)
}

pub fn rel_has_skip_component(rel: &str) -> bool {
    rel.split(['/', '\\']).any(is_skip_dir_name)
}

pub fn should_skip_file(rel: &str) -> bool {
    if rel_has_skip_component(rel) {
        return true;
    }
    if let Some(ext) = Path::new(rel).extension().and_then(|e| e.to_str()) {
        if skip_ext_set().contains(ext.to_ascii_lowercase().as_str()) {
            return true;
        }
    }
    false
}

pub fn to_project_rel(project_root: &Path, abs: &Path) -> Option<String> {
    let rel = abs.strip_prefix(project_root).ok()?;
    let text = rel.to_string_lossy().replace('\\', "/");
    if text.is_empty() || text.starts_with("..") {
        return None;
    }
    Some(text)
}

pub fn join_project(project_root: &Path, rel: &str) -> PathBuf {
    let mut out = project_root.to_path_buf();
    for part in rel.split(['/', '\\']) {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            return project_root.join("__escaped__");
        }
        out.push(part);
    }
    out
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

pub fn looks_binary(bytes: &[u8]) -> bool {
    bytes.contains(&0)
}

pub fn tokens_from_query(query: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    for ch in query.chars() {
        if ch.is_ascii_alphanumeric() {
            cur.push(ch.to_ascii_lowercase());
        } else if !cur.is_empty() {
            if cur.len() >= 2 {
                out.push(std::mem::take(&mut cur));
            } else {
                cur.clear();
            }
        }
    }
    if cur.len() >= 2 {
        out.push(cur);
    }
    out.truncate(8);
    out
}

pub fn compile_line_regex(query: &str) -> Result<regex::Regex, regex::Error> {
    regex::RegexBuilder::new(query)
        .case_insensitive(false)
        .dot_matches_new_line(false)
        .size_limit(1 << 20)
        .build()
}

pub fn literal_regex(query: &str) -> regex::Regex {
    regex::RegexBuilder::new(&regex::escape(query))
        .case_insensitive(false)
        .dot_matches_new_line(false)
        .build()
        .expect("escaped regex compiles")
}

pub fn glob_match(rel: &str, glob: &str) -> bool {
    let escaped = glob
        .replace('\\', "/")
        .replace('.', r"\.")
        .replace('+', r"\+")
        .replace('^', r"\^")
        .replace('$', r"\$")
        .replace('{', r"\{")
        .replace('}', r"\}")
        .replace('(', r"\(")
        .replace(')', r"\)")
        .replace('|', r"\|")
        .replace('[', r"\[")
        .replace(']', r"\]")
        .replace("**", "{{GLOBSTAR}}")
        .replace('*', "[^/]*")
        .replace("{{GLOBSTAR}}", ".*")
        .replace('?', ".");
    let anchored = format!("^{escaped}$");
    let full = regex::Regex::new(&anchored).ok();
    let loose = regex::Regex::new(&escaped).ok();
    full.map(|r| r.is_match(rel)).unwrap_or(false)
        || loose.map(|r| r.is_match(rel)).unwrap_or(false)
}

pub fn retrieval_home(project_root: &Path) -> PathBuf {
    project_root.join(".pi").join("agent").join("code-retrieval")
}

pub fn index_root(project_root: &Path) -> PathBuf {
    retrieval_home(project_root).join("index")
}

pub fn sidecar_json_path(project_root: &Path) -> PathBuf {
    retrieval_home(project_root).join("sidecar.json")
}

pub fn random_token() -> String {
    let mut bytes = [0u8; 24];
    if let Ok(mut file) = std::fs::File::open("/dev/urandom") {
        use std::io::Read;
        let _ = file.read_exact(&mut bytes);
    } else {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(1);
        for (i, slot) in bytes.iter_mut().enumerate() {
            *slot = ((nanos >> ((i % 8) * 8)) as u8).wrapping_add(i as u8);
        }
    }
    base64url(&bytes)
}

fn base64url(bytes: &[u8]) -> String {
    const TBL: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    let mut i = 0;
    while i < bytes.len() {
        let b0 = bytes[i];
        let b1 = if i + 1 < bytes.len() { bytes[i + 1] } else { 0 };
        let b2 = if i + 2 < bytes.len() { bytes[i + 2] } else { 0 };
        out.push(TBL[(b0 >> 2) as usize] as char);
        out.push(TBL[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        if i + 1 < bytes.len() {
            out.push(TBL[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char);
        }
        if i + 2 < bytes.len() {
            out.push(TBL[(b2 & 0x3f) as usize] as char);
        }
        i += 3;
    }
    out
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Walk text files under `root` (project-relative paths). Does not follow symlinks.
pub fn walk_text_files(project_root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let mut stack = vec![project_root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(v) => v,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let meta = match std::fs::symlink_metadata(&path) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.file_type().is_symlink() {
                continue;
            }
            if meta.is_dir() {
                if is_skip_dir_name(&name) {
                    continue;
                }
                stack.push(path);
                continue;
            }
            if !meta.is_file() {
                continue;
            }
            let Some(rel) = to_project_rel(project_root, &path) else {
                continue;
            };
            if should_skip_file(&rel) {
                continue;
            }
            if meta.len() > MAX_FILE_BYTES {
                continue;
            }
            out.push(rel);
        }
    }
    out
}
