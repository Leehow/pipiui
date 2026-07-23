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
                .copy("PiExt")
            ]
        ),
        .executableTarget(
            name: "PipiUIApp",
            dependencies: ["PipiUI"],
            path: "Sources/PipiUIApp"
        ),
        // CLT-only hosts have no XCTest.framework and Apple's swiftpm-testing-helper
        // does not actually execute Swift Testing cases. This executable runs the same
        // suite via a tiny harness (`MiniXCTest` + `PipiUITestsMain.runAll`).
        // Use: `swift run PipiUITestRunner`  (alias for planned `swift test` verification)
        .executableTarget(
            name: "PipiUITestRunner",
            dependencies: ["PipiUI"],
            path: "Tests/PipiUITests"
        ),
    ]
)
