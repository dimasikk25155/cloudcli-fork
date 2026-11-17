// Иконка «Пульта моста»: градиентная плитка в стиле значков Neo3 + 🌉. Пишет PNG 1024×1024.
import AppKit
let size = 1024.0
let image = NSImage(size: NSSize(width: size, height: size))
image.lockFocus()
let rect = NSRect(x: 0, y: 0, width: size, height: size)
let tile = NSBezierPath(roundedRect: rect.insetBy(dx: 90, dy: 90), xRadius: 190, yRadius: 190)
NSGradient(colors: [NSColor(calibratedRed: 0.20, green: 0.45, blue: 0.98, alpha: 1),
                    NSColor(calibratedRed: 0.45, green: 0.20, blue: 0.85, alpha: 1)])!.draw(in: tile, angle: -60)
let glyph = "🌉" as NSString
let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 520)]
let g = glyph.size(withAttributes: attrs)
glyph.draw(at: NSPoint(x: (size - g.width) / 2, y: (size - g.height) / 2 - 10), withAttributes: attrs)
image.unlockFocus()
let rep = NSBitmapImageRep(data: image.tiffRepresentation!)!
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
