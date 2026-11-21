// Draws the disk image window background: the app on the left, Applications on
// the right, an arrow between them and an instruction to drag. Run by
// tools/build-macos.cjs:  xcrun swift macos/dmg-background.swift <out.png> <scale>
// Icon positions here must match ICONS in tools/build-macos.cjs.

import AppKit

let width: CGFloat = 600, height: CGFloat = 400
let appX: CGFloat = 160, applicationsX: CGFloat = 440, iconY: CGFloat = 190 // from the top, like Finder

let arguments = CommandLine.arguments
guard arguments.count == 3, let scale = Double(arguments[2]) else {
    FileHandle.standardError.write("usage: dmg-background.swift <out.png> <scale>\n".data(using: .utf8)!)
    exit(2)
}
let output = URL(fileURLWithPath: arguments[1])

let pixelsWide = Int(width * scale), pixelsHigh = Int(height * scale)
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixelsWide, pixelsHigh: pixelsHigh,
                              bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                              colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
bitmap.size = NSSize(width: width, height: height) // draw in points; the rep holds scale × pixels

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)

// AppKit's origin is bottom-left; Finder's icon positions are from the top.
func y(_ top: CGFloat) -> CGFloat { height - top }

// Website colours: paper, sage accent, ink and muted text.
let paper = NSColor(srgbRed: 0.965, green: 0.969, blue: 0.957, alpha: 1)
let accent = NSColor(srgbRed: 0.204, green: 0.365, blue: 0.286, alpha: 1)
let ink = NSColor(srgbRed: 0.133, green: 0.145, blue: 0.133, alpha: 1)
let muted = NSColor(srgbRed: 0.314, green: 0.349, blue: 0.314, alpha: 1)

paper.setFill()
NSRect(x: 0, y: 0, width: width, height: height).fill()

// Arrow between the icons, clear of the 128-point icons themselves.
let arrow = NSBezierPath()
let start = appX + 84, end = applicationsX - 84, arrowY = y(iconY)
arrow.move(to: NSPoint(x: start, y: arrowY))
arrow.line(to: NSPoint(x: end - 14, y: arrowY))
arrow.lineWidth = 5
arrow.lineCapStyle = .round
accent.setStroke()
arrow.stroke()
let head = NSBezierPath()
head.move(to: NSPoint(x: end, y: arrowY))
head.line(to: NSPoint(x: end - 20, y: arrowY + 13))
head.line(to: NSPoint(x: end - 20, y: arrowY - 13))
head.close()
accent.setFill()
head.fill()

func centred(_ text: String, top: CGFloat, size: CGFloat, weight: NSFont.Weight, colour: NSColor) {
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = .center
    let attributes: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: size, weight: weight), .foregroundColor: colour, .paragraphStyle: paragraph,
    ]
    let string = NSAttributedString(string: text, attributes: attributes)
    let lineHeight = string.size().height
    string.draw(in: NSRect(x: 0, y: y(top) - lineHeight, width: width, height: lineHeight))
}

centred("Install EarsMixer", top: 34, size: 22, weight: .bold, colour: ink)
centred("Drag EarsMixer onto the Applications folder.", top: 300, size: 15, weight: .semibold, colour: ink)
centred("Then eject this disk and open EarsMixer from Applications.", top: 326, size: 13, weight: .regular, colour: muted)

NSGraphicsContext.restoreGraphicsState()
guard let png = bitmap.representation(using: .png, properties: [:]) else { exit(1) }
try png.write(to: output)
