// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "PipiUI",
    platforms: [.macOS(.v14)],
    products: [
        // Product name stays `PipiUI` so `swift run` / make-app keep familiar paths.
        .executable(name: "PipiUI", targets: ["PipiUIApp"]),
    ],
    targets: [
        .target(
            name: "PipiUI",
            path: "Sources/PipiUI",
            resources: [
                // App 自有的 pi 插件（补丁版 subagent + 我们的 agents），
                // 运行时拷到 Application Support 并 -e 加载，独立于 ~/.pi
                .copy("PiExt"),
                // pipi-philosophy 的随包快照：安装为 pi 的本地 package，
                // 所以裸 TUI 也吃得到（refresh: ./scripts/sync-philosophy.sh）
                .copy("PiPhilosophy"),
                .copy("Resources")
            ]
        ),
        .executableTarget(
            name: "PipiUIApp",
            dependencies: ["PipiUI"],
            path: "Sources/PipiUIApp"
        ),
        .testTarget(
            name: "PipiUITests",
            dependencies: ["PipiUI"],
            path: "Tests/PipiUITests"
        ),
    ]
)
