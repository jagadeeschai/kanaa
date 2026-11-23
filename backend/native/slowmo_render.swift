// Smooth slow motion on the GPU (slowmo_service.py's fast path): the new frames between the clip's own. How every
// pixel moves between two frames is measured by slowmo_service (OpenCV's DIS optical flow on half-size copies, both
// ways: Apple Vision's flow came out short by an amount that changed with the frame size); here each new frame
// slides both neighbours part of the way along it and blends them by nearness in time, with a Core Image kernel.
// Reads, for each frame: the frame (BGRA, WIDTH×HEIGHT), then, from the second frame on, the motion from the frame
// before to this one and back (each FW×FH pixels of two float32s, across and down, in full-size pixels).
// Writes FACTOR frames per frame read (the made frames, then the frame itself; the last frame holds for its share).
// Usage: slowmo_render WIDTH HEIGHT FW FH FACTOR
import CoreImage
import Foundation

let arguments = CommandLine.arguments
guard arguments.count == 6, let width = Int(arguments[1]), let height = Int(arguments[2]), let flowWidth = Int(arguments[3]),
      let flowHeight = Int(arguments[4]), let factor = Int(arguments[5]), factor >= 2 else {
    FileHandle.standardError.write("usage: slowmo_render WIDTH HEIGHT FW FH FACTOR\n".data(using: .utf8)!)
    exit(2)
}

let context = CIContext(options: [.workingColorSpace: NSNull(), .outputColorSpace: NSNull(), .cacheIntermediates: false])
let bounds = CGRect(x: 0, y: 0, width: width, height: height)

// Samples `picture` back along `flow` (rows going down) by `t`: the picture part of the way along the motion.
let warp = CIKernel(source: """
kernel vec4 warp(sampler picture, sampler flow, float t) {
    vec2 moved = sample(flow, samplerCoord(flow)).rg;
    return sample(picture, samplerTransform(picture, destCoord() - t * vec2(moved.x, -moved.y)));
}
""")!
// a×(1−t) + b×t.
let blend = CIColorKernel(source: "kernel vec4 blend(__sample a, __sample b, float t) { return mix(a, b, t); }")!

let frameBytes = width * height * 4, flowBytes = flowWidth * flowHeight * 8
let input = FileHandle.standardInput, output = FileHandle.standardOutput
var outputFrame = [UInt8](repeating: 0, count: frameBytes)
var rgba = [Float](repeating: 0, count: flowWidth * flowHeight * 4)

func read(_ count: Int) -> Data? {
    var data = Data(capacity: count)
    while data.count < count {
        guard let chunk = try? input.read(upToCount: count - data.count), !chunk.isEmpty else { return nil }
        data.append(chunk)
    }
    return data
}

/// The motion as a full-size picture (r: across, g: down).
func motion(_ data: Data) -> CIImage {
    data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
        let pairs = raw.bindMemory(to: Float.self)
        for index in 0..<(flowWidth * flowHeight) {
            rgba[index * 4] = pairs[index * 2]; rgba[index * 4 + 1] = pairs[index * 2 + 1]; rgba[index * 4 + 3] = 1
        }
    }
    let image = CIImage(bitmapData: Data(bytes: rgba, count: rgba.count * 4), bytesPerRow: flowWidth * 16, size: CGSize(width: flowWidth, height: flowHeight), format: .RGBAf, colorSpace: nil)
    return image.transformed(by: CGAffineTransform(scaleX: CGFloat(width) / CGFloat(flowWidth), y: CGFloat(height) / CGFloat(flowHeight))).clampedToExtent()
}

func write(_ picture: CIImage) {
    outputFrame.withUnsafeMutableBytes { bytes in
        context.render(picture, toBitmap: bytes.baseAddress!, rowBytes: width * 4, bounds: bounds, format: .BGRA8, colorSpace: nil)
    }
    output.write(Data(outputFrame))
}

let reach: (Int32, CGRect) -> CGRect = { _, rect in rect.insetBy(dx: -CGFloat(width) / 4, dy: -CGFloat(height) / 4) }
var last: CIImage? = nil
while let data = read(frameBytes) {
    autoreleasepool {
        let picture = CIImage(bitmapData: data, bytesPerRow: width * 4, size: CGSize(width: width, height: height), format: .BGRA8, colorSpace: nil)
        if let before = last {
            guard let forwardData = read(flowBytes), let backwardData = read(flowBytes) else { return }
            let forward = motion(forwardData), backward = motion(backwardData)
            let a = before.clampedToExtent(), b = picture.clampedToExtent()
            for k in 1..<factor {
                let t = Float(k) / Float(factor)
                let fromA = warp.apply(extent: bounds, roiCallback: reach, arguments: [a, forward, t])!
                let fromB = warp.apply(extent: bounds, roiCallback: reach, arguments: [b, backward, 1 - t])!
                write(blend.apply(extent: bounds, arguments: [fromA, fromB, t])!)
            }
        }
        write(picture)
        last = picture
    }
}
if let picture = last {
    for _ in 1..<factor { write(picture) }
}
