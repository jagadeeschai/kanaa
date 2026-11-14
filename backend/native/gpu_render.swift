// Kanaa's GPU render engine (foundation): draws each frame of a timeline with Core Image on the GPU and hands it straight
// to the hardware H.264 encoder. Only what is on screen at a frame is touched, video is decoded by the Media Engine, and
// nothing passes through the CPU frame by frame.
//
// Input: a plan made by app/services/gpu_render.py (JSON file path as the only argument). Every per-frame value (place,
// size, opacity) is worked out there with the same maths as the ffmpeg export, so this file only draws.
// Output: a silent MP4 at plan.output; "frame N" lines on stdout as progress, then "done".
import AVFoundation
import CoreImage
import Foundation
import Metal

struct Item: Decodable {
    let kind: String  // "image" or "video"
    let path: String
    let paths: [String]?  // An image item that changes picture (a karaoke title): the pictures, and which one each frame shows.
    let shown: [Int]?
    let start: Int  // First frame on the timeline.
    let frames: Int
    let sourceIn: Double  // Source seconds at the item's first frame.
    let speed: Double
    let x: [Double]  // Per frame of the item: centre, as a fraction of the frame (y down).
    let y: [Double]
    let scale: [Double]  // Of the picture fitted inside the frame.
    let opacity: [Double]
    let transition: Transition?  // Mixes this item with the one before it (same layer) over its first frames.
}

struct Transition: Decodable {
    let frames: Int
    let weights: [[Double]]  // Per frame: the item before, this item, the fill colour.
    let blur: [Double]  // Per frame: Gaussian blur of the mix, in pixels (cross blur), or 0.
    let fill: [Double]  // RGB, 0...1.
}

struct Plan: Decodable {
    let width: Int
    let height: Int
    let fps: Int
    let frames: Int
    let bitrate: Int
    let output: String
    let items: [Item]  // Bottom to top.
}

/// Frames of one video clip, read forward once from the clip's in point.
final class VideoSource {
    private let reader: AVAssetReader
    private let output: AVAssetReaderTrackOutput
    private var current: CIImage?
    private var waiting: CMSampleBuffer?

    init(path: String, from: Double) throws {
        let asset = AVURLAsset(url: URL(fileURLWithPath: path))
        guard let track = asset.tracks(withMediaType: .video).first else {
            throw NSError(domain: "gpu_render", code: 2, userInfo: [NSLocalizedDescriptionKey: "No picture in \(path)"])
        }
        reader = try AVAssetReader(asset: asset)
        // Before the source starts (a transition's extra frames), its first frame is held.
        reader.timeRange = CMTimeRange(start: CMTime(seconds: max(0, from), preferredTimescale: 60000), duration: .positiveInfinity)
        output = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
        output.alwaysCopiesSampleData = false
        reader.add(output)
        reader.startReading()
    }

    /// The frame showing at source second `t`: the latest one not after it (the first, before any; the last, after the end).
    func frame(at t: Double) -> CIImage? {
        while true {
            if waiting == nil {
                waiting = output.copyNextSampleBuffer()
                if waiting == nil { return current }
            }
            let shown = CMSampleBufferGetPresentationTimeStamp(waiting!).seconds
            if shown > t + 0.0005 && current != nil { return current }
            if let pixels = CMSampleBufferGetImageBuffer(waiting!) {
                current = CIImage(cvPixelBuffer: pixels, options: [.colorSpace: NSNull()])
            }
            waiting = nil
            if shown > t + 0.0005 { return current }
        }
    }
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(1)
}

