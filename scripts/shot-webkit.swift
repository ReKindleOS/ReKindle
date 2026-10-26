import Cocoa
import WebKit
import ApplicationServices

// Offscreen WebKit screenshot helper for ReKindle visual audits.
//
// usage: shot-webkit <url> <width> <height> <out.png> [js] [js-wait-seconds]
//
// Kindle Paperwhite-class CSS viewport is ~800x1000 (the 1232x1544 marketing
// screenshots are ~1.54x of that), and theme.js auto-scale targets 800x906.
// Prefer 800x1000 for the main capture and 600x800 for a narrow check.
//
// Why this exists:
//   The obvious WKWebView helper calls NSApplication.run() and orders a window
//   front, which makes the helper the frontmost app and steals focus. This
//   version never activates and creates no window at all:
//     * the process is transformed to a background application before
//       NSApplication is created;
//     * the WKWebView is created off-window and snapshotted directly;
//     * the run loop is pumped manually instead of NSApp.run().
//   A control test (idle `sleep`) shows unrelated window-manager apps can steal
//   focus on this desktop; the harness itself does not.
//
// The [js] argument runs after load and before the snapshot; append ";0" to a
// statement-only snippet so WebKit does not report an unsupported return type.

let args = CommandLine.arguments
guard args.count >= 5 else {
    print("usage: shot-webkit <url> <w> <h> <out.png> [js] [js-wait-seconds]")
    exit(1)
}
let urlString = args[1]
let width = Double(args[2]) ?? 800
let height = Double(args[3]) ?? 1000
let outPath = args[4]
let userJS = args.count > 5 ? args[5] : ""
let userWait = args.count > 6 ? (Double(args[6]) ?? 0.8) : 0.8

var psn = ProcessSerialNumber(highLongOfPSN: 0, lowLongOfPSN: UInt32(kCurrentProcess))
TransformProcessType(&psn, ProcessApplicationTransformState(kProcessTransformToBackgroundApplication))

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)

let config = WKWebViewConfiguration()
config.preferences.setValue(true, forKey: "developerExtrasEnabled")
let webView = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: height), configuration: config)
webView.setValue(false, forKey: "drawsBackground")

class Nav: NSObject, WKNavigationDelegate {
    var done = false
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { done = true }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { done = true }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { done = true }
}
let nav = Nav()
webView.navigationDelegate = nav

if urlString.hasPrefix("file:") {
    let url = URL(fileURLWithPath: String(urlString.dropFirst(7)))
    webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
} else if let url = URL(string: urlString) {
    webView.load(URLRequest(url: url))
}

func pump(_ seconds: Double) {
    let end = Date().addingTimeInterval(seconds)
    while Date() < end {
        RunLoop.main.run(mode: .default, before: Date(timeIntervalSinceNow: 0.05))
    }
}

func snapshot() {
    let cfg = WKSnapshotConfiguration()
    cfg.rect = NSRect(x: 0, y: 0, width: width, height: height)
    webView.takeSnapshot(with: cfg) { image, error in
        guard let image = image, error == nil else {
            print("snapshot error: \(String(describing: error))")
            exit(2)
        }
        guard let tiff = image.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff),
              let png = rep.representation(using: .png, properties: [:]) else {
            print("png encode failed")
            exit(3)
        }
        try? png.write(to: URL(fileURLWithPath: outPath))
        print("wrote \(outPath) \(Int(image.size.width))x\(Int(image.size.height))")
        exit(0)
    }
}

for _ in 0..<100 {
    if nav.done { break }
    pump(0.2)
}
pump(1.5)

if userJS.isEmpty {
    snapshot()
} else {
    webView.evaluateJavaScript(userJS + ";0") { _, error in
        if let error = error { print("js error: \(error)") }
        pump(userWait)
        snapshot()
    }
}

// Keep the run loop alive until the snapshot callback exits.
pump(5)
print("timeout")
exit(4)
