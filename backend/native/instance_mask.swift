// Finds each person, or each object, in every frame with Apple's Vision framework, separately.
// Reads raw RGB frames on stdin. For each frame writes one byte, the number of masks (at most MAX),
// then that many 8-bit masks of the same size, each with the frame's one person or object.
// For people, each mask is also trimmed by the sharp all-people mask, which clears haze and keeps edges crisp.
// Usage: instance_mask WIDTH HEIGHT people|objects
import CoreImage
import CoreVideo
import Foundation
import Vision

let MAX = 6
let arguments = CommandLine.arguments
guard arguments.count == 4, let width = Int(arguments[1]), let height = Int(arguments[2]), ["people", "objects"].contains(arguments[3]) else {
    FileHandle.standardError.write("usage: instance_mask WIDTH HEIGHT people|objects\n".data(using: .utf8)!)
    exit(2)
}
let people = arguments[3] == "people"
let context = CIContext(options: [.workingColorSpace: NSNull(), .outputColorSpace: NSNull()])
let frameBytes = width * height * 3
let input = FileHandle.standardInput
let output = FileHandle.standardOutput
var mask = [UInt8](repeating: 0, count: width * height)
let everyone = VNGeneratePersonSegmentationRequest()
everyone.qualityLevel = .accurate
everyone.outputPixelFormat = kCVPixelFormatType_OneComponent8
let sequence = VNSequenceRequestHandler()

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

/// One instance's mask at the frame's own size, 0 to 255.
func render(_ scaled: CVPixelBuffer) -> Data {
    let image = CIImage(cvPixelBuffer: scaled)
    let fitted = image.transformed(by: CGAffineTransform(scaleX: CGFloat(width) / image.extent.width, y: CGFloat(height) / image.extent.height))
    for index in mask.indices { mask[index] = 0 }
    mask.withUnsafeMutableBytes { bytes in
        context.render(fitted, toBitmap: bytes.baseAddress!, rowBytes: width, bounds: CGRect(x: 0, y: 0, width: width, height: height), format: .L8, colorSpace: nil)
    }
    return Data(mask)
}

while let frame = readFrame() {
    autoreleasepool {
        var masks: [Data] = []
        if let buffer = pixelBuffer(from: frame) {
            var sharp: [UInt8]? = nil
            if people, (try? sequence.perform([everyone], on: buffer)) != nil, let found = everyone.results?.first?.pixelBuffer {
                sharp = [UInt8](render(found))
            }
            let handler = VNImageRequestHandler(cvPixelBuffer: buffer)
            let request: VNRequest = people ? VNGeneratePersonInstanceMaskRequest() : VNGenerateForegroundInstanceMaskRequest()
            if (try? handler.perform([request])) != nil, let result = request.results?.first as? VNInstanceMaskObservation {
                for instance in result.allInstances.sorted().prefix(MAX) {
                    if let scaled = try? result.generateScaledMaskForImage(forInstances: IndexSet(integer: instance), from: handler) {
                        var own = [UInt8](render(scaled))
                        if let sharp {
                            // This person's area from the instance mask, its edge and clearing from the sharp one.
                            for index in own.indices { own[index] = UInt8(min(255, Int(own[index]) * 2) * Int(sharp[index]) / 255) }
                        }
                        masks.append(Data(own))
                    }
                }
            }
        }
        output.write(Data([UInt8(masks.count)]))
        for item in masks { output.write(item) }
    }
}
