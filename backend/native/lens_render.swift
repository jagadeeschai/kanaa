// Cinematic lens on the GPU (lens_service.py's fast path): each frame blurred by how far out of focus it is, from the
// clip's depth map, with Core Image's masked variable blur.
// Reads BGRA frames (WIDTH×HEIGHT) on stdin; the depth map's grey frames (DW×DH) from DEPTH (a file or pipe, read in
// step, the last one kept when it runs out); the focus of each frame (one number per line, nearness 0 far to 1 near)
// from FOCUS. Writes BGRA frames on stdout and "frame N" on stderr every ten frames.
// Usage: lens_render WIDTH HEIGHT DW DH AMOUNT GLOW(0|1) FOCUS DEPTH
import CoreImage
import Foundation

let arguments = CommandLine.arguments
guard arguments.count == 9, let width = Int(arguments[1]), let height = Int(arguments[2]), let depthWidth = Int(arguments[3]),
      let depthHeight = Int(arguments[4]), let amount = Double(arguments[5]), let glow = Int(arguments[6]) else {
    FileHandle.standardError.write("usage: lens_render WIDTH HEIGHT DW DH AMOUNT GLOW FOCUS DEPTH\n".data(using: .utf8)!)
    exit(2)
}
let focuses = (try? String(contentsOfFile: arguments[7], encoding: .utf8))?.split(separator: "\n").compactMap { Double($0) } ?? []
guard let depthInput = FileHandle(forReadingAtPath: arguments[8]) else { exit(3) }

// As lens_service: LEVELS (blur of each step, share of the height) and SHARP (nearness this close stays sharp).
let levels: [Double] = [0.0, 0.004, 0.009, 0.016, 0.026]
let sharp = 0.06
let largest = levels.last! * amount * Double(height)

// The blur each pixel needs, 0..1 of the largest, from its nearness and the focus: lens_service's steps, in one pass.
let outOfFocus = CIColorKernel(source: """
kernel vec4 outOfFocus(__sample depth, float focus, float sharp, float l1, float l2, float l3) {
    float off = clamp((abs(depth.r - focus) - sharp) / (1.0 - sharp), 0.0, 1.0) * 4.0;
    float level = off < 1.0 ? mix(0.0, l1, off) : off < 2.0 ? mix(l1, l2, off - 1.0) : off < 3.0 ? mix(l2, l3, off - 2.0) : mix(l3, 1.0, off - 3.0);
    return vec4(level, level, level, 1.0);
}
""")!
// How much of the blurred picture shows: all of it once a step out of focus (lens_service's `total`).
let blurShare = CIColorKernel(source: """
kernel vec4 blurShare(__sample depth, float focus, float sharp) {
    float off = clamp(clamp((abs(depth.r - focus) - sharp) / (1.0 - sharp), 0.0, 1.0) * 4.0, 0.0, 1.0);
    return vec4(off, off, off, 1.0);
}
""")!
// Dreamy: the blurred highlights bloom a little, more the further out of focus.
let bloom = CIColorKernel(source: """
kernel vec4 bloom(__sample picture, __sample mask) {
    vec3 extra = max(picture.rgb - 170.0 / 255.0, 0.0) * 0.5 * mask.r;
    return vec4(min(picture.rgb + extra, 1.0), picture.a);
}
""")!

let context = CIContext(options: [.workingColorSpace: NSNull(), .outputColorSpace: NSNull(), .cacheIntermediates: false])
let frameBytes = width * height * 4, depthBytes = depthWidth * depthHeight
let input = FileHandle.standardInput, output = FileHandle.standardOutput
var outputFrame = [UInt8](repeating: 0, count: frameBytes)
var lastDepth: CIImage? = nil
let bounds = CGRect(x: 0, y: 0, width: width, height: height)

func read(_ handle: FileHandle, _ count: Int) -> Data? {
    var data = Data(capacity: count)
    while data.count < count {
        guard let chunk = try? handle.read(upToCount: count - data.count), !chunk.isEmpty else { return nil }
        data.append(chunk)
    }
    return data
}

var index = 0
while let frame = read(input, frameBytes) {
    autoreleasepool {
        let picture = CIImage(bitmapData: frame, bytesPerRow: width * 4, size: CGSize(width: width, height: height), format: .BGRA8, colorSpace: nil)
        if let depth = read(depthInput, depthBytes) {
            lastDepth = CIImage(bitmapData: depth, bytesPerRow: depthWidth, size: CGSize(width: depthWidth, height: depthHeight), format: .L8, colorSpace: nil)
        }
        var result = picture
        if let depth = lastDepth {
            let focus = focuses.isEmpty ? 0.65 : focuses[min(index, focuses.count - 1)]
            let scaled = depth.transformed(by: CGAffineTransform(scaleX: CGFloat(width) / CGFloat(depthWidth), y: CGFloat(height) / CGFloat(depthHeight)))
                .clampedToExtent().applyingGaussianBlur(sigma: Double(height) / 180).cropped(to: bounds)  // So the blur never steps.
            let mask = outOfFocus.apply(extent: bounds, arguments: [scaled, focus, sharp, levels[1] / levels[4], levels[2] / levels[4], levels[3] / levels[4]])!
            // Blurred at half size (soft light needs no detail), then laid over the sharp picture where out of focus.
            let half = CGAffineTransform(scaleX: 0.5, y: 0.5), back = CGAffineTransform(scaleX: 2, y: 2)
            let small = picture.clampedToExtent().transformed(by: half)
            let smallMask = mask.clampedToExtent().transformed(by: half)
            var blurred = small.applyingFilter("CIMaskedVariableBlur", parameters: ["inputMask": smallMask, kCIInputRadiusKey: largest / 2])
                .transformed(by: back).cropped(to: bounds)
            if glow == 1 { blurred = bloom.apply(extent: bounds, arguments: [blurred, mask])! }
            result = blurred.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: picture, kCIInputMaskImageKey: blurShare.apply(extent: bounds, arguments: [scaled, focus, sharp])!])
                .cropped(to: bounds)
        }
        outputFrame.withUnsafeMutableBytes { bytes in
            context.render(result, toBitmap: bytes.baseAddress!, rowBytes: width * 4, bounds: bounds, format: .BGRA8, colorSpace: nil)
        }
        output.write(Data(outputFrame))
        index += 1
        if index % 10 == 0 { FileHandle.standardError.write("frame \(index)\n".data(using: .utf8)!) }
    }
}
