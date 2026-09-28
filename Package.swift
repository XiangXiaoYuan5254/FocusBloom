// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "FocusBloom",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "FocusBloom", targets: ["FocusBloom"])
    ],
    dependencies: [
        // 自动更新
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.10.0")
    ],
    targets: [
        .executableTarget(
            name: "FocusBloom",
            dependencies: [
                .product(name: "Sparkle", package: "Sparkle")
            ],
            path: "Sources/FocusBloom"
        )
    ]
)
