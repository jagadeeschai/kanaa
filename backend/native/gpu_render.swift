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
    let colour: Colour?
    let wheels: Wheels?
    let film: Film?
    let glow: Glow?
    let maskPath: String?
    let blend: String?
    let rotation: [Double]?
    let zoomBlur: ZoomBlur?
    let kind: String  // "image" or "video"
    let path: String
    let paths: [String]?  // An image item that changes picture (a karaoke title): the pictures, and which one each frame shows.
    let shown: [Int]?
    let start: Int  // First frame on the timeline.
    let frames: Int
    let sourceIn: Double  // Source seconds at the item's first frame.
    let stretch: Double?  // Width against height, before the picture is fitted (timeline_schema.Clip.stretch).
    let crop: [Double]?  // The part of the picture shown: x0, y0, x1, y1 as shares, top left (timeline_schema.Crop).
    let times: [Double]?  // A speed ramp: the source second each frame shows (ramp.py). Otherwise sourceIn + frame × speed.
    let speed: Double
    let x: [Double]  // Per frame of the item: centre, as a fraction of the frame (y down).
    let y: [Double]
    let scale: [Double]  // Of the picture fitted inside the frame.
    let opacity: [Double]
    let dx: [Double]?
    let dy: [Double]?
    let zoom: [Double]?
    let blur: [Double]?
    let transition: Transition?  // Mixes this item with the one before it (same layer) over its first frames.
}

struct Colour: Decodable {
    let tint: [Double]
    let power: Double
    let fade: Double
    let contrast: Double
    let saturation: Double
}

/// Colour wheels (colour_wheels.py): lift, gamma and gain per channel, after the colour constants.
struct Wheels: Decodable {
    let lift: [Double]
    let gamma: [Double]
    let gain: [Double]
}

/// Old film stock (old_film_filters): a warm faded channel mix, then grain that changes every frame.
struct Film: Decodable {
    let mix: [Double]  // rr, rg, gg, gb, bb
    let grain: Double  // Strength in 8-bit levels.
}

// The export's colorchannelmixer, then uniform noise of the same strength in each channel (ffmpeg's noise=allf=t+u
// is random too, so the two match in strength, not grain for grain). Alpha is left as it is.
let filmKernel = CIColorKernel(source: """
float filmHash(vec2 p, float n) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + n * 37.719) * 43758.5453); }
kernel vec4 film(__sample s, vec3 mixA, vec2 mixB, float grain, float frame) {
    vec3 c = s.a > 0.0 ? s.rgb / s.a : vec3(0.0);
    c = vec3(mixA.x * c.r + mixA.y * c.g, mixA.z * c.g + mixB.x * c.b, mixB.y * c.b);
    vec2 p = destCoord();
    vec3 noise = vec3(filmHash(p, frame), filmHash(p, frame + 0.31), filmHash(p, frame + 0.67)) * 2.0 - 1.0;
    c = clamp(c + noise * grain / 255.0, 0.0, 1.0);
    return vec4(c * s.a, s.a);
}
""")!

struct Glow: Decodable {
    let radius: Double
    let amount: Double
    let lift: Double
    let saturation: Double
    let red: Double
    let blue: Double
}

struct ZoomBlur: Decodable {
    let scales: [Double]
    let x: Double
    let y: Double
}

let glowKernel = CIColorKernel(source: """
kernel vec4 soften(__sample sharp, __sample blurred, float amount, float lift, float saturation, float red, float blue) {
    vec3 c = mix(sharp.rgb, blurred.rgb, amount);
    c = clamp(c + lift * sharp.a, 0.0, sharp.a);
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = clamp(mix(vec3(luma), c, saturation), 0.0, sharp.a);
    vec3 shadows = clamp((vec3(0.333333) - c) * 3.0, 0.0, 1.0);
    c += shadows * vec3(red, 0.0, blue) * sharp.a;
    return vec4(clamp(c, 0.0, sharp.a), sharp.a);
}
""")!

// Same RGB order as picture_filters. Round at the 8-bit intermediate filter boundaries.
/// A clip's crop: see-through outside the kept box (left, bottom, right, top in image pixels).
let cropKernel = CIColorKernel(source: """
kernel vec4 cropTo(__sample s, vec4 box) {
    vec2 at = destCoord();
    return (at.x >= box.x && at.x < box.z && at.y >= box.y && at.y < box.w) ? s : vec4(0.0);
}
""")!

