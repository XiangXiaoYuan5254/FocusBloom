import AppKit

let size = NSSize(width: 1024, height: 1024)
let image = NSImage(size: size)

image.lockFocus()

guard let context = NSGraphicsContext.current?.cgContext else {
    fatalError("No graphics context")
}

context.setAllowsAntialiasing(true)

let outer = NSBezierPath(
    roundedRect: NSRect(x: 36, y: 36, width: 952, height: 952),
    xRadius: 220,
    yRadius: 220
)
NSGradient(colors: [
    NSColor(calibratedRed: 0.05, green: 0.10, blue: 0.11, alpha: 1),
    NSColor(calibratedRed: 0.08, green: 0.17, blue: 0.16, alpha: 1)
])!.draw(in: outer, angle: -45)

NSColor(calibratedRed: 0.47, green: 0.84, blue: 0.70, alpha: 0.12).setFill()
NSBezierPath(ovalIn: NSRect(x: 195, y: 190, width: 635, height: 635)).fill()

NSColor(calibratedRed: 0.47, green: 0.84, blue: 0.70, alpha: 0.2).setStroke()
let orbit = NSBezierPath(ovalIn: NSRect(x: 236, y: 236, width: 552, height: 552))
orbit.lineWidth = 12
orbit.stroke()

let leaf = NSBezierPath()
leaf.move(to: NSPoint(x: 510, y: 255))
leaf.curve(
    to: NSPoint(x: 745, y: 565),
    controlPoint1: NSPoint(x: 670, y: 290),
    controlPoint2: NSPoint(x: 770, y: 420)
)
leaf.curve(
    to: NSPoint(x: 492, y: 750),
    controlPoint1: NSPoint(x: 695, y: 700),
    controlPoint2: NSPoint(x: 565, y: 748)
)
leaf.curve(
    to: NSPoint(x: 275, y: 520),
    controlPoint1: NSPoint(x: 360, y: 720),
    controlPoint2: NSPoint(x: 270, y: 645)
)
leaf.curve(
    to: NSPoint(x: 510, y: 255),
    controlPoint1: NSPoint(x: 280, y: 375),
    controlPoint2: NSPoint(x: 390, y: 295)
)
leaf.close()

NSGradient(colors: [
    NSColor(calibratedRed: 0.66, green: 0.95, blue: 0.82, alpha: 1),
    NSColor(calibratedRed: 0.37, green: 0.74, blue: 0.62, alpha: 1)
])!.draw(in: leaf, angle: -30)

let stem = NSBezierPath()
stem.move(to: NSPoint(x: 405, y: 675))
stem.curve(
    to: NSPoint(x: 628, y: 395),
    controlPoint1: NSPoint(x: 470, y: 570),
    controlPoint2: NSPoint(x: 545, y: 475)
)
NSColor(calibratedWhite: 1, alpha: 0.72).setStroke()
stem.lineWidth = 25
stem.lineCapStyle = .round
stem.stroke()

NSColor(calibratedRed: 1, green: 0.60, blue: 0.47, alpha: 1).setFill()
NSBezierPath(ovalIn: NSRect(x: 742, y: 706, width: 62, height: 62)).fill()

image.unlockFocus()

guard
    let tiff = image.tiffRepresentation,
    let bitmap = NSBitmapImageRep(data: tiff),
    let png = bitmap.representation(using: .png, properties: [:])
else {
    fatalError("Could not encode icon")
}

let destination = CommandLine.arguments.dropFirst().first ?? "FocusBloomIcon.png"
try png.write(to: URL(fileURLWithPath: destination))
