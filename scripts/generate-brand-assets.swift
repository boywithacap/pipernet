import AppKit
import CoreText
import ImageIO
import UniformTypeIdentifiers

// Run from the project root on macOS:
// swift -module-cache-path /tmp/pipernet-brand-cache scripts/generate-brand-assets.swift
// The onboarding headings use iOS ui-serif / Android serif, at regular weight.
let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let config = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("app.json"))) as! [String: Any]
let name = (config["expo"] as! [String: Any])["name"] as! String
let output = root.appendingPathComponent("assets/images/branding", isDirectory: true)
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)

let descriptor = NSFont.systemFont(ofSize: 36, weight: .regular).fontDescriptor.withDesign(.serif)!
let font = NSFont(descriptor: descriptor, size: 36)!
let text = NSAttributedString(string: name, attributes: [.font: font, .kern: -0.8])
let line = CTLineCreateWithAttributedString(text)
let wordmark = CGMutablePath()
for run in CTLineGetGlyphRuns(line) as! [CTRun] {
    let count = CTRunGetGlyphCount(run)
    var glyphs = [CGGlyph](repeating: 0, count: count)
    var positions = [CGPoint](repeating: .zero, count: count)
    CTRunGetGlyphs(run, CFRange(location: 0, length: count), &glyphs)
    CTRunGetPositions(run, CFRange(location: 0, length: count), &positions)
    let runFont = (CTRunGetAttributes(run) as NSDictionary)[kCTFontAttributeName] as! CTFont
    for index in 0..<count {
        if let glyph = CTFontCreatePathForGlyph(runFont, glyphs[index], nil) {
            wordmark.addPath(glyph, transform: CGAffineTransform(translationX: positions[index].x, y: positions[index].y))
        }
    }
}
let bounds = wordmark.boundingBoxOfPath
guard !bounds.isEmpty else { fatalError("The wordmark has no glyphs") }

func render(_ filename: String, size: CGSize, width: CGFloat, opaque: Bool, inverted: Bool = false, showWordmark: Bool = true) throws {
    let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
    let alpha = opaque ? CGImageAlphaInfo.noneSkipLast : CGImageAlphaInfo.premultipliedLast
    let context = CGContext(data: nil, width: Int(size.width), height: Int(size.height), bitsPerComponent: 8, bytesPerRow: 0, space: colorSpace, bitmapInfo: alpha.rawValue)!
    if opaque {
        let background: CGFloat = inverted ? 0 : 1
        context.setFillColor(CGColor(colorSpace: colorSpace, components: [background, background, background, 1])!)
        context.fill(CGRect(origin: .zero, size: size))
    }
    if showWordmark {
        let scale = width / bounds.width
        context.translateBy(x: size.width / 2, y: size.height / 2)
        context.scaleBy(x: scale, y: scale)
        context.translateBy(x: -bounds.midX, y: -bounds.midY)
        let ink: CGFloat = inverted ? 1 : 17.0 / 255
        context.setFillColor(CGColor(colorSpace: colorSpace, components: [ink, ink, ink, 1])!)
        context.addPath(wordmark)
        context.fillPath()
    }
    let destination = CGImageDestinationCreateWithURL(output.appendingPathComponent(filename) as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, context.makeImage()!, nil)
    guard CGImageDestinationFinalize(destination) else { fatalError("Could not export \(filename)") }
}

try render("wordmark-icon.png", size: CGSize(width: 1024, height: 1024), width: 864, opaque: true)
try render("wordmark-icon-dark.png", size: CGSize(width: 1024, height: 1024), width: 864, opaque: true, inverted: true)
// A single black alpha layer serves both the color and Android themed icons.
let safeWidth = 580 / hypot(1, bounds.height / bounds.width)
try render("wordmark-android.png", size: CGSize(width: 1024, height: 1024), width: safeWidth, opaque: false)
// The native launch is background-only; React writes the wordmark after handoff.
try render("native-splash.png", size: CGSize(width: 1024, height: 1024), width: 864, opaque: false, showWordmark: false)
print("Generated \(name) wordmark in \(output.path), using \(font.fontName).")
