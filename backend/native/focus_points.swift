// Where the eye goes in a picture, with Apple's Vision: every face (side-on ones too) and the most eye-catching
// region. Prints one line of JSON with boxes as shares of the picture, origin top-left:
// {"faces": [[x, y, w, h, confidence]...], "salient": [x, y, w, h] or null}
import Foundation
import Vision

let url = URL(fileURLWithPath: CommandLine.arguments[1])
let handler = VNImageRequestHandler(url: url, options: [:])
let faces = VNDetectFaceRectanglesRequest()
let attention = VNGenerateAttentionBasedSaliencyImageRequest()
do { try handler.perform([faces, attention]) } catch {
    FileHandle.standardError.write("\(error)\n".data(using: .utf8)!); exit(1)
}
func top(_ box: CGRect) -> [Double] { [Double(box.minX), Double(1 - box.maxY), Double(box.width), Double(box.height)] }
let found = (faces.results ?? []).map { top($0.boundingBox) + [Double($0.confidence)] }
let salient = (attention.results?.first?.salientObjects ?? []).max { $0.confidence * Float($0.boundingBox.width * $0.boundingBox.height) < $1.confidence * Float($1.boundingBox.width * $1.boundingBox.height) }
let out: [String: Any] = ["faces": found, "salient": salient.map { top($0.boundingBox) } as Any? ?? NSNull()]
print(String(data: try! JSONSerialization.data(withJSONObject: out), encoding: .utf8)!)
