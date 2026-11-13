// Update check against GitHub releases. Notify only: the app opens the
// download in the browser and never installs anything itself.

import Foundation

struct UpdateRelease: Equatable {
    let version: String
    let downloadURL: URL
    let releaseURL: URL
}

enum ReleaseChecker {
    static let repository = "https://github.com/joeclack/EarsMixer"
    static let latestAPI = URL(string: "https://api.github.com/repos/joeclack/EarsMixer/releases/latest")!

    static func check(installed: String) async throws -> UpdateRelease? {
        var request = URLRequest(url: latestAPI, timeoutInterval: 15)
        request.setValue("EarsMixer/\(installed) (macOS)", forHTTPHeaderField: "User-Agent")
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        let (data, _) = try await URLSession.shared.data(for: request)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let tag = json["tag_name"] as? String else { return nil }
        if json["draft"] as? Bool == true || json["prerelease"] as? Bool == true { return nil }
        let version = tag.hasPrefix("v") ? String(tag.dropFirst()) : tag
        guard isNewer(version, than: installed) else { return nil }
        // Only offer releases that include a macOS download.
        let filename = "EarsMixer-\(version)-macos.dmg"
        let assets = json["assets"] as? [[String: Any]] ?? []
        guard let asset = assets.first(where: { $0["name"] as? String == filename && $0["state"] as? String == "uploaded" }),
              let link = asset["browser_download_url"] as? String, let download = URL(string: link),
              download.host == "github.com" else { return nil }
        return UpdateRelease(version: version, downloadURL: download,
                             releaseURL: URL(string: "\(repository)/releases/tag/\(tag)")!)
    }

    static func isNewer(_ candidate: String, than installed: String) -> Bool {
        let a = candidate.split(separator: ".").compactMap { Int($0) }
        let b = installed.split(separator: ".").compactMap { Int($0) }
        guard a.count == 3, b.count == 3 else { return false }
        return b.lexicographicallyPrecedes(a)
    }
}
