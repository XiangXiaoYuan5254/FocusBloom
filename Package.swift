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
    targets: [
        .executableTarget(
            name: "FocusBloom",
            path: "Sources/FocusBloom"
        )
    ]
)
