// The Finder's own space-bar preview (QLPreviewPanel) for one file, in a
// process with no Dock icon: it ends when the panel closes.
//
// Build: swiftc -O onizle.swift -o onizle

import AppKit
import Quartz

final class Preview: NSObject, NSApplicationDelegate, QLPreviewPanelDataSource, QLPreviewPanelDelegate {
  let url: URL
  let isPlayable: Bool

  init(url: URL, isPlayable: Bool) {
    self.url = url
    self.isPlayable = isPlayable
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    guard let panel = QLPreviewPanel.shared() else {
      NSApp.terminate(nil)
      return
    }

    panel.dataSource = self
    panel.delegate = self
    NSApp.activate(ignoringOtherApps: true)
    panel.makeKeyAndOrderFront(nil)
    NotificationCenter.default.addObserver(
      forName: NSWindow.willCloseNotification, object: panel, queue: .main
    ) { _ in NSApp.terminate(nil) }
  }

  func numberOfPreviewItems(in panel: QLPreviewPanel!) -> Int { 1 }

  func previewPanel(_ panel: QLPreviewPanel!, previewItemAt index: Int) -> QLPreviewItem! {
    url as NSURL
  }

  // Space closes a picture's preview as it does in the Finder; in a video it
  // stays the player's own play and pause.
  func previewPanel(_ panel: QLPreviewPanel!, handle event: NSEvent!) -> Bool {
    if event.type == .keyDown, event.keyCode == 49, !isPlayable {
      panel.close()
      return true
    }

    return false
  }
}

guard CommandLine.arguments.count > 1 else {
  FputsError("usage: onizle <file>\n")
}

func FputsError(_ text: String) -> Never {
  FileHandle.standardError.write(text.data(using: .utf8)!)
  exit(2)
}

let url = URL(fileURLWithPath: CommandLine.arguments[1])
let videos = ["mp4", "mov", "m4v", "webm", "mkv", "mp3", "wav", "m4a", "aac", "flac", "ogg"]
let isVideo = videos.contains(url.pathExtension.lowercased())

let app = NSApplication.shared
let preview = Preview(url: url, isPlayable: isVideo)
app.delegate = preview
app.setActivationPolicy(.accessory)
app.run()
