// Time freeze in 3D on the GPU (time_freeze_service.py's fast path): the frozen scene shifted by distance for each
// camera position, the people laid over it as one layer, with Core Image. The same formula as time_freeze_service.view.
// FOLDER holds plate.raw and frame.raw (BGRA, WIDTH×HEIGHT: the scene with the people filled in, and the frame),
// person.raw and near.raw (8-bit, WIDTH×HEIGHT), and cameras.txt (one "across up push" per frame).
// Writes BGRA frames on stdout and "frame N" on stderr every ten frames.
// Usage: freeze_render WIDTH HEIGHT SUBJECT BASE PARALLAX PEOPLE(0|1) FOLDER
import CoreImage
import Foundation

let arguments = CommandLine.arguments
guard arguments.count == 8, let width = Int(arguments[1]), let height = Int(arguments[2]), let subject = Double(arguments[3]),
      let base = Double(arguments[4]), let parallax = Double(arguments[5]), let people = Int(arguments[6]) else {
    FileHandle.standardError.write("usage: freeze_render WIDTH HEIGHT SUBJECT BASE PARALLAX PEOPLE FOLDER\n".data(using: .utf8)!)
    exit(2)
}
let folder = URL(fileURLWithPath: arguments[7])
func load(_ name: String, _ bytesPerPixel: Int, _ format: CIFormat) -> CIImage? {
    guard let data = try? Data(contentsOf: folder.appendingPathComponent(name)), data.count == width * height * bytesPerPixel else { return nil }
    return CIImage(bitmapData: data, bytesPerRow: width * bytesPerPixel, size: CGSize(width: width, height: height), format: format, colorSpace: nil)
}
guard let plate = load("plate.raw", 4, .BGRA8), let frame = load("frame.raw", 4, .BGRA8), let person = load("person.raw", 1, .L8),
      let near = load("near.raw", 1, .L8), let cameraText = try? String(contentsOf: folder.appendingPathComponent("cameras.txt"), encoding: .utf8) else {
    FileHandle.standardError.write("freeze_render: missing or wrong-sized inputs\n".data(using: .utf8)!)
    exit(3)
}
let cameras = cameraText.split(separator: "\n").map { $0.split(separator: " ").compactMap { Double($0) } }.filter { $0.count == 3 }

// The scene, each point shifted by how near it is (rows counted up here, so up is +), and larger as the camera pushes in.
let scene = CIKernel(source: """
kernel vec4 scene(sampler plate, sampler near, vec2 centre, vec2 move, float push, float base, float subject) {
    vec2 here = destCoord();
    float n = sample(near, samplerTransform(near, here)).r;
    float size = base * (1.0 + push * (0.3 + 1.4 * n));
    vec2 from = (here - centre - move * (n - subject)) / size + centre;
    return sample(plate, samplerTransform(plate, from));
}
""")!

let context = CIContext(options: [.workingColorSpace: NSNull(), .outputColorSpace: NSNull(), .cacheIntermediates: false])
let bounds = CGRect(x: 0, y: 0, width: width, height: height)
let centre = CIVector(x: CGFloat(width) / 2, y: CGFloat(height) / 2)
let plateEdge = plate.clampedToExtent(), nearEdge = near.clampedToExtent()
let reach: (Int32, CGRect) -> CGRect = { _, rect in rect.insetBy(dx: -CGFloat(width), dy: -CGFloat(height)) }
var outputFrame = [UInt8](repeating: 0, count: width * height * 4)

for (index, camera) in cameras.enumerated() {
    autoreleasepool {
        let (across, up, push) = (camera[0], camera[1], camera[2])
        let move = CIVector(x: CGFloat(across * Double(width) * parallax), y: CGFloat(up * Double(width) * parallax))
        var result = scene.apply(extent: bounds, roiCallback: reach, arguments: [plateEdge, nearEdge, centre, move, push, base, subject])!
        if people == 1 {
            // The people turn with the camera's pivot: they stay where they are and only grow as it pushes in.
            let size = CGFloat(base * (1 + push * (0.3 + 1.4 * subject)))
            let grow = CGAffineTransform(translationX: CGFloat(width) / 2, y: CGFloat(height) / 2).scaledBy(x: size, y: size).translatedBy(x: -CGFloat(width) / 2, y: -CGFloat(height) / 2)
            result = frame.transformed(by: grow).applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: result, kCIInputMaskImageKey: person.transformed(by: grow)])
                .cropped(to: bounds)
        }
        outputFrame.withUnsafeMutableBytes { bytes in
            context.render(result, toBitmap: bytes.baseAddress!, rowBytes: width * 4, bounds: bounds, format: .BGRA8, colorSpace: nil)
        }
        FileHandle.standardOutput.write(Data(outputFrame))
        if (index + 1) % 10 == 0 { FileHandle.standardError.write("frame \(index + 1)\n".data(using: .utf8)!) }
    }
}