let colourKernel = CIColorKernel(source: """
kernel vec4 grade(__sample s, vec3 tint, float power, float fade, float contrast, float saturation) {
    vec3 c = s.a > 0.0 ? s.rgb / s.a : vec3(0.0);
    c = floor(clamp(c * tint, 0.0, 1.0) * 255.0 + 0.5) / 255.0;
    c = floor(pow(c, vec3(power)) * 255.0) / 255.0;
    c = floor((c * (1.0 - fade) + fade) * 255.0) / 255.0;
    c = floor(clamp((c - 0.5) * contrast + 0.5, 0.0, 1.0) * 255.0) / 255.0;
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = clamp(mix(vec3(luma), c, saturation), 0.0, 1.0);
    return vec4(c * s.a, s.a);
}
""")!

// As the export's lutrgb: each channel's 8-bit value through the curve, rounded back to 8 bits.
let wheelsKernel = CIColorKernel(source: """
kernel vec4 wheels(__sample s, vec3 lift, vec3 gamma, vec3 gain) {
    vec3 c = s.a > 0.0 ? s.rgb / s.a : vec3(0.0);
    c = floor(clamp(c, 0.0, 1.0) * 255.0 + 0.5) / 255.0;
    c = clamp(pow(max(c + lift * (1.0 - c), 0.0), 1.0 / gamma) * gain, 0.0, 1.0);
    c = floor(c * 255.0 + 0.5) / 255.0;
    return vec4(c * s.a, s.a);
}
""")!

// A Gaussian blur across only (the whip's, as ffmpeg's gblur with sigmaV 0), sigma in pixels.
let sidewaysKernel = CIKernel(source: """
kernel vec4 sideways(sampler src, float sigma) {
    vec2 d = destCoord();
    float step = max(1.0, sigma / 6.0);
    vec4 sum = vec4(0.0); float total = 0.0;
    for (float x = -3.0 * sigma; x <= 3.0 * sigma; x += step) {
        float w = exp(-(x * x) / (2.0 * sigma * sigma));
        sum += sample(src, samplerTransform(src, d + vec2(x, 0.0))) * w; total += w;
    }
    return sum / total;
}
""")!
// The finish's glow: only what is brighter than half, stretched (lutrgb clip((val-128)*2)).
let thresholdKernel = CIColorKernel(source: """
kernel vec4 bright(__sample s) { return vec4(clamp((s.rgb - 0.5) * 2.0, 0.0, 1.0), 1.0); }
""")!
// blend screen with all_opacity: the screened picture mixed back by the glow's amount.
let screenKernel = CIColorKernel(source: """
kernel vec4 screenBy(__sample base, __sample light, float amount) {
    vec3 screened = 1.0 - (1.0 - base.rgb) * (1.0 - light.rgb);
    return vec4(mix(base.rgb, screened, amount), base.a);
}
""")!
// The vignette (finish_service.vignette_mask, multiplied) and the grain (uniform noise on the brightness, new each frame).
let vignetteKernel = CIColorKernel(source: """
float finishHash(vec2 p, float n) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + n * 37.719) * 43758.5453); }
kernel vec4 vignette(__sample s, vec2 size, float amount, float from, float to, float grain, float frame) {
    vec2 p = destCoord();
    float aspect = size.x / size.y;
    vec2 d = vec2((p.x / size.x - 0.5) * aspect, p.y / size.y - 0.5);
    float reach = length(d) / length(vec2(aspect * 0.5, 0.5));
    float t = clamp((reach - from) / (to - from), 0.0, 1.0);
    vec3 c = s.rgb * (1.0 - amount * t * t * (3.0 - 2.0 * t));
    c += (finishHash(p, frame) * 2.0 - 1.0) * grain / 255.0;
    return vec4(clamp(c, 0.0, 1.0), s.a);
}
""")!

