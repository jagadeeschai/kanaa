// Film physics on the GPU (film_service.py's fast path), with Core Image. The same formulas as
// film_service.halation_frame and film_service.shake_frame.
// halation: the brightest parts picked out, spread at half size into a soft glow, tinted warm, screened over the picture.
// shake: each frame shifted, turned and zoomed about the middle by the camera sent with it.
// For each frame, stdin holds the camera (four float32s: across and down as shares of the width, turn in degrees, zoom;
// unused for halation), then the frame (BGRA, WIDTH×HEIGHT). Writes BGRA frames on stdout.
// Usage: film_render halation|shake WIDTH HEIGHT STRENGTH THRESHOLD SPREAD TINT_R TINT_G TINT_B
import CoreImage
import Foundation

let arguments = CommandLine.arguments
guard arguments.count == 10, ["halation", "shake"].contains(arguments[1]), let width = Int(arguments[2]), let height = Int(arguments[3]),
      let strength = Double(arguments[4]), let threshold = Double(arguments[5]), let spread = Double(arguments[6]),
      let tintR = Double(arguments[7]), let tintG = Double(arguments[8]), let tintB = Double(arguments[9]) else {
    FileHandle.standardError.write("usage: film_render halation|shake WIDTH HEIGHT STRENGTH THRESHOLD SPREAD TINT_R TINT_G TINT_B\n".data(using: .utf8)!)
    exit(2)
}
let halation = arguments[1] == "halation"

// Only the brightest parts give off a glow: smoothstep from the threshold, weighted by brightness.
let highlights = CIColorKernel(source: """
kernel vec4 highlights(__sample picture, float threshold) {
    float luma = dot(picture.rgb, vec3(0.299, 0.587, 0.114));
    float t = clamp((luma - threshold) / max(0.001, 1.0 - threshold), 0.0, 1.0);
    return vec4(picture.rgb * (t * t * (3.0 - 2.0 * t) * luma), 1.0);
}
""")!
// The glow's brightness in film's warm colour, screened over the picture.
let glowOver = CIColorKernel(source: """
kernel vec4 glowOver(__sample picture, __sample glow, vec3 tint, float strength) {
    vec3 light = clamp((glow.r + glow.g + glow.b) / 3.0 * tint * strength * 2.5, 0.0, 1.0);
    return vec4(clamp(1.0 - (1.0 - picture.rgb) * (1.0 - light), 0.0, 1.0), 1.0);
}
""")!

let context = CIContext(options: [.workingColorSpace: NSNull(), .outputColorSpace: NSNull(), .cacheIntermediates: false])
let bounds = CGRect(x: 0, y: 0, width: width, height: height)
let tint = CIVector(x: tintR, y: tintG, z: tintB)
let frameBytes = width * height * 4
let input = FileHandle.standardInput, output = FileHandle.standardOutput
var outputFrame = [UInt8](repeating: 0, count: frameBytes)
let halfWidth = max(8, width / 2), halfHeight = max(8, height / 2)

func read(_ count: Int) -> Data? {
    var data = Data(capacity: count)
    while data.count < count {
        guard let chunk = try? input.read(upToCount: count - data.count), !chunk.isEmpty else { return nil }
        data.append(chunk)
    }
    return data
}

while let header = read(16), let frameData = read(frameBytes) {
    autoreleasepool {
        let picture = CIImage(bitmapData: frameData, bytesPerRow: width * 4, size: CGSize(width: width, height: height), format: .BGRA8, colorSpace: nil)
        var result: CIImage
        if halation {
            let source = highlights.apply(extent: bounds, arguments: [picture, threshold])!
            let down = CGAffineTransform(scaleX: CGFloat(halfWidth) / CGFloat(width), y: CGFloat(halfHeight) / CGFloat(height))
            let glow = source.transformed(by: down).clampedToExtent().applyingGaussianBlur(sigma: max(0.5, spread * Double(height) / 2))
                .transformed(by: down.inverted()).cropped(to: bounds)
            result = glowOver.apply(extent: bounds, arguments: [picture, glow, tint, strength])!
        } else {
            let camera = header.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in (0..<4).map { CGFloat(raw.load(fromByteOffset: $0 * 4, as: Float.self)) } }
            let (across, down, turn, zoom) = (camera[0], camera[1], camera[2], camera[3])
            // About the middle: turn and zoom, then shift (rows count up here, so down is negative).
            let middle = CGPoint(x: CGFloat(width) / 2, y: CGFloat(height) / 2)
            let move = CGAffineTransform(translationX: middle.x + across * CGFloat(width), y: middle.y - down * CGFloat(width))
                .rotated(by: turn * .pi / 180).scaledBy(x: zoom, y: zoom).translatedBy(x: -middle.x, y: -middle.y)
            result = picture.clampedToExtent().transformed(by: move).cropped(to: bounds)
        }
        outputFrame.withUnsafeMutableBytes { bytes in
            context.render(result, toBitmap: bytes.baseAddress!, rowBytes: width * 4, bounds: bounds, format: .BGRA8, colorSpace: nil)
        }
        output.write(Data(outputFrame))
    }
}
