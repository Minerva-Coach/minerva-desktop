#!/bin/bash
# Lists all Zoom-owned windows visible to CGWindowListCopyWindowInfo —
# the same API the desktop app uses for meeting detection. Run repeatedly
# while putting Zoom into different states (idle, in lobby, in meeting,
# annotating, in breakout, fullscreen, etc.) and capture what titles show.
#
# Permission: requires Screen Recording for Terminal.app (or whatever
# launched this script). System Settings → Privacy & Security →
# Screen Recording. If kCGWindowName is missing/blank, that's the
# permission-denied signal.

/usr/bin/swift - <<'SWIFT'
import CoreGraphics
import Foundation

let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
guard let windows = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else {
    print("CGWindowListCopyWindowInfo returned nil — Screen Recording permission denied?")
    exit(1)
}

var any = false
for w in windows {
    let owner = (w[kCGWindowOwnerName as String] as? String) ?? ""
    guard owner.lowercased().contains("zoom") else { continue }
    any = true
    let pid = (w[kCGWindowOwnerPID as String] as? Int) ?? -1
    let layer = (w[kCGWindowLayer as String] as? Int) ?? 0
    let nameField = w[kCGWindowName as String]
    let title: String
    if let s = nameField as? String {
        title = s.isEmpty ? "<empty>" : "\"\(s)\""
    } else {
        title = "<missing — Screen Recording permission?>"
    }
    print("pid=\(pid)  owner=\"\(owner)\"  layer=\(layer)  title=\(title)")
}
if !any {
    print("No Zoom-owned windows on screen.")
}
SWIFT