struct SplitPanel: Decodable { let rect: [Double]; let move: [Double] }
struct ScreenParts: Decodable { let a: [Double]; let b: [Double] }  // Window [x, y, w, h] and move [dx, dy], top-left pixels (split_screen.py).
struct Transition: Decodable {
    let slide: [Double]?  // Whip: xfade's progress each frame (1 shows the clip before); the old clip pushed out left.
    let zoom: [[Double]]?  // Cross zoom: each frame the old clip's size, the new one's, and the streaks (moving_transitions).
    let screen: [ScreenParts]?
    let split: [[SplitPanel]]?
    let split_shadow: Double?
    let kind: String?
    let frames: Int
    let weights: [[Double]]  // Per frame: the item before, this item, the fill colour.
    let blur: [Double]  // Per frame: Gaussian blur of the mix, in pixels (cross blur), or 0.
    let fill: [Double]  // RGB, 0...1.
}

/// The cinematic finish (finish_service.py), over everything before the first caption.
struct Finish: Decodable {
    let cube: [Float]?
    let cubeSize: Int
    let glow: Double
    let glowSmall: [Int]
    let glowSigma: Double
    let vignette: Double
    let vignetteFrom: Double
    let vignetteTo: Double
    let grain: Double  // 8-bit levels, ± (ffmpeg noise c0s / 2 on the luma).
    let bars: [Int]  // Side, top: pixels.
    let barColour: [Double]
}

struct Plan: Decodable {
    let finish: Finish?
    let finishAt: Int?
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
var changingPictures: [Int: String] = [:]
var videos: [Int: VideoSource] = [:]
var masks: [Int: VideoSource] = [:]

/// Scales a picture's alpha (Core Image keeps colour premultiplied, so this scales every channel evenly).
/// A picture through an item's colour constants and colour wheels, as a clip's own colour is applied.
func graded(_ image: CIImage, _ item: Item) -> CIImage {
    var shown = image
    if let c = item.colour {
        shown = colourKernel.apply(extent: shown.extent, arguments: [shown, CIVector(x: c.tint[0], y: c.tint[1], z: c.tint[2]), c.power, c.fade, c.contrast, c.saturation])!
    }
    if let w = item.wheels {
        shown = wheelsKernel.apply(extent: shown.extent, arguments: [shown, CIVector(x: w.lift[0], y: w.lift[1], z: w.lift[2]), CIVector(x: w.gamma[0], y: w.gamma[1], z: w.gamma[2]), CIVector(x: w.gain[0], y: w.gain[1], z: w.gain[2])])!
    }
    return shown
}

/// The source second frame `k` of a video item shows: its ramp's own time, or a steady speed from its in point.
func sourceTime(_ item: Item, _ k: Int) -> Double {
    if let times = item.times, !times.isEmpty { return times[min(max(0, k), times.count - 1)] }
    return item.sourceIn + Double(k) / Double(plan.fps) * item.speed
}

func weighted(_ image: CIImage, _ amount: Double) -> CIImage {
    amount >= 0.999 ? image : image.applyingFilter("CIColorMatrix", parameters: ["inputAVector": CIVector(x: 0, y: 0, z: 0, w: CGFloat(amount))])
}

/// A frame scaled about its middle, cut to the frame (ffmpeg's scale then centred crop).
func zoomed(_ image: CIImage, _ size: Double) -> CIImage {
    let cx = Double(W) / 2, cy = Double(H) / 2
    return image.transformed(by: CGAffineTransform(translationX: cx, y: cy).scaledBy(x: size, y: size).translatedBy(x: -cx, y: -cy)).cropped(to: frameRect)
}

/// The cross zoom's streaks: the average of five sizes along lines from the middle (moving_transitions.cross_zoom).
func streaked(_ image: CIImage, _ size: Double, _ streaks: Double) -> CIImage {
    var sum = CIImage.empty().cropped(to: frameRect)
    for t in 0..<5 {
        let tap = weighted(zoomed(image, size * (1 + streaks * Double(t) / 4)), 0.2)
        sum = tap.applyingFilter("CIAdditionCompositing", parameters: [kCIInputBackgroundImageKey: sum])
    }
    return sum.cropped(to: frameRect)
}

/// The cinematic finish at frame `f` (finish_service.finish_filters, in the same order).
func finished(_ frame: CIImage, _ fin: Finish, _ f: Int) -> CIImage {
    var out = frame.cropped(to: frameRect)
    if let cube = fin.cube {
        let data = cube.withUnsafeBufferPointer { Data(buffer: $0) }
        out = out.applyingFilter("CIColorCube", parameters: ["inputCubeDimension": fin.cubeSize, "inputCubeData": data]).cropped(to: frameRect)
    }
    if fin.glow > 0 {
        let sw = Double(fin.glowSmall[0]), sh = Double(fin.glowSmall[1])
        let small = out.transformed(by: CGAffineTransform(scaleX: sw / Double(W), y: sh / Double(H)))
        let light = thresholdKernel.apply(extent: small.extent, arguments: [small])!
            .clampedToExtent().applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: fin.glowSigma]).cropped(to: small.extent)
            .transformed(by: CGAffineTransform(scaleX: Double(W) / sw, y: Double(H) / sh)).cropped(to: frameRect)
        out = screenKernel.apply(extent: frameRect, arguments: [out, light, fin.glow])!
    }
    if fin.vignette > 0 || fin.grain > 0 {
        out = vignetteKernel.apply(extent: frameRect, arguments: [out, CIVector(x: CGFloat(W), y: CGFloat(H)), fin.vignette, fin.vignetteFrom, fin.vignetteTo, fin.grain, Double(f % 997)])!
    }
    let colour = CIColor(red: CGFloat(fin.barColour[0]), green: CGFloat(fin.barColour[1]), blue: CGFloat(fin.barColour[2]))
    if fin.bars[1] > 0 {
        let bar = CGFloat(fin.bars[1])
        for rect in [CGRect(x: 0, y: 0, width: CGFloat(W), height: bar), CGRect(x: 0, y: CGFloat(H) - bar, width: CGFloat(W), height: bar)] {
            out = CIImage(color: colour).cropped(to: rect).composited(over: out)
        }
    }
    if fin.bars[0] > 0 {
        let bar = CGFloat(fin.bars[0])
        for rect in [CGRect(x: 0, y: 0, width: bar, height: CGFloat(H)), CGRect(x: CGFloat(W) - bar, y: 0, width: bar, height: CGFloat(H))] {
            out = CIImage(color: colour).cropped(to: rect).composited(over: out)
        }
    }
    return out.cropped(to: frameRect)
}

