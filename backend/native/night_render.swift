// Day for night on the GPU (night_service.py's fast path): each frame turned to night, the land darker with distance
// (from the clip's depth map), the sky deep blue, colour drained towards moonlight, with Core Image. The same formula
// as night_service.night_frame.
// Reads BGRA frames (WIDTH×HEIGHT) on stdin and the depth map's grey frames (DW×DH) from DEPTH in step (the last one
// kept when it runs out). Writes BGRA frames on stdout and "frame N" on stderr every ten frames.
// Usage: night_render WIDTH HEIGHT DW DH LAND SKY COLOUR DEPTH
import CoreImage
import Foundation

let arguments = CommandLine.arguments
guard arguments.count == 9, let width = Int(arguments[1]), let height = Int(arguments[2]), let depthWidth = Int(arguments[3]),
      let depthHeight = Int(arguments[4]), let land = Double(arguments[5]), let skyLevel = Double(arguments[6]), let colourKept = Double(arguments[7]),
      let depthInput = FileHandle(forReadingAtPath: arguments[8]) else {
    FileHandle.standardError.write("usage: night_render WIDTH HEIGHT DW DH LAND SKY COLOUR DEPTH\n".data(using: .utf8)!)
    exit(2)
}

// As night_service: MOON, NIGHT_SKY, FLOOR, FAR, SKY_FROM, SKY_TO.
let night = CIColorKernel(source: """
kernel vec4 night(__sample picture, __sample depth, float land, float sky, float kept) {
    float n = clamp(depth.r, 0.0, 1.0);
    float grey = dot(picture.rgb, vec3(0.299, 0.587, 0.114));
    vec3 drained = vec3(grey) + (picture.rgb - vec3(grey)) * kept;
    vec3 lit = drained * land * (1.0 - 0.45 * (1.0 - n)) * vec3(0.72, 0.86, 1.18);
    vec3 dark = grey * sky * vec3(0.42, 0.58, 1.12);
    float share = 1.0 - clamp((n - 0.03) / (0.12 - 0.03), 0.0, 1.0);
    vec3 result = max(lit + (dark - lit) * share, vec3(0.012, 0.02, 0.045));
    return vec4(clamp(result, 0.0, 1.0), 1.0);
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
            let scaled = depth.transformed(by: CGAffineTransform(scaleX: CGFloat(width) / CGFloat(depthWidth), y: CGFloat(height) / CGFloat(depthHeight)))
                .clampedToExtent().applyingGaussianBlur(sigma: Double(height) / 180).cropped(to: bounds)
            result = night.apply(extent: bounds, arguments: [picture, scaled, land, skyLevel, colourKept])!
        }
        outputFrame.withUnsafeMutableBytes { bytes in
            context.render(result, toBitmap: bytes.baseAddress!, rowBytes: width * 4, bounds: bounds, format: .BGRA8, colorSpace: nil)
        }
        output.write(Data(outputFrame))
        index += 1
        if index % 10 == 0 { FileHandle.standardError.write("frame \(index)\n".data(using: .utf8)!) }
    }
}
