// Finds the people in each frame with Apple's Vision framework, on this Mac's Neural Engine.
// Reads raw RGB frames on stdin and writes one 8-bit mask per frame on stdout, the same size.
// Usage: person_mask WIDTH HEIGHT
import CoreImage
import CoreVideo
import Foundation
import Vision

let arguments = CommandLine.arguments
guard arguments.count == 3, let width = Int(arguments[1]), let height = Int(arguments[2]) else {
    FileHandle.standardError.write("usage: person_mask WIDTH HEIGHT\n".data(using: .utf8)!)
    exit(2)
}

let request = VNGeneratePersonSegmentationRequest()
request.qualityLevel = .accurate
request.outputPixelFormat = kCVPixelFormatType_OneComponent8
// A sequence handler keeps each mask steady with the one before.
let sequence = VNSequenceRequestHandler()
let context = CIContext(options: [.workingColorSpace: NSNull(), .outputColorSpace: NSNull()])
let frameBytes = width * height * 3
let input = FileHandle.standardInput
let output = FileHandle.standardOutput
var mask = [UInt8](repeating: 0, count: width * height)

func readFrame() -> Data? {
    var data = Data(capacity: frameBytes)
    while data.count < frameBytes {
        guard let chunk = try? input.read(upToCount: frameBytes - data.count), !chunk.isEmpty else { return nil }
        data.append(chunk)
    }
    return data
}

func pixelBuffer(from rgb: Data) -> CVPixelBuffer? {
    var buffer: CVPixelBuffer?
    guard CVPixelBufferCreate(nil, width, height, kCVPixelFormatType_32BGRA, [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &buffer) == kCVReturnSuccess, let buffer else { return nil }
    CVPixelBufferLockBaseAddress(buffer, [])
    let row = CVPixelBufferGetBytesPerRow(buffer)
    let base = CVPixelBufferGetBaseAddress(buffer)!.assumingMemoryBound(to: UInt8.self)
    rgb.withUnsafeBytes { (source: UnsafeRawBufferPointer) in
        let pixels = source.bindMemory(to: UInt8.self)
        for y in 0..<height {
            for x in 0..<width {
                let from = (y * width + x) * 3
                let to = y * row + x * 4
                base[to] = pixels[from + 2]; base[to + 1] = pixels[from + 1]; base[to + 2] = pixels[from]; base[to + 3] = 255
            }
        }
    }
    CVPixelBufferUnlockBaseAddress(buffer, [])
    return buffer
}

while let frame = readFrame() {
    autoreleasepool {
        for index in mask.indices { mask[index] = 0 }
        if let buffer = pixelBuffer(from: frame), (try? sequence.perform([request], on: buffer)) != nil, let result = request.results?.first?.pixelBuffer {
            // Vision's mask has its own size, so it is scaled to the frame's.
            let found = CIImage(cvPixelBuffer: result)
            let scaled = found.transformed(by: CGAffineTransform(scaleX: CGFloat(width) / found.extent.width, y: CGFloat(height) / found.extent.height))
            mask.withUnsafeMutableBytes { bytes in
                context.render(scaled, toBitmap: bytes.baseAddress!, rowBytes: width, bounds: CGRect(x: 0, y: 0, width: width, height: height), format: .L8, colorSpace: nil)
            }
        }
        output.write(Data(mask))
    }
}
