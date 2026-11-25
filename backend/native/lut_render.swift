// A colour cube (3D LUT) on the GPU (match_service.py's fast path): every frame through Core Image's colour cube,
// trilinear, as match_service.apply_cube does on the CPU.
// CUBE holds SIZE³ RGBA float32 entries, red fastest. Reads BGRA frames (WIDTH×HEIGHT) on stdin; writes BGRA frames on
// stdout and "frame N" on stderr every ten frames.
// Usage: lut_render WIDTH HEIGHT SIZE CUBE
import CoreImage
import Foundation

let arguments = CommandLine.arguments
guard arguments.count == 5, let width = Int(arguments[1]), let height = Int(arguments[2]), let size = Int(arguments[3]),
      let cube = try? Data(contentsOf: URL(fileURLWithPath: arguments[4])), cube.count == size * size * size * 16 else {
    FileHandle.standardError.write("usage: lut_render WIDTH HEIGHT SIZE CUBE\n".data(using: .utf8)!)
    exit(2)
}

let context = CIContext(options: [.workingColorSpace: NSNull(), .outputColorSpace: NSNull(), .cacheIntermediates: false])
let bounds = CGRect(x: 0, y: 0, width: width, height: height)
let frameBytes = width * height * 4
let input = FileHandle.standardInput, output = FileHandle.standardOutput
var outputFrame = [UInt8](repeating: 0, count: frameBytes)

func read() -> Data? {
    var data = Data(capacity: frameBytes)
    while data.count < frameBytes {
        guard let chunk = try? input.read(upToCount: frameBytes - data.count), !chunk.isEmpty else { return nil }
        data.append(chunk)
    }
    return data
}

var index = 0
while let frame = read() {
    autoreleasepool {
        let picture = CIImage(bitmapData: frame, bytesPerRow: width * 4, size: CGSize(width: width, height: height), format: .BGRA8, colorSpace: nil)
        let result = picture.applyingFilter("CIColorCube", parameters: ["inputCubeDimension": size, "inputCubeData": cube])
        outputFrame.withUnsafeMutableBytes { bytes in
            context.render(result, toBitmap: bytes.baseAddress!, rowBytes: width * 4, bounds: bounds, format: .BGRA8, colorSpace: nil)
        }
        output.write(Data(outputFrame))
        index += 1
        if index % 10 == 0 { FileHandle.standardError.write("frame \(index)\n".data(using: .utf8)!) }
    }
}
