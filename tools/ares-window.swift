// ares-window.swift — list ares windows through CoreGraphics (read-only).
//
// Used by tools/capture-ares.sh to find the window to screencapture -l.
// This only QUERIES the window server: it does not post keyboard or mouse
// events, and it never activates or focuses anything.  The window owner PID
// is printed so the script can kill exactly the instance it launched and
// never touch a human's emulator.
//
// Output, one line per ares window, '|' separated so an empty window name
// keeps its field (tab is IFS whitespace and would collapse the empty field):
//   <pid> <window-id> <name> <x> <y> <w> <h>

import CoreGraphics
import Foundation

let opts = CGWindowListOption(arrayLiteral: .optionAll)
let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as! [[String: Any]]
for w in list {
  let owner = (w[kCGWindowOwnerName as String] as? String ?? "").lowercased()
  guard owner.contains("ares") else { continue }
  let pid = w[kCGWindowOwnerPID as String] as? Int ?? -1
  let id = w[kCGWindowNumber as String] as? Int ?? -1
  let name = w[kCGWindowName as String] as? String ?? ""
  let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
  let x = b["X"] as? Int ?? -1
  let y = b["Y"] as? Int ?? -1
  let ww = b["Width"] as? Int ?? -1
  let wh = b["Height"] as? Int ?? -1
  print("\(pid)|\(id)|\(name)|\(x)|\(y)|\(ww)|\(wh)")
}