/// Item `index` at its own frame `k`, placed on the frame: fitted inside it, sized, centred where the plan says (Core
/// Image counts y from the bottom), and as see-through as the plan says. Nil when it shows nothing.
func posed(_ index: Int, _ k: Int) -> CIImage? {
    let item = plan.items[index]
    var picture: CIImage?
    if item.kind == "image" {
        let path = item.paths.map { $0[item.shown![k]] } ?? item.path
        if item.paths != nil, let previous = changingPictures[index], previous != path {
            pictures.removeValue(forKey: previous)
        }
        if item.paths != nil { changingPictures[index] = path }
        if pictures[path] == nil {
            pictures[path] = CIImage(contentsOf: URL(fileURLWithPath: path), options: [.colorSpace: NSNull(), .applyOrientationProperty: true])
        }
        picture = pictures[path]
    } else {
        if videos[index] == nil {
            do { videos[index] = try VideoSource(path: item.path, from: item.sourceIn) } catch { fail("Could not read \(item.path): \(error)") }
        }
        picture = videos[index]!.frame(at: sourceTime(item, k))
    }
    guard var shown = picture, item.opacity[k] > 0.001 else { return nil }
    if let c = item.crop, c != [0, 0, 1, 1] {
        // As the export's crop_filters: whole pixels of the picture, from its top left.
        let e = shown.extent, w = e.width, h = e.height
        let box = CIVector(x: e.minX + (w * c[0] + 0.5).rounded(.down), y: e.minY + h - (h * c[3] + 0.5).rounded(.down),
                           z: e.minX + (w * c[2] + 0.5).rounded(.down), w: e.minY + h - (h * c[1] + 0.5).rounded(.down))
        shown = cropKernel.apply(extent: e, arguments: [shown, box])!
    }
    if let path = item.maskPath {
        if masks[index] == nil {
            do { masks[index] = try VideoSource(path: path, from: item.sourceIn) } catch { fail("Could not read mask: \(error)") }
        }
        guard let mask = masks[index]!.frame(at: sourceTime(item, k)) else { fail("Mask has no frames") }
        let alpha = mask.transformed(by: CGAffineTransform(scaleX: shown.extent.width / mask.extent.width, y: shown.extent.height / mask.extent.height))
        shown = shown.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: CIImage.empty(), kCIInputMaskImageKey: alpha])
    }
    if let c = item.colour, c.tint != [1, 1, 1] || c.power != 1 || c.fade != 0 || c.contrast != 1 || c.saturation != 1 {
        shown = colourKernel.apply(extent: shown.extent, arguments: [shown, CIVector(x: c.tint[0], y: c.tint[1], z: c.tint[2]), c.power, c.fade, c.contrast, c.saturation])!
    }
    if let w = item.wheels {
        shown = wheelsKernel.apply(extent: shown.extent, arguments: [shown, CIVector(x: w.lift[0], y: w.lift[1], z: w.lift[2]), CIVector(x: w.gamma[0], y: w.gamma[1], z: w.gamma[2]), CIVector(x: w.gain[0], y: w.gain[1], z: w.gain[2])])!
    }
    if let f = item.film {
        shown = filmKernel.apply(extent: shown.extent, arguments: [shown, CIVector(x: f.mix[0], y: f.mix[1], z: f.mix[2]), CIVector(x: f.mix[3], y: f.mix[4]), f.grain, Double(item.start + k)])!
    }
    if let effect = item.zoomBlur {
        let rect = shown.extent
        let cx = rect.minX + rect.width * effect.x
        let cy = rect.minY + rect.height * (1 - effect.y)
        var mixed = CIImage.empty().cropped(to: rect)
        for scale in effect.scales {
            let copy = shown.transformed(by: CGAffineTransform(translationX: -cx, y: -cy))
                .transformed(by: CGAffineTransform(scaleX: scale, y: scale))
                .transformed(by: CGAffineTransform(translationX: cx, y: cy)).cropped(to: rect)
            mixed = weighted(copy, 1 / Double(effect.scales.count)).applyingFilter("CIAdditionCompositing", parameters: [kCIInputBackgroundImageKey: mixed])
        }
        shown = mixed
    }
    if let g = item.glow {
        let blurred = shown.clampedToExtent().applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: g.radius]).cropped(to: shown.extent)
        shown = glowKernel.apply(extent: shown.extent, arguments: [shown, blurred, g.amount, g.lift, g.saturation, g.red, g.blue])!
    }
    if let blur = item.blur, blur[k] > 0 {
        shown = shown.applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: blur[k] * Double(H)]).cropped(to: shown.extent)
    }
    if let st = item.stretch, st != 1 {
        // As the export: the picture made wider or narrower first, then fitted inside the frame.
        let r = shown.extent
        shown = shown.transformed(by: CGAffineTransform(translationX: -r.minX, y: 0)).transformed(by: CGAffineTransform(scaleX: st, y: 1)).transformed(by: CGAffineTransform(translationX: r.minX, y: 0))
    }
    let e = shown.extent
    let size = min(Double(W) / e.width, Double(H) / e.height) * item.scale[k]
    shown = shown.transformed(by: CGAffineTransform(translationX: -e.midX, y: -e.midY))
        .transformed(by: CGAffineTransform(rotationAngle: -(item.rotation?[k] ?? 0) * .pi / 180))
        .transformed(by: CGAffineTransform(scaleX: size, y: size))
        .transformed(by: CGAffineTransform(translationX: item.x[k] * Double(W), y: (1 - item.y[k]) * Double(H)))
    shown = weighted(shown, item.opacity[k])
    // pose(): blur and crop the posed full frame, then animate that frame about its centre.
    shown = shown.cropped(to: frameRect)
    let zoom = item.zoom?[k] ?? 1
    shown = shown.transformed(by: CGAffineTransform(translationX: -Double(W) / 2, y: -Double(H) / 2))
        .transformed(by: CGAffineTransform(scaleX: zoom, y: zoom))
        .transformed(by: CGAffineTransform(translationX: Double(W) * (0.5 + (item.dx?[k] ?? 0)), y: Double(H) * (0.5 - (item.dy?[k] ?? 0))))
    return shown.cropped(to: frameRect)
}

