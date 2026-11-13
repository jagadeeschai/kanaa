// What a picture shows, with Apple's Vision: its scene labels (lantern, candle, festival...) and how sure Vision is.
// Prints one line of JSON: {"labels": [[name, confidence]...]}, surest first, only those above 0.05.
import Foundation
import Vision

let url = URL(fileURLWithPath: CommandLine.arguments[1])
let handler = VNImageRequestHandler(url: url, options: [:])
let classify = VNClassifyImageRequest()
do { try handler.perform([classify]) } catch {
    FileHandle.standardError.write("\(error)\n".data(using: .utf8)!); exit(1)
}
let labels = (classify.results ?? []).filter { $0.confidence > 0.05 }.prefix(40).map { [$0.identifier, Double($0.confidence)] as [Any] }
print(String(data: try! JSONSerialization.data(withJSONObject: ["labels": labels]), encoding: .utf8)!)
