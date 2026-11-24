"""Activate one prepared release on the download host after its upload finishes."""
import base64
import fcntl
import hashlib
import json
import os
import re
import sys
import tempfile
from pathlib import Path

stage, downloads = map(Path, sys.argv[1:])
channels = list(stage.glob("*.yml")) + list(stage.glob("pipiui-extensions.json"))
if len(channels) != 1:
    raise ValueError("Expected one update channel")
channel = channels[0].name
data = json.loads(channels[0].read_bytes())


def version(value):
    if not re.fullmatch(r"(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)", value):
        raise ValueError("Expected a stable release version")
    return tuple(map(int, value.split(".")))


def digest(path, algorithm):
    value = hashlib.new(algorithm)
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value


def asset(name):
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._-]*", name):
        raise ValueError("Invalid release filename")
    return stage / name


with (downloads / ".official-update.lock").open("a") as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    current = downloads / channel
    prior = json.loads(current.read_bytes()) if current.exists() else {}
    if channel == "pipiui-extensions.json":
        if len(data["versions"]) != 1:
            raise ValueError("Expected one extension per upload")
        ext, ver = next(iter(data["versions"].items()))
        index = asset(f"{ext}-{ver}-assets.json")
        metadata = json.loads(index.read_bytes())
        if metadata["version"] != ver or metadata["baseUrl"] != "https://pipi.aichattrpg.com/downloads":
            raise ValueError("Unexpected extension asset index")
        versions = dict(prior.get("versions", {}))
        if version(ver) < version(versions.get(ext, "0.0.0")):
            raise ValueError("Refusing to roll back extension")
        versions[ext] = ver
        data = {"schemaVersion": 1, "versions": versions}
        package = asset(f"{ext}-{ver}.tar.gz")
        sha = digest(package, "sha256").hexdigest()
        if not metadata["assets"] or any(row["asset"] != package.name or row["sha256"] != sha or row["bytes"] != package.stat().st_size or not row.get("signature") for row in metadata["assets"].values()):
            raise ValueError("Extension payload verification failed")
        files = [package, index]
    else:
        if version(data["version"]) < version(prior.get("version", "0.0.0")):
            raise ValueError("Refusing to roll back software")
        row, = data["files"]
        package = asset(row["url"])
        sha = base64.b64encode(digest(package, "sha512").digest()).decode()
        if sha != row["sha512"] or row["size"] != package.stat().st_size:
            raise ValueError("Installer verification failed")
        files = [package]
    for path in files:
        target = downloads / path.name
        if target.exists():
            if digest(target, "sha256").digest() != digest(path, "sha256").digest():
                raise ValueError(f"Published filename already has different contents: {path.name}")
        else:
            path.chmod(0o644)
            os.link(path, target)
    with tempfile.NamedTemporaryFile(dir=downloads, delete=False, prefix=".channel-") as stream:
        stream.write((json.dumps(data, indent=2) + "\n").encode())
    try:
        os.chmod(stream.name, 0o644)
        os.replace(stream.name, current)
    finally:
        Path(stream.name).unlink(missing_ok=True)
print(channel)