/// Whether item `index` is the clip before a transition that is under way at frame `f` (then the next item draws both).
func givesWay(_ index: Int, _ f: Int) -> Bool {
    guard index + 1 < plan.items.count, let mix = plan.items[index + 1].transition else { return false }
    let into = f - plan.items[index + 1].start
    return into >= 0 && into < mix.frames
}

// Same diagonal white-gold band as cinematic_transition.py and TRANSITION_FRAGMENT.
let lightWipeKernel = CIColorKernel(source: """
kernel vec4 lightWipe(__sample a, __sample b, float width, float height, float q) {
    vec2 xy = destCoord();
    float d=(xy.x-.5)/width+.2*(height-xy.y-.5)/height-(-.25+1.5*q);
    float m=clamp(.5-d/.1,0.0,1.0);
    float glow=.9*exp(-pow(d/.08,2.0))*sin(3.14159265359*q);
    return mix(mix(a,b,m),vec4(1.0,242.0/255.0,205.0/255.0,1.0),glow);
}
""")
// Addition is evaluated on straight RGB, clamped, then mixed by the overlay's alpha,
// matching Builder.blended and the preview (including partially transparent bright lights).
let opaqueBlendKernel = CIColorKernel(source: "kernel vec4 opaqueBlend(__sample s) { return vec4(unpremultiply(s).rgb, 1.0); }")
let additionClampKernel = CIColorKernel(source: "kernel vec4 additionClamp(__sample s) { return vec4(clamp(s.rgb, 0.0, 1.0), 1.0); }")
func compositeLayer(_ image: CIImage, over base: CIImage, mode: String?) -> CIImage {
    if mode == "screen" { return image.applyingFilter("CIScreenBlendMode", parameters: [kCIInputBackgroundImageKey: base]) }
    if mode == "add" {
        guard let opaque = opaqueBlendKernel?.apply(extent: frameRect, arguments: [image]) else { fatalError("Could not draw Add blend; use FFmpeg") }
        let sum = opaque.applyingFilter("CIAdditionCompositing", parameters: [kCIInputBackgroundImageKey: base])
        // Addition also adds alpha (to 2); preserve its summed RGB while restoring an opaque alpha.
        guard let added = additionClampKernel?.apply(extent: frameRect, arguments: [sum]) else { fatalError("Could not clamp Add blend") }
        return added.applyingFilter("CIBlendWithAlphaMask", parameters: [kCIInputBackgroundImageKey: base, kCIInputMaskImageKey: image])
    }
    return image.composited(over: base)
}
let splitShadowKernel = CIColorKernel(source: """
kernel vec4 panelShadow(__sample image, vec4 rect, float height, float radius, float strength) {
    vec2 at = vec2(floor(destCoord().x), height - 1.0 - floor(destCoord().y)) - rect.xy;
    float distance = max(max(-at.x, at.x-(rect.z-1.0)), max(-at.y, at.y-(rect.w-1.0)));
    float alpha = strength * pow(max(0.0, 1.0-max(0.0,distance)/radius), 2.0);
    return vec4(0.0,0.0,0.0,alpha) + image*(1.0-alpha);
}
""")!