guard CommandLine.arguments.count == 2 else { fail("usage: gpu_render plan.json") }
let plan: Plan
do {
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase
    plan = try decoder.decode(Plan.self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
} catch { fail("Could not read the plan: \(error)") }

let W = plan.width, H = plan.height
let frameRect = CGRect(x: 0, y: 0, width: W, height: H)
guard let device = MTLCreateSystemDefaultDevice() else { fail("No GPU found.") }
// No colour management: pictures are combined on their stored values, as ffmpeg does, so the two match.
let context = CIContext(mtlDevice: device, options: [.workingColorSpace: NSNull(), .outputColorSpace: NSNull(), .cacheIntermediates: false])

let target = URL(fileURLWithPath: plan.output)
try? FileManager.default.removeItem(at: target)
let writer: AVAssetWriter
do { writer = try AVAssetWriter(outputURL: target, fileType: .mp4) } catch { fail("Could not start the file: \(error)") }
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: W, AVVideoHeightKey: H,
    // No B-frames and a keyframe each second, like the ffmpeg export: the default reordering starved some frames.
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

let black = CIImage(color: CIColor(red: 0, green: 0, blue: 0)).cropped(to: frameRect)
var pictures: [String: CIImage] = [:]
var videos: [Int: VideoSource] = [:]

/// Scales a picture's alpha (Core Image keeps colour premultiplied, so this scales every channel evenly).
func weighted(_ image: CIImage, _ amount: Double) -> CIImage {
    amount >= 0.999 ? image : image.applyingFilter("CIColorMatrix", parameters: ["inputAVector": CIVector(x: 0, y: 0, z: 0, w: CGFloat(amount))])
}

/// Item `index` at its own frame `k`, placed on the frame: fitted inside it, sized, centred where the plan says (Core
/// Image counts y from the bottom), and as see-through as the plan says. Nil when it shows nothing.
func posed(_ index: Int, _ k: Int) -> CIImage? {
    let item = plan.items[index]
    var picture: CIImage?
    if item.kind == "image" {
        let path = item.paths.map { $0[item.shown![k]] } ?? item.path
        if pictures[path] == nil {
            pictures[path] = CIImage(contentsOf: URL(fileURLWithPath: path), options: [.colorSpace: NSNull(), .applyOrientationProperty: true])
        }
        picture = pictures[path]
    } else {
        if videos[index] == nil {
            do { videos[index] = try VideoSource(path: item.path, from: item.sourceIn) } catch { fail("Could not read \(item.path): \(error)") }
        }
        picture = videos[index]!.frame(at: item.sourceIn + Double(k) / Double(plan.fps) * item.speed)
    }
    guard var shown = picture, item.opacity[k] > 0.001 else { return nil }
    let e = shown.extent
    let size = min(Double(W) / e.width, Double(H) / e.height) * item.scale[k]
    shown = shown.transformed(by: CGAffineTransform(translationX: -e.midX, y: -e.midY))
        .transformed(by: CGAffineTransform(scaleX: size, y: size))
        .transformed(by: CGAffineTransform(translationX: item.x[k] * Double(W), y: (1 - item.y[k]) * Double(H)))
    return weighted(shown, item.opacity[k])
}

/// Whether item `index` is the clip before a transition that is under way at frame `f` (then the next item draws both).
func givesWay(_ index: Int, _ f: Int) -> Bool {
    guard index + 1 < plan.items.count, let mix = plan.items[index + 1].transition else { return false }
    let into = f - plan.items[index + 1].start
    return into >= 0 && into < mix.frames
}

for f in 0..<plan.frames {
    var frame = black
    for (index, item) in plan.items.enumerated() {
        let k = f - item.start
        if k >= item.frames { videos[index] = nil }  // Finished: let its decoder go.
        guard k >= 0, k < item.frames, !givesWay(index, f) else { continue }
        if let mix = item.transition, k < mix.frames {
            // The two clips mixed as one layer (xfade), with the fill colour for a dip or flash, then blurred.
            let w = mix.weights[k]
            var layer = CIImage.empty().cropped(to: frameRect)
            let before = plan.items[index - 1]
            let parts: [(CIImage?, Double)] = [
                (posed(index - 1, f - before.start), w[0]), (posed(index, k), w[1]),
                (CIImage(color: CIColor(red: CGFloat(mix.fill[0]), green: CGFloat(mix.fill[1]), blue: CGFloat(mix.fill[2]))).cropped(to: frameRect), w[2]),
            ]
            for (picture, amount) in parts where amount > 0.0005 {
                if let picture { layer = weighted(picture, amount).applyingFilter("CIAdditionCompositing", parameters: [kCIInputBackgroundImageKey: layer]) }
            }
            layer = layer.cropped(to: frameRect)
            if mix.blur[k] > 0.01 {
                layer = layer.clampedToExtent().applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: mix.blur[k]]).cropped(to: frameRect)
            }
            frame = layer.composited(over: frame)
        } else if let shown = posed(index, k) {
            frame = shown.composited(over: frame)
        }
    }
    while !input.isReadyForMoreMediaData { usleep(200) }
    var buffer: CVPixelBuffer?
    guard let pool = adaptor.pixelBufferPool, CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess, let pixels = buffer else {
        fail("Ran out of frame memory.")
    }
    context.render(frame.cropped(to: frameRect), to: pixels, bounds: frameRect, colorSpace: nil)
    guard adaptor.append(pixels, withPresentationTime: CMTime(value: CMTimeValue(f), timescale: CMTimeScale(plan.fps))) else {
        fail("The encoder stopped: \(String(describing: writer.error))")
    }
    if f % 30 == 0 { print("frame \(f)"); fflush(stdout) }
}
input.markAsFinished()
let finished = DispatchSemaphore(value: 0)
writer.finishWriting { finished.signal() }
finished.wait()
guard writer.status == .completed else { fail("Could not finish the file: \(String(describing: writer.error))") }
print("done")
