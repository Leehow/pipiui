#!/usr/bin/env python3
"""Generate native SwiftUI provider-logo paths from pinned SVG releases.

The generated app has no network or SVG parsing dependency. This script downloads
the exact archives only while regenerating, verifies npm integrity, converts SVG
commands (including arcs) to native SwiftUI Path layers, and emits deterministic
Swift source that preserves fill rule and opacity.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import math
import re
import tarfile
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path


SIMPLE_ICONS_VERSION = "16.21.0"
SIMPLE_ICONS_URL = (
    "https://registry.npmjs.org/simple-icons/-/"
    f"simple-icons-{SIMPLE_ICONS_VERSION}.tgz"
)
SIMPLE_ICONS_SHA512 = "kH6LEx5yvBGVNaVrHnZ7D17G16CmmHiI8DD7MwIwgnWmDFTiFu4PhFZLNdV6bMGr61qbHMMTXLoo/T6C25dMGA=="
LOBE_ICONS_VERSION = "1.91.0"
LOBE_ICONS_URL = (
    "https://registry.npmjs.org/@lobehub/icons-static-svg/-/"
    f"icons-static-svg-{LOBE_ICONS_VERSION}.tgz"
)
LOBE_ICONS_SHA512 = "ZDflEq0uUvAkH4WK4h3qNvvY09ts4OqUb5azD7A0xKfcuYhffGwB1Q/As2RguZYq4Gh4v925CJ8iodiClzc4zw=="
OUTPUT = Path("Sources/PipiUI/Views/GeneratedProviderLogoShapes.swift")

# PipiUI asset name -> upstream slug.
SIMPLE_ICON_MAP = {
    "anthropic": "anthropic",
    "deepseek": "deepseek",
    "google": "google",
    "huggingface": "huggingface",
    "meta": "meta",
    "minimax": "minimax",
    "mistral": "mistralai",
    "nvidia": "nvidia",
    "openrouter": "openrouter",
    "qwen": "qwen",
}
LOBE_ICON_MAP = {
    "codex": "codex",
    "groq": "groq",
    "kimi": "kimi",
    "openai": "openai",
    "qoder": "qoder",
    "xai": "xai",
    "zhipu": "zhipu",
}
KNOWN_ASSETS = {
    "anthropic",
    "codex",
    "deepseek",
    "google",
    "groq",
    "huggingface",
    "kimi",
    "meta",
    "minimax",
    "mistral",
    "nvidia",
    "openai",
    "openrouter",
    "qoder",
    "qwen",
    "xai",
    "zhipu",
}

TOKEN_RE = re.compile(
    r"[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?"
)
PARAM_COUNTS = {
    "M": 2,
    "L": 2,
    "H": 1,
    "V": 1,
    "C": 6,
    "S": 4,
    "Q": 4,
    "T": 2,
    "A": 7,
    "Z": 0,
}


def tokenize_path(data: str) -> list[str]:
    """Tokenize SVG data, including compact adjacent arc flags such as `01`."""
    raw = TOKEN_RE.findall(data.replace(",", " "))
    tokens: list[str] = []
    active: str | None = None
    parameter_index = 0
    index = 0
    while index < len(raw):
        token = raw[index]
        index += 1
        if token.isalpha():
            tokens.append(token)
            active = token.upper()
            parameter_index = 0
            continue
        if active == "A" and parameter_index in {3, 4}:
            if not token or token[0] not in {"0", "1"}:
                raise ValueError(f"Invalid SVG arc flag: {token}")
            tokens.append(token[0])
            remainder = token[1:]
            if remainder:
                raw.insert(index, remainder)
        else:
            tokens.append(token)
        if active is not None:
            parameter_index = (parameter_index + 1) % PARAM_COUNTS[active]
    return tokens


def number(value: float) -> str:
    if abs(value) < 0.0000005:
        value = 0.0
    rendered = f"{value:.6f}".rstrip("0").rstrip(".")
    if rendered == "-0":
        return "0"
    return rendered


def vector_angle(ux: float, uy: float, vx: float, vy: float) -> float:
    dot = ux * vx + uy * vy
    length = math.hypot(ux, uy) * math.hypot(vx, vy)
    if length == 0:
        return 0
    angle = math.acos(max(-1.0, min(1.0, dot / length)))
    return -angle if ux * vy - uy * vx < 0 else angle


def arc_to_cubics(
    x1: float,
    y1: float,
    rx: float,
    ry: float,
    rotation: float,
    large_arc: bool,
    sweep: bool,
    x2: float,
    y2: float,
) -> list[tuple[float, float, float, float, float, float]]:
    """Convert one SVG endpoint arc to cubic Bézier segments."""
    rx, ry = abs(rx), abs(ry)
    if rx == 0 or ry == 0 or (x1 == x2 and y1 == y2):
        return []

    phi = math.radians(rotation % 360)
    cos_phi, sin_phi = math.cos(phi), math.sin(phi)
    dx, dy = (x1 - x2) / 2, (y1 - y2) / 2
    x1p = cos_phi * dx + sin_phi * dy
    y1p = -sin_phi * dx + cos_phi * dy

    radius_scale = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry)
    if radius_scale > 1:
        scale = math.sqrt(radius_scale)
        rx *= scale
        ry *= scale

    numerator = max(
        0.0,
        rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p,
    )
    denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p
    coefficient = 0.0 if denominator == 0 else math.sqrt(numerator / denominator)
    if large_arc == sweep:
        coefficient = -coefficient
    cxp = coefficient * (rx * y1p / ry)
    cyp = coefficient * (-ry * x1p / rx)

    cx = cos_phi * cxp - sin_phi * cyp + (x1 + x2) / 2
    cy = sin_phi * cxp + cos_phi * cyp + (y1 + y2) / 2
    ux, uy = (x1p - cxp) / rx, (y1p - cyp) / ry
    vx, vy = (-x1p - cxp) / rx, (-y1p - cyp) / ry
    theta1 = vector_angle(1, 0, ux, uy)
    delta = vector_angle(ux, uy, vx, vy)
    if not sweep and delta > 0:
        delta -= 2 * math.pi
    elif sweep and delta < 0:
        delta += 2 * math.pi

    segment_count = max(1, math.ceil(abs(delta) / (math.pi / 2)))
    segment_delta = delta / segment_count
    curves = []

    def map_point(px: float, py: float) -> tuple[float, float]:
        return (
            cx + rx * cos_phi * px - ry * sin_phi * py,
            cy + rx * sin_phi * px + ry * cos_phi * py,
        )

    for index in range(segment_count):
        start = theta1 + index * segment_delta
        end = start + segment_delta
        alpha = 4 / 3 * math.tan((end - start) / 4)
        cos_start, sin_start = math.cos(start), math.sin(start)
        cos_end, sin_end = math.cos(end), math.sin(end)
        c1 = map_point(cos_start - alpha * sin_start, sin_start + alpha * cos_start)
        c2 = map_point(cos_end + alpha * sin_end, sin_end - alpha * cos_end)
        endpoint = map_point(cos_end, sin_end)
        curves.append((*c1, *c2, *endpoint))
    return curves


def parse_path(data: str) -> list[tuple]:
    tokens = tokenize_path(data)
    commands: list[tuple] = []
    index = 0
    active: str | None = None
    x = y = 0.0
    start_x = start_y = 0.0
    last_cubic_control: tuple[float, float] | None = None
    last_quadratic_control: tuple[float, float] | None = None

    while index < len(tokens):
        if tokens[index].isalpha():
            active = tokens[index]
            index += 1
        if active is None:
            raise ValueError("SVG path starts without a command")
        upper = active.upper()
        relative = active.islower()
        if upper == "Z":
            commands.append(("close",))
            x, y = start_x, start_y
            last_cubic_control = last_quadratic_control = None
            active = None
            continue

        count = PARAM_COUNTS[upper]
        if index + count > len(tokens):
            raise ValueError(f"Incomplete SVG {active} command")
        values = [float(value) for value in tokens[index : index + count]]
        index += count

        if upper == "M":
            nx, ny = values
            if relative:
                nx, ny = x + nx, y + ny
            commands.append(("move", nx, ny))
            x, y = nx, ny
            start_x, start_y = x, y
            active = "l" if relative else "L"
        elif upper == "L":
            nx, ny = values
            if relative:
                nx, ny = x + nx, y + ny
            commands.append(("line", nx, ny))
            x, y = nx, ny
        elif upper == "H":
            nx = x + values[0] if relative else values[0]
            commands.append(("line", nx, y))
            x = nx
        elif upper == "V":
            ny = y + values[0] if relative else values[0]
            commands.append(("line", x, ny))
            y = ny
        elif upper == "C":
            c1x, c1y, c2x, c2y, nx, ny = values
            if relative:
                c1x, c1y = x + c1x, y + c1y
                c2x, c2y = x + c2x, y + c2y
                nx, ny = x + nx, y + ny
            commands.append(("curve", c1x, c1y, c2x, c2y, nx, ny))
            last_cubic_control = (c2x, c2y)
            x, y = nx, ny
        elif upper == "S":
            c2x, c2y, nx, ny = values
            c1x, c1y = (
                (2 * x - last_cubic_control[0], 2 * y - last_cubic_control[1])
                if last_cubic_control
                else (x, y)
            )
            if relative:
                c2x, c2y = x + c2x, y + c2y
                nx, ny = x + nx, y + ny
            commands.append(("curve", c1x, c1y, c2x, c2y, nx, ny))
            last_cubic_control = (c2x, c2y)
            x, y = nx, ny
        elif upper == "Q":
            cx, cy, nx, ny = values
            if relative:
                cx, cy = x + cx, y + cy
                nx, ny = x + nx, y + ny
            commands.append(("quad", cx, cy, nx, ny))
            last_quadratic_control = (cx, cy)
            x, y = nx, ny
        elif upper == "T":
            cx, cy = (
                (2 * x - last_quadratic_control[0], 2 * y - last_quadratic_control[1])
                if last_quadratic_control
                else (x, y)
            )
            nx, ny = values
            if relative:
                nx, ny = x + nx, y + ny
            commands.append(("quad", cx, cy, nx, ny))
            last_quadratic_control = (cx, cy)
            x, y = nx, ny
        elif upper == "A":
            rx, ry, rotation, large_arc, sweep, nx, ny = values
            if relative:
                nx, ny = x + nx, y + ny
            curves = arc_to_cubics(
                x, y, rx, ry, rotation, bool(large_arc), bool(sweep), nx, ny
            )
            if curves:
                commands.extend(("curve", *curve) for curve in curves)
            else:
                commands.append(("line", nx, ny))
            x, y = nx, ny

        if upper not in {"C", "S"}:
            last_cubic_control = None
        if upper not in {"Q", "T"}:
            last_quadratic_control = None

    return commands


def load_archive(
    path: Path | None,
    url: str,
    expected_sha512: str,
    source_name: str,
) -> bytes:
    if path is not None:
        payload = path.read_bytes()
    else:
        with urllib.request.urlopen(url) as response:
            payload = response.read()
    actual = base64.b64encode(hashlib.sha512(payload).digest()).decode()
    if actual != expected_sha512:
        raise ValueError(f"{source_name} archive integrity mismatch: {actual}")
    return payload


def load_icons(
    archive: bytes,
    icon_map: dict[str, str],
    source_name: str,
) -> dict[str, list[tuple[list[tuple], bool, float]]]:
    icons: dict[str, list[tuple[list[tuple], bool, float]]] = {}
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as package:
        members = {member.name: member for member in package.getmembers()}
        for asset, slug in icon_map.items():
            name = f"package/icons/{slug}.svg"
            member = members.get(name)
            if member is None:
                raise ValueError(f"Pinned {source_name} release lacks {slug}.svg")
            stream = package.extractfile(member)
            if stream is None:
                raise ValueError(f"Unable to read {name}")
            root = ET.fromstring(stream.read())
            view_box = root.attrib.get("viewBox")
            if view_box != "0 0 24 24":
                raise ValueError(f"Unexpected {slug} viewBox: {view_box}")
            root_fill_rule = root.attrib.get("fill-rule", "nonzero")
            root_opacity = float(root.attrib.get("opacity", "1"))
            layers = []
            for node in root.iter():
                if not node.tag.endswith("path") or not node.attrib.get("d"):
                    continue
                fill_rule = (
                    node.attrib.get("fill-rule")
                    or node.attrib.get("clip-rule")
                    or root_fill_rule
                )
                if fill_rule not in {"evenodd", "nonzero"}:
                    raise ValueError(f"Unsupported {slug} fill rule: {fill_rule}")
                opacity = root_opacity * float(node.attrib.get("opacity", "1"))
                if not 0 <= opacity <= 1:
                    raise ValueError(f"Invalid {slug} path opacity: {opacity}")
                try:
                    commands = parse_path(node.attrib["d"])
                except (ValueError, KeyError) as error:
                    raise ValueError(f"Unable to parse {source_name} {slug}: {error}") from error
                layers.append((commands, fill_rule == "evenodd", opacity))
            if not layers:
                raise ValueError(f"No path in {slug}.svg")
            icons[asset] = layers
    return icons


def swift_command(command: tuple) -> str:
    name, *values = command
    args = ", ".join(number(value) for value in values)
    return f".{name}({args})" if values else f".{name}"


def generate(
    icons: dict[str, list[tuple[list[tuple], bool, float]]],
    sources: dict[str, str],
) -> str:
    missing = sorted(KNOWN_ASSETS - set(icons))
    if missing:
        raise ValueError(f"Known provider logos missing vector sources: {missing}")
    lines = [
        "// Generated by scripts/generate-provider-logo-shapes.py. DO NOT EDIT.",
        f"// Source: Simple Icons {SIMPLE_ICONS_VERSION} ({SIMPLE_ICONS_URL}) — CC0-1.0",
        f"// Source: @lobehub/icons-static-svg {LOBE_ICONS_VERSION} ({LOBE_ICONS_URL}) — MIT",
        "// Generated app uses only native SwiftUI Path layers; bundled PNGs are not rendered.",
        "",
        "import SwiftUI",
        "",
        "enum ProviderLogoPathCommand {",
        "    case move(CGFloat, CGFloat)",
        "    case line(CGFloat, CGFloat)",
        "    case curve(CGFloat, CGFloat, CGFloat, CGFloat, CGFloat, CGFloat)",
        "    case quad(CGFloat, CGFloat, CGFloat, CGFloat)",
        "    case close",
        "}",
        "",
        "struct ProviderLogoPathLayer {",
        "    let commands: [ProviderLogoPathCommand]",
        "    let usesEvenOddFill: Bool",
        "    let opacity: Double",
        "}",
        "",
        "enum GeneratedProviderLogoShapes {",
        f'    static let simpleIconsVersion = "{SIMPLE_ICONS_VERSION}"',
        f'    static let lobeIconsVersion = "{LOBE_ICONS_VERSION}"',
        "    static let vectorAssetNames: Set<String> = [",
    ]
    lines.extend(f'        "{asset}",' for asset in sorted(icons))
    lines += [
        "    ]",
        "",
        "    static let assetSources: [String: String] = [",
    ]
    lines.extend(f'        "{asset}": "{sources[asset]}",' for asset in sorted(icons))
    lines += [
        "    ]",
        "",
        "    static func layers(for asset: String) -> [ProviderLogoPathLayer]? {",
        "        switch asset {",
    ]
    for asset in sorted(icons):
        lines += [f'        case "{asset}":', "            return ["]
        for commands, uses_even_odd, opacity in icons[asset]:
            lines.append("                ProviderLogoPathLayer(")
            lines.append("                    commands: [")
            lines.extend(f"                        {swift_command(command)}," for command in commands)
            lines += [
                "                    ],",
                f"                    usesEvenOddFill: {'true' if uses_even_odd else 'false'},",
                f"                    opacity: {number(opacity)}",
                "                ),",
            ]
        lines.append("            ]")
    lines += [
        "        default:",
        "            return nil",
        "        }",
        "    }",
        "",
        "    static func path(for layer: ProviderLogoPathLayer, in rect: CGRect) -> Path {",
        "        let scale = min(rect.width, rect.height) / 24",
        "        let originX = rect.midX - 12 * scale",
        "        let originY = rect.midY - 12 * scale",
        "        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {",
        "            CGPoint(x: originX + x * scale, y: originY + y * scale)",
        "        }",
        "        var path = Path()",
        "        for command in layer.commands {",
        "            switch command {",
        "            case let .move(x, y):",
        "                path.move(to: point(x, y))",
        "            case let .line(x, y):",
        "                path.addLine(to: point(x, y))",
        "            case let .curve(c1x, c1y, c2x, c2y, x, y):",
        "                path.addCurve(",
        "                    to: point(x, y),",
        "                    control1: point(c1x, c1y),",
        "                    control2: point(c2x, c2y)",
        "                )",
        "            case let .quad(cx, cy, x, y):",
        "                path.addQuadCurve(to: point(x, y), control: point(cx, cy))",
        "            case .close:",
        "                path.closeSubpath()",
        "            }",
        "        }",
        "        return path",
        "    }",
        "",
        "    static func commandCount(for asset: String) -> Int {",
        "        layers(for: asset)?.reduce(0) { $0 + $1.commands.count } ?? 0",
        "    }",
        "",
        "    static func layerCount(for asset: String) -> Int {",
        "        layers(for: asset)?.count ?? 0",
        "    }",
        "}",
        "",
        "private struct GeneratedProviderLogoLayerShape: Shape {",
        "    let layer: ProviderLogoPathLayer",
        "",
        "    func path(in rect: CGRect) -> Path {",
        "        GeneratedProviderLogoShapes.path(for: layer, in: rect)",
        "    }",
        "}",
        "",
        "struct GeneratedProviderLogoView: View {",
        "    let asset: String",
        "",
        "    var body: some View {",
        "        if let layers = GeneratedProviderLogoShapes.layers(for: asset) {",
        "            ZStack {",
        "                ForEach(Array(layers.indices), id: \\.self) { index in",
        "                    let layer = layers[index]",
        "                    GeneratedProviderLogoLayerShape(layer: layer)",
        "                        .fill(",
        "                            .primary,",
        "                            style: FillStyle(eoFill: layer.usesEvenOddFill)",
        "                        )",
        "                        .opacity(layer.opacity)",
        "                }",
        "            }",
        "        }",
        "    }",
        "}",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--archive",
        type=Path,
        help="Use a local simple-icons-16.21.0.tgz (still integrity-checked)",
    )
    parser.add_argument(
        "--lobe-archive",
        type=Path,
        help="Use a local icons-static-svg-1.91.0.tgz (still integrity-checked)",
    )
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    output = args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    simple_icons = load_icons(
        load_archive(
            args.archive,
            SIMPLE_ICONS_URL,
            SIMPLE_ICONS_SHA512,
            "Simple Icons",
        ),
        SIMPLE_ICON_MAP,
        "Simple Icons",
    )
    lobe_icons = load_icons(
        load_archive(
            args.lobe_archive,
            LOBE_ICONS_URL,
            LOBE_ICONS_SHA512,
            "@lobehub/icons-static-svg",
        ),
        LOBE_ICON_MAP,
        "@lobehub/icons-static-svg",
    )
    overlap = set(simple_icons) & set(lobe_icons)
    if overlap:
        raise ValueError(f"Duplicate provider logo sources: {sorted(overlap)}")
    icons = simple_icons | lobe_icons
    sources = {
        **{asset: "Simple Icons" for asset in simple_icons},
        **{asset: "LobeHub" for asset in lobe_icons},
    }
    output.write_text(generate(icons, sources), encoding="utf-8")
    print(
        f"Generated {output} from Simple Icons {SIMPLE_ICONS_VERSION} "
        f"and LobeHub {LOBE_ICONS_VERSION}"
    )


if __name__ == "__main__":
    main()