for f in 0..<plan.frames {
    var frame = black
    for (index, item) in plan.items.enumerated() {
        if let fin = plan.finish, index == (plan.finishAt ?? plan.items.count) { frame = finished(frame, fin, f) }
        let k = f - item.start
        if k >= item.frames {
            videos[index] = nil; masks[index] = nil
            if let path = changingPictures.removeValue(forKey: index) { pictures.removeValue(forKey: path) }
        }  // Finished: let its decoder and changing title textures go.
        if item.kind == "grade" {
            // An adjustment span (adjust_layer.py): everything drawn so far, graded, laid back over itself as strongly as it shows now.
            if k >= 0, k < item.frames, item.opacity[k] > 0.0005 { frame = weighted(graded(frame, item), item.opacity[k]).composited(over: frame) }
            continue
        }
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
            if mix.kind == "split-screen", let states = mix.screen, let a = posed(index - 1, f - before.start), let b = posed(index, k) {
                // The new clip moved onto black, then the old one through its window over it (split_screen.build).
                let state = states[k]
                func shown(_ picture: CIImage, _ part: [Double]) -> CIImage {
                    let window = CGRect(x: part[0], y: Double(plan.height) - part[1] - part[3], width: part[2], height: part[3])
                    return picture.transformed(by: CGAffineTransform(translationX: part[4], y: -part[5])).cropped(to: window)
                }
                layer = shown(a, state.a).composited(over: shown(b, state.b).composited(over: CIImage(color: .black).cropped(to: frameRect)))
            } else if mix.kind == "split", let states = mix.split, let a = posed(index - 1, f - before.start), let b = posed(index, k) {
                layer = b
                let p = Double(k)/Double(mix.frames), eased = p*p*(3-2*p)
                for panel in states[k] {
                    let r = panel.rect, m = panel.move, gap = m[3]
                    if m[2] <= 0 { continue }
                    if let radius = mix.split_shadow, radius > 0 {
                        layer = splitShadowKernel.apply(extent: frameRect, arguments: [layer, CIVector(x: r[0]+m[0], y: r[1]+m[1], z: r[2], w: r[3]), Double(plan.height), radius, 0.22*eased*m[2]])!
                    }
                    let left = r[0] > 0 ? gap : 0, right = r[0]+r[2] < Double(plan.width) ? gap : 0
                    let top = r[1] > 0 ? gap : 0, bottom = r[1]+r[3] < Double(plan.height) ? gap : 0
                    let rect = CGRect(x: r[0]+left, y: Double(plan.height)-r[1]-r[3]+bottom, width: max(0,r[2]-left-right), height: max(0,r[3]-top-bottom))
                    let piece = a.cropped(to: rect).transformed(by: CGAffineTransform(translationX: m[0], y: -m[1]))
                    layer = weighted(piece, m[2]).composited(over: layer)
                }
            } else if mix.kind == "whip", let shift = mix.slide, let a = posed(index - 1, f - before.start), let b = posed(index, k) {
                // xfade slideleft: the old clip pushed out to the left as the new one comes in from the right.
                let p = shift[k], w = Double(plan.width)
                layer = a.transformed(by: CGAffineTransform(translationX: -(1 - p) * w, y: 0)).cropped(to: frameRect)
                    .composited(over: b.transformed(by: CGAffineTransform(translationX: p * w, y: 0)).cropped(to: frameRect))
            } else if mix.kind == "cross-zoom", let sizes = mix.zoom, let a = posed(index - 1, f - before.start), let b = posed(index, k) {
                // Into the old clip and out of the new, each streaked, faded across (moving_transitions.cross_zoom).
                let z = sizes[k]
                layer = weighted(streaked(a, z[0], z[2]), w[0]).applyingFilter("CIAdditionCompositing", parameters: [kCIInputBackgroundImageKey: weighted(streaked(b, z[1], z[2]), w[1])])
            } else if mix.kind == "light-wipe", let a = posed(index - 1, f - before.start), let b = posed(index, k) {
                guard let kernel = lightWipeKernel, let wiped = kernel.apply(extent: frameRect, arguments: [a, b, Double(plan.width), Double(plan.height), Double(k)/Double(mix.frames)]) else {
                    fatalError("Could not draw the light wipe; use the FFmpeg fallback")
                }
                layer = wiped
            } else {
                for (picture, amount) in parts where amount > 0.0005 {
                    if let picture { layer = weighted(picture, amount).applyingFilter("CIAdditionCompositing", parameters: [kCIInputBackgroundImageKey: layer]) }
                }
            }
            layer = layer.cropped(to: frameRect)
            if mix.blur[k] > 0.01, mix.kind == "whip" {
                layer = sidewaysKernel.apply(extent: frameRect, roiCallback: { _, rect in rect.insetBy(dx: -CGFloat(3 * mix.blur[k] + 2), dy: 0) }, arguments: [layer.clampedToExtent(), mix.blur[k]])!.cropped(to: frameRect)
            } else if mix.blur[k] > 0.01 {
                layer = layer.clampedToExtent().applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: mix.blur[k]]).cropped(to: frameRect)
            }
            frame = compositeLayer(layer, over: frame, mode: item.blend)
        } else if let shown = posed(index, k) {
            frame = compositeLayer(shown, over: frame, mode: item.blend)
        }
    }
    if let fin = plan.finish, (plan.finishAt ?? plan.items.count) >= plan.items.count { frame = finished(frame, fin, f) }
    while !input.isReadyForMoreMediaData {
        if writer.status == .failed || writer.status == .cancelled { fail("Encoder stopped: \(String(describing: writer.error))") }
        usleep(200)
    }
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
