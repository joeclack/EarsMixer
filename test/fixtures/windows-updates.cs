using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Web.Script.Serialization;
using EarsMixer;

internal static class UpdateTests
{
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

    private static Dictionary<string, object> Release(string tag)
    {
        string version = tag.StartsWith("v") ? tag.Substring(1) : tag;
        string filename = "EarsMixer-" + version + "-windows-x64-setup.exe";
        return new Dictionary<string, object> {
            { "tag_name", tag }, { "draft", false }, { "prerelease", false },
            { "assets", new object[] { new Dictionary<string, object> {
                { "name", filename }, { "state", "uploaded" }, { "size", 123456 },
                { "browser_download_url", ReleaseChecker.RepositoryUrl + "/releases/download/" + tag + "/" + filename }
            } } }
        };
    }

    private static Dictionary<string, object> Asset(Dictionary<string, object> release)
    {
        return (Dictionary<string, object>)((object[])release["assets"])[0];
    }

    private static UpdateRelease Check(Dictionary<string, object> release, string current)
    {
        return ReleaseChecker.FindUpdate(Json.Serialize(release), current);
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
    }

    private static void Invalid(Action action)
    {
        try { action(); }
        catch (InvalidDataException) { return; }
        throw new Exception("Invalid release was accepted.");
    }

    private static int Main(string[] args)
    {
        try
        {
            if (args.Length > 0 && args[0] == "--live")
            {
                using (var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15)))
                {
                    var release = ReleaseChecker.CheckAsync(args.Length > 1 ? args[1] : ProductInfo.Version,
                        timeout.Token).GetAwaiter().GetResult();
                    Console.WriteLine(release == null ? "No newer Windows release." : "Update: " + release.Version + " " + release.DownloadUrl);
                }
                return 0;
            }

            var next = Check(Release("v1.2.0"), "1.1.0");
            Assert(next.Version == "1.2.0", "Newer version was missed.");
            Assert(next.DownloadUrl == ReleaseChecker.RepositoryUrl + "/releases/download/v1.2.0/EarsMixer-1.2.0-windows-x64-setup.exe", "Wrong download URL.");
            Assert(next.ReleaseUrl == ReleaseChecker.RepositoryUrl + "/releases/tag/v1.2.0", "Wrong release notes URL.");
            Assert(Check(Release("v1.10.0"), "1.9.0") != null, "Versions were compared alphabetically.");
            Assert(Check(Release("v1.2.10"), "1.2.9") != null, "Patch versions were compared alphabetically.");
            Assert(Check(Release("2.0.0"), "1.9.0") != null, "Unprefixed release tags failed.");
            Assert(Check(Release("v1.1.0"), "1.1.0") == null, "Same-version rebuild was offered as an update.");
            Assert(Check(Release("v1.0.0"), "1.1.0") == null, "A downgrade was offered.");
            var draft = Release("v2.0.0"); draft["draft"] = true;
            Assert(Check(draft, "1.1.0") == null, "Draft release was offered.");
            var preview = Release("v2.0.0-beta.1"); preview["prerelease"] = true;
            Assert(Check(preview, "1.1.0") == null, "Prerelease was offered.");
            foreach (string tag in new[] { "v2.0.0-beta.1", "main", "v2.0", "v02.0.0", "v2.0.0.1", "v2.0.0/evil", "" })
                Invalid(() => Check(Release(tag), "1.1.0"));
            Invalid(() => ReleaseChecker.FindUpdate("null", "1.1.0"));
            Invalid(() => Check(Release("v2.0.0"), "invalid"));

            var missing = Release("v2.0.0"); missing["assets"] = null;
            Invalid(() => Check(missing, "1.1.0"));
            foreach (var mutation in new[] {
                new KeyValuePair<string, object>("name", "Source code.zip"),
                new KeyValuePair<string, object>("state", "starter"),
                new KeyValuePair<string, object>("size", 0)
            })
            {
                var release = Release("v2.0.0"); Asset(release)[mutation.Key] = mutation.Value;
                Invalid(() => Check(release, "1.1.0"));
            }
            string canonical = Asset(Release("v2.0.0"))["browser_download_url"].ToString();
            foreach (string url in new[] { "https://example.com/setup.exe", canonical.Replace("https:", "http:"),
                canonical.Replace("github.com/", "github.com.example.com/"), canonical.Replace("joeclack/", "someoneelse/"),
                canonical + "?redirect=evil", "file:///C:/setup.exe", "javascript:alert(1)" })
            {
                var release = Release("v2.0.0"); Asset(release)["browser_download_url"] = url;
                Invalid(() => Check(release, "1.1.0"));
            }
            var multiple = Release("v2.0.0");
            multiple["assets"] = new object[] { null, new Dictionary<string, object> { { "name", "plugins.zip" } }, Asset(multiple) };
            Assert(Check(multiple, "1.1.0") != null, "The Windows installer was missed among other assets.");

            string expected = ProductInfo.Version + ".0";
            Assert(Assembly.GetExecutingAssembly().GetName().Version.ToString() == expected, "Assembly version differs from installer.");
            Assert(FileVersionInfo.GetVersionInfo(Assembly.GetExecutingAssembly().Location).FileVersion == expected, "File version differs from installer.");
            using (var cancelled = new CancellationTokenSource())
            {
                cancelled.Cancel();
                try { ReleaseChecker.CheckAsync(ProductInfo.Version, cancelled.Token).GetAwaiter().GetResult(); throw new Exception("Cancellation was ignored."); }
                catch (OperationCanceledException) { }
            }
            Console.WriteLine("Windows update checks passed: numeric versions, release channels, trusted installer assets, product metadata and cancellation.");
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
}
