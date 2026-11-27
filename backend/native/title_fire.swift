// A title on fire on the GPU (title_fire.py's fast path): Metal compute draws each frame of the burning loop at half
// size (one thread per column carries the flames up from the letters, then one per pixel colours them, adds the hot
// letters, the halo and the embers), Core Image scales it to the frame, and the hardware encoder writes the H.264 clip.
// The same steps as title_fire.Burner.frame (the CPU fallback); tests/test_title_fire.py compares the two.
//
// Usage: title_fire plan.json. The plan names a raw float32 file holding, each h×w: the letters, the flames' source,
// the two noises, the heights noise and the halo; and per frame: the noise offsets and the embers (x, y, brightness).
import AVFoundation
import CoreImage
import Foundation
import Metal

struct FirePlan: Decodable {
    let w: Int
    let h: Int
    let fullWidth: Int
    let fullHeight: Int
    let frames: Int
    let fps: Int
    let strength: Float
    let tall: Float
    let data: String
    let offsets: [[Int32]]  // Per frame: the two noises' scroll, the tongues' scroll, the heights row.
    let embers: [[Float]]  // Per frame: x, y, brightness for each ember shown.
    let output: String
    let bitrate: Int
}

let shaders = """
#include <metal_stdlib>
using namespace metal;
struct Frame { int w; int h; float t; float strength; float tall; int r1; int r2; int r3; int rh; int embers; };

inline float noiseAt(device const float* n1, device const float* n2, int y, int x, constant Frame& f) {
    return 0.62 * n1[((y + f.r1) % f.h) * f.w + x] + 0.38 * n2[((y + f.r2) % f.h) * f.w + x];
}

kernel void heatColumns(device const float* source [[buffer(0)]], device const float* n1 [[buffer(1)]], device const float* n2 [[buffer(2)]],
                        device const float* heights [[buffer(3)]], device float* heat [[buffer(4)]], constant Frame& f [[buffer(5)]],
                        uint x [[thread_position_in_grid]]) {
    if ((int)x >= f.w) return;
    float reach = f.tall * (0.25 + 1.25 * clamp((heights[f.rh * f.w + x] - 0.25f) * 1.8f, 0.0f, 1.0f));
    float fade = 1.0 - pow(0.1f, 1.0f / max(4.0f, reach));
    float carry = 0.0;
    for (int y = f.h - 1; y >= 0; y--) {
        float nz = noiseAt(n1, n2, y, x, f);
        carry = max(source[y * f.w + x], carry * (1.0f - fade * (0.45f + 1.1f * (1.0f - nz))));
        heat[y * f.w + x] = carry;
    }
}

inline float3 fireColour(float heat) {
    return float3(clamp(heat * 2.1f, 0.0f, 1.0f), clamp(heat * 1.7f - 0.45f, 0.0f, 1.0f), clamp(heat * 2.4f - 1.75f, 0.0f, 1.0f));
}

kernel void shade(device const float* mask [[buffer(0)]], device const float* n1 [[buffer(1)]], device const float* n2 [[buffer(2)]],
                  device const float* heat [[buffer(3)]], device const float* halo [[buffer(4)]], device const float* embers [[buffer(5)]],
                  device float4* out [[buffer(6)]], constant Frame& f [[buffer(7)]], uint2 at [[thread_position_in_grid]]) {
    int x = at.x, y = at.y;
    if (x >= f.w || y >= f.h) return;
    float nz = noiseAt(n1, n2, y, x, f);
    float sway = sin((float)y * (2.0f * M_PI_F / (float)(f.h - 1)) * 3.0f + 2.0f * M_PI_F * f.t) * 2.0f;
    float sx = (float)x + sway * 9.0f * (nz - 0.5f);
    int x0 = (int)floor(sx); float fx = sx - (float)x0;
    float a = (x0 >= 0 && x0 < f.w) ? heat[y * f.w + x0] : 0.0f;
    float b = (x0 + 1 >= 0 && x0 + 1 < f.w) ? heat[y * f.w + x0 + 1] : 0.0f;
    float moved = a * (1.0f - fx) + b * fx;
    float lick = clamp((n2[((y + f.r3) % f.h) * f.w + x] - 0.28f) * 2.2f, 0.0f, 1.0f);
    float tongues = clamp(pow(moved, 1.7f) * (0.3f + 0.7f * lick) * (0.55f + nz) - 0.1f, 0.0f, 1.0f) * 1.6f * f.strength;
    float core = mask[y * f.w + x] * (0.45f + 0.35f * nz) * f.strength;
    float3 light = fireColour(clamp(tongues + core * 0.8f, 0.0f, 1.2f)) + halo[y * f.w + x] * float3(0.55f, 0.2f, 0.04f) * f.strength;
    float sparks = 0.0;
    for (int e = 0; e < f.embers; e++) {
        float dx = (float)x - embers[e * 3], dy = (float)y - embers[e * 3 + 1];
        if (fabs(dx) <= 4.0f && fabs(dy) <= 4.0f) sparks += exp(-(dx * dx + dy * dy) / (2.0f * 1.44f)) * embers[e * 3 + 2];
    }
    light += sparks * float3(1.0f, 0.7f, 0.3f) * 1.4f;
    out[y * f.w + x] = float4(clamp(light, 0.0f, 1.0f), 1.0f);  // Top row first, as a bitmap.
}
"""

struct Frame { var w: Int32; var h: Int32; var t: Float; var strength: Float; var tall: Float; var r1: Int32; var r2: Int32; var r3: Int32; var rh: Int32; var embers: Int32 }

func fail(_ message: String) -> Never { FileHandle.standardError.write((message + "\n").data(using: .utf8)!); exit(1) }

