// Sky swap on the GPU (sky_swap_service.py's fast path): the new sky laid where the old one was, moved with the
// camera, and the land relit by it, with Core Image. The same formula as sky_swap_service.compose.
// SKY is the new sky (BGRA, SW×SH, larger than the frame). For each frame, stdin holds: how far the camera has moved
// (two float32s, across and down, full-size pixels), the sky mask and the nearness (8-bit, MW×MH each), then the frame
// (BGRA, WIDTH×HEIGHT). Writes BGRA frames on stdout.
// Usage: sky_render WIDTH HEIGHT MW MH SW SH GAIN_R GAIN_G GAIN_B AMOUNT SKY
import CoreImage
import Foundation

let arguments = CommandLine.arguments
guard arguments.count == 12, let width = Int(arguments[1]), let height = Int(arguments[2]), let maskWidth = Int(arguments[3]), let maskHeight = Int(arguments[4]),
      let skyWidth = Int(arguments[5]), let skyHeight = Int(arguments[6]), let gainR = Double(arguments[7]), let gainG = Double(arguments[8]),
      let gainB = Double(arguments[9]), let amount = Double(arguments[10]), let skyData = try? Data(contentsOf: URL(fileURLWithPath: arguments[11])),
      skyData.count == skyWidth * skyHeight * 4 else {
    FileHandle.standardError.write("usage: sky_render WIDTH HEIGHT MW MH SW SH GAIN_R GAIN_G GAIN_B AMOUNT SKY\n".data(using: .utf8)!)
    exit(2)
}
let sky = CIImage(bitmapData: skyData, bytesPerRow: skyWidth * 4, size: CGSize(width: skyWidth, height: skyHeight), format: .BGRA8, colorSpace: nil).clampedToExtent()

// The land takes the new sky's light (far land more than near), then the new sky shows where the old one was.
let relight = CIColorKernel(source: """
kernel vec4 relight(__sample land, __sample sky, __sample mask, __sample near, vec3 gain, float amount) {
    float share = amount * (0.7 + 0.3 * (1.0 - clamp(near.r, 0.0, 1.0)));
    vec3 lit = land.rgb * (1.0 + (gain - 1.0) * share);
    return vec4(clamp(mix(lit, sky.rgb, mask.r), 0.0, 1.0), 1.0);
}
""")!

let context = CIContext(options: [.workingColorSpace: NSNull(), .outputColorSpace: NSNull(), .cacheIntermediates: false])
let bounds = CGRect(x: 0, y: 0, width: width, height: height)
let gain = CIVector(x: gainR, y: gainG, z: gainB)
let toFull = CGAffineTransform(scaleX: CGFloat(width) / CGFloat(maskWidth), y: CGFloat(height) / CGFloat(maskHeight))
let input = FileHandle.standardInput, output = FileHandle.standardOutput
let frameBytes = width * height * 4, maskBytes = maskWidth * maskHeight
var outputFrame = [UInt8](repeating: 0, count: frameBytes)

func read(_ count: Int) -> Data? {
    var data = Data(capacity: count)
    while data.count < count {
        guard let chunk = try? input.read(upToCount: count - data.count), !chunk.isEmpty else { return nil }
        data.append(chunk)
    }
    return data
}
func small(_ data: Data) -> CIImage {
    CIImage(bitmapData: data, bytesPerRow: maskWidth, size: CGSize(width: maskWidth, height: maskHeight), format: .L8, colorSpace: nil)
        .transformed(by: toFull).clampedToExtent().cropped(to: bounds)
}

while let header = read(8), let maskData = read(maskBytes), let nearData = read(maskBytes), let frameData = read(frameBytes) {
    autoreleasepool {
        let moved = header.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in (Double(raw.load(fromByteOffset: 0, as: Float.self)), Double(raw.load(fromByteOffset: 4, as: Float.self))) }
        let frame = CIImage(bitmapData: frameData, bytesPerRow: width * 4, size: CGSize(width: width, height: height), format: .BGRA8, colorSpace: nil)
        // The sky's top-left sits (SW−W)/2 − across, (SH−H)/2 − down from the frame's; rows count up here.
        let left = Double(skyWidth - width) / 2 - moved.0, top = Double(skyHeight - height) / 2 - moved.1
        let placed = sky.transformed(by: CGAffineTransform(translationX: CGFloat(-left), y: CGFloat(-(Double(skyHeight - height) - top)))).cropped(to: bounds)
        let result = relight.apply(extent: bounds, arguments: [frame, placed, small(maskData), small(nearData), gain, amount])!
        outputFrame.withUnsafeMutableBytes { bytes in
            context.render(result, toBitmap: bytes.baseAddress!, rowBytes: width * 4, bounds: bounds, format: .BGRA8, colorSpace: nil)
        }
        output.write(Data(outputFrame))
    }
}
