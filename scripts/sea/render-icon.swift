#!/usr/bin/env swift
// Render the PaperWeave 1024px app-icon source: navy background, centered "Pw".
import AppKit

let size = 1024
let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon-src.png"

let image = NSImage(size: NSSize(width: size, height: size))
image.lockFocus()

// navy background with subtle diagonal gradient
let navyTop = NSColor(calibratedRed: 0.10, green: 0.14, blue: 0.30, alpha: 1.0)
let navyBottom = NSColor(calibratedRed: 0.05, green: 0.07, blue: 0.18, alpha: 1.0)
let gradient = NSGradient(colors: [navyTop, navyBottom])!
gradient.draw(in: NSRect(x: 0, y: 0, width: size, height: size), angle: -90)

// "Pw" centered
let font = NSFont.systemFont(ofSize: 560, weight: .bold)
let attrs: [NSAttributedString.Key: Any] = [
    .font: font,
    .foregroundColor: NSColor(calibratedRed: 0.92, green: 0.94, blue: 1.0, alpha: 1.0),
]
let text = NSAttributedString(string: "Pw", attributes: attrs)
let textSize = text.size()
text.draw(at: NSPoint(x: (CGFloat(size) - textSize.width) / 2,
                      y: (CGFloat(size) - textSize.height) / 2))

image.unlockFocus()

guard let tiff = image.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let png = rep.representation(using: .png, properties: [:]) else {
    fatalError("failed to render PNG")
}
try! png.write(to: URL(fileURLWithPath: out))
print("wrote \(out)")