guard CommandLine.arguments.count == 2 else { fail("usage: title_fire plan.json") }
let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
guard let plan = try? decoder.decode(FirePlan.self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))) else { fail("Could not read the plan.") }
guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else { fail("No GPU found.") }
let library: MTLLibrary
do { library = try device.makeLibrary(source: shaders, options: nil) } catch { fail("Could not build the fire shaders: \(error)") }
guard let columns = try? device.makeComputePipelineState(function: library.makeFunction(name: "heatColumns")!),
      let shading = try? device.makeComputePipelineState(function: library.makeFunction(name: "shade")!) else { fail("Could not make the fire pipelines.") }

let count = plan.w * plan.h
guard let raw = FileManager.default.contents(atPath: plan.data), raw.count == count * 6 * 4 else { fail("The fire's data is the wrong size.") }
func field(_ n: Int) -> MTLBuffer { raw.withUnsafeBytes { device.makeBuffer(bytes: $0.baseAddress! + n * count * 4, length: count * 4, options: .storageModeShared)! } }
let mask = field(0), source = field(1), n1 = field(2), n2 = field(3), heights = field(4), halo = field(5)
let heat = device.makeBuffer(length: count * 4, options: .storageModePrivate)!
let out = device.makeBuffer(length: count * 16, options: .storageModeShared)!
let emberBuffer = device.makeBuffer(length: max(16, (plan.embers.map(\.count).max() ?? 0) * 4), options: .storageModeShared)!

let context = CIContext(mtlDevice: device, options: [.workingColorSpace: NSNull(), .outputColorSpace: NSNull(), .cacheIntermediates: false])
let W = plan.fullWidth, H = plan.fullHeight
let target = URL(fileURLWithPath: plan.output)
try? FileManager.default.removeItem(at: target)
guard let writer = try? AVAssetWriter(outputURL: target, fileType: .mp4) else { fail("Could not start the file.") }
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: W, AVVideoHeightKey: H,
    AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: plan.bitrate, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
                                      AVVideoAllowFrameReorderingKey: false, AVVideoMaxKeyFrameIntervalKey: plan.fps],
    AVVideoColorPropertiesKey: [AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2, AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
                                AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2],
])
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: W, kCVPixelBufferHeightKey as String: H,
    kCVPixelBufferMetalCompatibilityKey as String: true, kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any](),
])
writer.add(input)
guard writer.startWriting() else { fail("Could not start encoding: \(String(describing: writer.error))") }
writer.startSession(atSourceTime: .zero)
let frameRect = CGRect(x: 0, y: 0, width: W, height: H)

for n in 0..<plan.frames {
    let o = plan.offsets[n], sparks = plan.embers[n]
    var frame = Frame(w: Int32(plan.w), h: Int32(plan.h), t: Float(n) / Float(plan.frames), strength: plan.strength, tall: plan.tall,
                      r1: o[0], r2: o[1], r3: o[2], rh: o[3], embers: Int32(sparks.count / 3))
    sparks.withUnsafeBytes { if $0.count > 0 { emberBuffer.contents().copyMemory(from: $0.baseAddress!, byteCount: $0.count) } }
    guard let commands = queue.makeCommandBuffer(), let encoder = commands.makeComputeCommandEncoder() else { fail("The GPU stopped.") }
    encoder.setComputePipelineState(columns)
    for (i, buffer) in [source, n1, n2, heights, heat].enumerated() { encoder.setBuffer(buffer, offset: 0, index: i) }
    encoder.setBytes(&frame, length: MemoryLayout<Frame>.stride, index: 5)
    encoder.dispatchThreads(MTLSize(width: plan.w, height: 1, depth: 1), threadsPerThreadgroup: MTLSize(width: min(plan.w, columns.maxTotalThreadsPerThreadgroup), height: 1, depth: 1))
    encoder.setComputePipelineState(shading)
    for (i, buffer) in [mask, n1, n2, heat, halo, emberBuffer, out].enumerated() { encoder.setBuffer(buffer, offset: 0, index: i) }
    encoder.setBytes(&frame, length: MemoryLayout<Frame>.stride, index: 7)
    encoder.dispatchThreads(MTLSize(width: plan.w, height: plan.h, depth: 1), threadsPerThreadgroup: MTLSize(width: 16, height: 16, depth: 1))
    encoder.endEncoding()
    commands.commit(); commands.waitUntilCompleted()
    let small = CIImage(bitmapData: Data(bytesNoCopy: out.contents(), count: count * 16, deallocator: .none), bytesPerRow: plan.w * 16,
                        size: CGSize(width: plan.w, height: plan.h), format: .RGBAf, colorSpace: nil)
    let full = small.transformed(by: CGAffineTransform(scaleX: CGFloat(W) / CGFloat(plan.w), y: CGFloat(H) / CGFloat(plan.h))).cropped(to: frameRect)
    while !input.isReadyForMoreMediaData { usleep(200) }
    var buffer: CVPixelBuffer?
    guard let pool = adaptor.pixelBufferPool, CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess, let pixels = buffer else { fail("Ran out of frame memory.") }
    context.render(full, to: pixels, bounds: frameRect, colorSpace: nil)
    guard adaptor.append(pixels, withPresentationTime: CMTime(value: CMTimeValue(n), timescale: CMTimeScale(plan.fps))) else { fail("The encoder stopped: \(String(describing: writer.error))") }
    if n % 10 == 0 { print("frame \(n)"); fflush(stdout) }
}
input.markAsFinished()
let finished = DispatchSemaphore(value: 0)
writer.finishWriting { finished.signal() }
finished.wait()
guard writer.status == .completed else { fail("Could not finish the file: \(String(describing: writer.error))") }
print("done")
