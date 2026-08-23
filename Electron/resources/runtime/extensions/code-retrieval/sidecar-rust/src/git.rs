use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};

#[derive(Debug, Default)]
pub struct DirtySet {
    pub changed: Vec<String>,
    pub deleted: Vec<String>,
}

pub fn git_available(project_root: &Path) -> bool {
    Command::new("git")
        .args(["-C", &project_root.to_string_lossy(), "rev-parse", "--is-inside-work-tree"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

pub fn head_sha(project_root: &Path) -> Option<String> {
    let output = Command::new("git")
        .args(["-C", &project_root.to_string_lossy(), "rev-parse", "HEAD"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let sha = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if sha.is_empty() {
        None
    } else {
        Some(sha)
    }
}

pub fn ls_tree_head(project_root: &Path) -> Vec<String> {
    let output = Command::new("git")
        .args([
            "-C",
            &project_root.to_string_lossy(),
            "ls-tree",
            "-r",
            "--name-only",
            "-z",
            "HEAD",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output();
    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    split_z(&output.stdout)
        .into_iter()
        .filter(|p| !p.is_empty() && !crate::util::should_skip_file(p))
        .collect()
}

pub fn cat_file_batch(
    project_root: &Path,
    paths: &[String],
) -> Vec<(String, Option<Vec<u8>>)> {
    if paths.is_empty() {
        return Vec::new();
    }
    let mut child = match Command::new("git")
        .args(["-C", &project_root.to_string_lossy(), "cat-file", "--batch"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(_) => return paths.iter().cloned().map(|p| (p, None)).collect(),
    };
    {
        let Some(stdin) = child.stdin.as_mut() else {
            return paths.iter().cloned().map(|p| (p, None)).collect();
        };
        for path in paths {
            let _ = writeln!(stdin, "HEAD:{path}");
        }
    }
    drop(child.stdin.take());
    let Some(stdout) = child.stdout.take() else {
        return paths.iter().cloned().map(|p| (p, None)).collect();
    };
    let mut reader = BufReader::new(stdout);
    let mut out = Vec::with_capacity(paths.len());
    for path in paths {
        match read_batch_object(&mut reader) {
            Some(bytes) => out.push((path.clone(), Some(bytes))),
            None => out.push((path.clone(), None)),
        }
    }
    let _ = child.wait();
    out
}

fn read_batch_object(reader: &mut BufReader<impl Read>) -> Option<Vec<u8>> {
    let mut header = String::new();
    if reader.read_line(&mut header).ok()? == 0 {
        return None;
    }
    let header = header.trim_end();
    if header.is_empty() {
        return None;
    }
    if header.ends_with(" missing") {
        return None;
    }
    let size: usize = header.split_whitespace().nth(2)?.parse().ok()?;
    let mut buf = vec![0u8; size];
    reader.read_exact(&mut buf).ok()?;
    let mut nl = [0u8; 1];
    let _ = reader.read_exact(&mut nl);
    Some(buf)
}

pub fn dirty_set(project_root: &Path) -> DirtySet {
    let mut set = DirtySet::default();
    let root = project_root.to_string_lossy();
    if let Some(paths) = git_z(
        &root,
        &["ls-files", "-z", "-m", "-o", "--exclude-standard"],
    ) {
        for path in paths {
            if path.is_empty() || crate::util::should_skip_file(&path) {
                continue;
            }
            set.changed.push(path);
        }
    }
    if let Some(paths) = git_z(&root, &["ls-files", "-z", "-d"]) {
        for path in paths {
            if path.is_empty() || crate::util::should_skip_file(&path) {
                continue;
            }
            set.deleted.push(path);
        }
    }
    set
}

pub fn show_head_file(project_root: &Path, rel: &str) -> Option<Vec<u8>> {
    let output = Command::new("git")
        .args(["-C", &project_root.to_string_lossy(), "show", &format!("HEAD:{rel}")])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(output.stdout)
}

fn git_z(root: &str, args: &[&str]) -> Option<Vec<String>> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(split_z(&output.stdout))
}

fn split_z(bytes: &[u8]) -> Vec<String> {
    bytes
        .split(|b| *b == 0)
        .filter(|s| !s.is_empty())
        .map(|s| String::from_utf8_lossy(s).replace('\\', "/"))
        .collect()
}
