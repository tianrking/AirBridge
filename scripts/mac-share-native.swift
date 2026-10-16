// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
// Acceptance helper: Apple NSSharingService owns the actual AirDrop protocol/UI.
// There is no custom HTTPS upload or copied transport in this helper.
import AppKit
import Foundation
import Darwin

final class ResultObserver: NSObject, NSSharingServiceDelegate {
    func sharingService(_ sharingService: NSSharingService, didShareItems items: [Any]) {
        print("native_sharing_service_did_share")
        fflush(stdout)
        exit(0)
    }
    func sharingService(_ sharingService: NSSharingService, didFailToShareItems items: [Any], error: Error) {
        print("native_sharing_service_failed: \(error)")
        fflush(stdout)
        exit(1)
    }
}
guard CommandLine.arguments.count == 2 else {
    fputs("Usage: swift mac-share-native.swift <existing file>\n", stderr)
    exit(2)
}
let url = URL(fileURLWithPath: CommandLine.arguments[1])
var isDirectory: ObjCBool = false
guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), !isDirectory.boolValue else {
    fputs("An existing regular file is required\n", stderr)
    exit(2)
}
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let observer = ResultObserver()
guard let service = NSSharingService(named: .sendViaAirDrop), service.canPerform(withItems: [url]) else {
    fputs("Apple AirDrop sharing service unavailable\n", stderr)
    exit(2)
}
service.delegate = observer
service.perform(withItems: [url])
app.activate(ignoringOtherApps: true)
print("native_sharing_picker_open: \(url.lastPathComponent)")
fflush(stdout)
Timer.scheduledTimer(withTimeInterval: 180, repeats: false) { _ in
    print("native_sharing_picker_timeout")
    fflush(stdout)
    exit(3)
}
RunLoop.main.run()
