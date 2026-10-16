using System;
using System.IO;
using System.Net;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace EarsMixer
{
    internal sealed class UpdateRelease
    {
        internal string Version;
        internal string DownloadUrl;
        internal string ReleaseUrl;
    }

    internal static class ReleaseChecker
    {
        internal const string RepositoryUrl = "https://github.com/joeclack/EarsMixer";
        internal const string LatestReleaseApi = "https://api.github.com/repos/joeclack/EarsMixer/releases/latest";

        internal static async Task<UpdateRelease> CheckAsync(string installedVersion, CancellationToken cancellation)
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            using (var client = new ReleaseWebClient())
            using (cancellation.Register(client.CancelAsync))
            {
                client.Headers[HttpRequestHeader.UserAgent] = "EarsMixer/" + installedVersion;
                client.Headers[HttpRequestHeader.Accept] = "application/vnd.github+json";
                client.Headers["X-GitHub-Api-Version"] = "2022-11-28";
                cancellation.ThrowIfCancellationRequested();
                string json = await client.DownloadStringTaskAsync(LatestReleaseApi);
                cancellation.ThrowIfCancellationRequested();
                return FindUpdate(json, installedVersion);
            }
        }

        internal static UpdateRelease FindUpdate(string json, string installedVersion)
        {
            Version installed;
            if (!TryVersion(installedVersion, out installed))
                throw new InvalidDataException("The installed Windows product version is invalid.");
            var serializer = new JavaScriptSerializer { MaxJsonLength = 1024 * 1024 };
            var release = serializer.Deserialize<GitHubRelease>(json);
            if (release == null) throw new InvalidDataException("GitHub returned an empty release.");
            if (release.draft || release.prerelease) return null;
            string tag = release.tag_name ?? "";
            string versionText = tag.StartsWith("v", StringComparison.Ordinal) ? tag.Substring(1) : tag;
            Version latest;
            if (!TryVersion(versionText, out latest))
                throw new InvalidDataException("GitHub returned an unrecognised release version.");
            if (latest.CompareTo(installed) <= 0) return null;

            string filename = "EarsMixer-" + versionText + "-windows-x64-setup.exe";
            string downloadUrl = RepositoryUrl + "/releases/download/" + tag + "/" + filename;
            foreach (var asset in release.assets ?? new GitHubAsset[0])
            {
                if (asset != null && asset.name == filename && asset.state == "uploaded" && asset.size > 0 &&
                    String.Equals(asset.browser_download_url, downloadUrl, StringComparison.Ordinal))
                    return new UpdateRelease {
                        Version = versionText, DownloadUrl = downloadUrl,
                        ReleaseUrl = RepositoryUrl + "/releases/tag/" + tag
                    };
            }
            throw new InvalidDataException("The newer release does not have a Windows installer available yet. Please try again later.");
        }

        private static bool TryVersion(string text, out Version version)
        {
            version = null;
            return text != null && Regex.IsMatch(text, @"\A(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\z") &&
                Version.TryParse(text, out version);
        }

        // Public properties let JavaScriptSerializer read GitHub's response fields.
        internal sealed class GitHubRelease
        {
            public string tag_name { get; set; }
            public bool draft { get; set; }
            public bool prerelease { get; set; }
            public GitHubAsset[] assets { get; set; }
        }

        internal sealed class GitHubAsset
        {
            public string name { get; set; }
            public string state { get; set; }
            public long size { get; set; }
            public string browser_download_url { get; set; }
        }

        private sealed class ReleaseWebClient : WebClient
        {
            protected override WebRequest GetWebRequest(Uri address)
            {
                var request = (HttpWebRequest)base.GetWebRequest(address);
                request.Timeout = 15000;
                request.ReadWriteTimeout = 15000;
                request.AllowAutoRedirect = false;
                return request;
            }
        }
    }
}
