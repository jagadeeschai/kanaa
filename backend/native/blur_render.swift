// Real motion blur on the GPU (blur_service.py's fast path): each pixel smeared along its own movement by the shutter's
// share of it, centred on it (16 points averaged), with Core Image. The same formula as blur_service.smear.
// For each frame, stdin holds: the motion (MW×MH pixels of two float32s, across and down, full-size pixels a frame), then
// the frame (BGRA, WIDTH×HEIGHT). Writes BGRA frames on stdout.
// Usage: blur_render WIDTH HEIGHT MW MH SHUTTER
import CoreImage
import Foundation

let arguments = CommandLine.arguments
guard arguments.count == 6, let width = Int(arguments[1]), let height = Int(arguments[2]), let motionWidth = Int(arguments[3]),
      let motionHeight = Int(arguments[4]), let shutter = Double(arguments[5]) else {
    FileHandle.standardError.write("usage: blur_render WIDTH HEIGHT MW MH SHUTTER\n".data(using: .utf8)!)
    exit(2)
}

// SAMPLES = 16, spread over the shutter's share of the movement, centred on the pixel (rows count up here).
let smear = CIKernel(source: """
kernel vec4 smear(sampler picture, sampler motion, float shutter) {
    vec2 here = destCoord();
    vec2 moved = sample(motion, samplerCoord(motion)).rg;
    vec2 way = vec2(moved.x, -moved.y) * shutter;
    vec4 total = vec4(0.0);
    for (int k = 0; k < 16; k++) {
        float t = (float(k) + 0.5) / 16.0 - 0.5;
        total += sample(picture, samplerTransform(picture, here + way * t));
    }
    return total / 16.0;
}
""")!

let context = CIContext(options: [.workingColorSpace: NSNull(), .outputColorSpace: NSNull(), .cacheIntermediates: false])
let bounds = CGRect(x: 0, y: 0, width: width, height: height)
let frameBytes = width * height * 4, motionBytes = motionWidth * motionHeight * 8
let input = FileHandle.standardInput, output = FileHandle.standardOutput
var outputFrame = [UInt8](repeating: 0, count: frameBytes)
var rgba = [Float](repeating: 0, count: motionWidth * motionHeight * 4)
let reach: (Int32, CGRect) -> CGRect = { _, rect in rect.insetBy(dx: -CGFloat(width) * 0.05, dy: -CGFloat(height) * 0.05) }

func read(_ count: Int) -> Data? {
    var data = Data(capacity: count)
    while data.count < count {
        guard let chunk = try? input.read(upToCount: count - data.count), !chunk.isEmpty else { return nil }
        data.append(chunk)
    }
    return data
}

while let motionData = read(motionBytes), let frameData = read(frameBytes) {
    autoreleasepool {
        motionData.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
            let pairs = raw.bindMemory(to: Float.self)
            for index in 0..<(motionWidth * motionHeight) {
                rgba[index * 4] = pairs[index * 2]; rgba[index * 4 + 1] = pairs[index * 2 + 1]; rgba[index * 4 + 3] = 1
            }
        }
        let motion = CIImage(bitmapData: Data(bytes: rgba, count: rgba.count * 4), bytesPerRow: motionWidth * 16, size: CGSize(width: motionWidth, height: motionHeight), format: .RGBAf, colorSpace: nil)
            .transformed(by: CGAffineTransform(scaleX: CGFloat(width) / CGFloat(motionWidth), y: CGFloat(height) / CGFloat(motionHeight))).clampedToExtent()
        let frame = CIImage(bitmapData: frameData, bytesPerRow: width * 4, size: CGSize(width: width, height: height), format: .BGRA8, colorSpace: nil).clampedToExtent()
        let result = smear.apply(extent: bounds, roiCallback: reach, arguments: [frame, motion, shutter])!
        outputFrame.withUnsafeMutableBytes { bytes in
            context.render(result, toBitmap: bytes.baseAddress!, rowBytes: width * 4, bounds: bounds, format: .BGRA8, colorSpace: nil)
        }
        output.write(Data(outputFrame))
    }
}
