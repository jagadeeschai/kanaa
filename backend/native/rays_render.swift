// God rays on the GPU (rays_service.py's fast path): the light streamed outward from its source, fading as it goes,
// blocked by whatever stands in front of the bright sky, then added over the picture in light's own way (screen), with
// Core Image. The same formula as rays_service.beams and rays_service.compose.
// For each frame, stdin holds: where the light is (two float32s, shares of the frame from the top left), what gives
// light (8-bit, MW×MH), then the frame (BGRA, WIDTH×HEIGHT). Writes BGRA frames on stdout.
// Usage: rays_render WIDTH HEIGHT MW MH STEPS REACH DECAY STRENGTH TINT_R TINT_G TINT_B
import CoreImage
import Foundation

let arguments = CommandLine.arguments
guard arguments.count == 12, let width = Int(arguments[1]), let height = Int(arguments[2]), let maskWidth = Int(arguments[3]), let maskHeight = Int(arguments[4]),
      let steps = Int(arguments[5]), steps == 48, let reach = Double(arguments[6]), let decay = Double(arguments[7]), let strength = Double(arguments[8]),
      let tintR = Double(arguments[9]), let tintG = Double(arguments[10]), let tintB = Double(arguments[11]) else {
    FileHandle.standardError.write("usage: rays_render WIDTH HEIGHT MW MH 48 REACH DECAY STRENGTH TINT_R TINT_G TINT_B\n".data(using: .utf8)!)
    exit(2)
}

// Each point gathers the light along the way back to the source, fading as it goes (48 steps, as STEPS).
let gather = CIKernel(source: """
kernel vec4 gather(sampler mask, vec2 light, float reach, float decay, float strength) {
    vec2 here = destCoord();
    vec2 step = (here - light) * reach / 48.0;
    float total = 0.0;
    float fade = 1.0;
    for (int k = 1; k <= 48; k++) {
        total += sample(mask, samplerTransform(mask, here - step * float(k))).r * fade;
        fade *= decay;
    }
    float beam = 1.0 - exp(-total * strength * 5.0 / 48.0);  // GAIN, rolling off softly towards white.
    return vec4(beam, beam, beam, 1.0);
}
""")!
// Added in light's own way: bright stays bright, never past white.
let screen = CIColorKernel(source: """
kernel vec4 screenLight(__sample picture, __sample beam, vec3 tint) {
    vec3 light = beam.r * tint;
    return vec4(clamp(1.0 - (1.0 - picture.rgb) * (1.0 - light), 0.0, 1.0), 1.0);
}
""")!

let context = CIContext(options: [.workingColorSpace: NSNull(), .outputColorSpace: NSNull(), .cacheIntermediates: false])
let bounds = CGRect(x: 0, y: 0, width: width, height: height)
let smallBounds = CGRect(x: 0, y: 0, width: maskWidth, height: maskHeight)
let tint = CIVector(x: tintR, y: tintG, z: tintB)
let toFull = CGAffineTransform(scaleX: CGFloat(width) / CGFloat(maskWidth), y: CGFloat(height) / CGFloat(maskHeight))
let input = FileHandle.standardInput, output = FileHandle.standardOutput
let frameBytes = width * height * 4, maskBytes = maskWidth * maskHeight
var outputFrame = [UInt8](repeating: 0, count: frameBytes)
let anywhere: (Int32, CGRect) -> CGRect = { _, _ in smallBounds }

func read(_ count: Int) -> Data? {
    var data = Data(capacity: count)
    while data.count < count {
        guard let chunk = try? input.read(upToCount: count - data.count), !chunk.isEmpty else { return nil }
        data.append(chunk)
    }
    return data
}

while let header = read(8), let maskData = read(maskBytes), let frameData = read(frameBytes) {
    autoreleasepool {
        let at = header.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in (Double(raw.load(fromByteOffset: 0, as: Float.self)), Double(raw.load(fromByteOffset: 4, as: Float.self))) }
        let mask = CIImage(bitmapData: maskData, bytesPerRow: maskWidth, size: CGSize(width: maskWidth, height: maskHeight), format: .L8, colorSpace: nil)
        // The light's place in this picture's own pixels (rows counted up here).
        let light = CIVector(x: CGFloat(at.0 * Double(maskWidth) + 0.5), y: CGFloat(Double(maskHeight) - at.1 * Double(maskHeight) - 0.5))
        let beams = gather.apply(extent: smallBounds, roiCallback: anywhere, arguments: [mask, light, reach, decay, strength])!
        let full = beams.transformed(by: toFull).clampedToExtent().cropped(to: bounds)
        let frame = CIImage(bitmapData: frameData, bytesPerRow: width * 4, size: CGSize(width: width, height: height), format: .BGRA8, colorSpace: nil)
        let result = screen.apply(extent: bounds, arguments: [frame, full, tint])!
        outputFrame.withUnsafeMutableBytes { bytes in
            context.render(result, toBitmap: bytes.baseAddress!, rowBytes: width * 4, bounds: bounds, format: .BGRA8, colorSpace: nil)
        }
        output.write(Data(outputFrame))
    }
}
