// Atmosphere from depth on the GPU (atmosphere_service.py's fast path): the air laid into each frame, thicker the
// further away (from the clip's depth map), with Core Image. The same formula as atmosphere_service.air_frame.
// Reads BGRA frames (WIDTH×HEIGHT) on stdin and the depth map's grey frames (DW×DH) from DEPTH in step (the last one
// kept when it runs out). Writes BGRA frames on stdout and "frame N" on stderr every ten frames.
// Usage: atmosphere_render WIDTH HEIGHT DW DH RED GREEN BLUE DENSITY LAND FADE MOST DEPTH
import CoreImage
import Foundation

let arguments = CommandLine.arguments
guard arguments.count == 13, let width = Int(arguments[1]), let height = Int(arguments[2]), let depthWidth = Int(arguments[3]),
      let depthHeight = Int(arguments[4]), let red = Double(arguments[5]), let green = Double(arguments[6]), let blue = Double(arguments[7]),
      let density = Double(arguments[8]), let land = Double(arguments[9]), let fade = Double(arguments[10]), let most = Double(arguments[11]),
      let depthInput = FileHandle(forReadingAtPath: arguments[12]) else {
    FileHandle.standardError.write("usage: atmosphere_render WIDTH HEIGHT DW DH RED GREEN BLUE DENSITY LAND FADE MOST DEPTH\n".data(using: .utf8)!)
    exit(2)
}

// As atmosphere_service: CURVE, SKY_FROM, SKY_TO.
let air = CIColorKernel(source: """
kernel vec4 air(__sample picture, __sample depth, __sample shrunk, vec3 colour, float density, float land, float fade, float most) {
    float amount = clamp(density * pow(1.0 - clamp(max(depth.r, 0.12 * land), 0.0, 1.0), 1.6), 0.0, most);  // No glow at the skyline.
    amount *= 1.0 - 0.45 * (1.0 - clamp((depth.r - 0.03) / (0.12 - 0.03), 0.0, 1.0));  // SKY_KEEP: the sky shows through.
    float isLand = clamp((shrunk.r - 0.03) / (0.12 - 0.03), 0.0, 1.0);  // Land pulled back from the sky (SHRINK).
    amount *= 1.0 - land + land * isLand;
    float grey = (picture.r + picture.g + picture.b) / 3.0;
    vec3 faded = picture.rgb + (vec3(grey) - picture.rgb) * (fade * amount);
    return vec4(faded + (colour - faded) * amount, 1.0);
}
""")!

let context = CIContext(options: [.workingColorSpace: NSNull(), .outputColorSpace: NSNull(), .cacheIntermediates: false])
let frameBytes = width * height * 4, depthBytes = depthWidth * depthHeight
let input = FileHandle.standardInput, output = FileHandle.standardOutput
var outputFrame = [UInt8](repeating: 0, count: frameBytes)
var lastDepth: CIImage? = nil
let bounds = CGRect(x: 0, y: 0, width: width, height: height)
let colour = CIVector(x: red, y: green, z: blue)

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
                .clampedToExtent().applyingGaussianBlur(sigma: Double(height) / 180).cropped(to: bounds)  // Soft edges, as the CPU path.
            let shrunk = land > 0 ? scaled.clampedToExtent().applyingFilter("CIMorphologyMinimum", parameters: [kCIInputRadiusKey: max(1, (Double(height) / 40).rounded())]).cropped(to: bounds) : scaled
            result = air.apply(extent: bounds, arguments: [picture, scaled, shrunk, colour, density, land, fade, most])!
        }
        outputFrame.withUnsafeMutableBytes { bytes in
            context.render(result, toBitmap: bytes.baseAddress!, rowBytes: width * 4, bounds: bounds, format: .BGRA8, colorSpace: nil)
        }
        output.write(Data(outputFrame))
        index += 1
        if index % 10 == 0 { FileHandle.standardError.write("frame \(index)\n".data(using: .utf8)!) }
    }
}
