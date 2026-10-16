using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.ServiceProcess;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Xml;

namespace EarsMixer
{
    internal static class Program
    {
        internal const string ServiceName = "EarsMixer";
        internal static readonly string Home = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "EarsMixer");

        [STAThread]
        private static int Main(string[] args)
        {
            if (args.Length == 1 && args[0] == "--prepare-update")
            {
                // Setup runs this bundled copy from its temporary directory.
                // Never show a dialog: silent installers must receive a failure code.
                try
                {
                    if (!CloseTray()) return 1;
                    using (var service = new ServiceController(ServiceName))
                    {
                        try { var state = service.Status; }
                        catch (InvalidOperationException error)
                        {
                            var native = error.InnerException as System.ComponentModel.Win32Exception;
                            if (native != null && native.NativeErrorCode == 1060) return 0;
                            throw;
                        }
                    }
                    ControlService("stop");
                    return 0;
                }
                catch (Exception error) { Trace.WriteLine(error); return 1; }
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            if (args.Length == 1 && args[0] == "--exit")
            {
                return CloseTray() ? 0 : 1;
            }
            if (args.Length == 2 && args[0] == "--service-command")
            {
                try { ControlService(args[1]); return 0; }
                catch (Exception error) { ShowError(error); return 1; }
            }
            bool created;
            using (var mutex = new Mutex(true, @"Local\EarsMixerTray", out created))
            {
                if (!created) return 0;
                using (var tray = new TrayContext()) Application.Run(tray);
            }
            return 0;
        }

        private static bool CloseTray()
        {
            EventWaitHandle exit;
            if (EventWaitHandle.TryOpenExisting(@"Local\EarsMixerTrayExit", out exit))
                using (exit) exit.Set();
            Mutex existing;
            if (!Mutex.TryOpenExisting(@"Local\EarsMixerTray", out existing)) return true;
            using (existing)
            {
                try
                {
                    if (!existing.WaitOne(6000)) return false;
                    existing.ReleaseMutex();
                }
                catch (AbandonedMutexException) { existing.ReleaseMutex(); }
            }
            return true;
        }

        internal static void ControlService(string command)
        {
            if (command != "start" && command != "stop" && command != "restart")
                throw new ArgumentException("Unknown service command.");
            using (var service = new ServiceController(ServiceName))
            {
                var timeout = TimeSpan.FromSeconds(45);
                service.Refresh();
                if (service.Status == ServiceControllerStatus.StartPending)
                    service.WaitForStatus(ServiceControllerStatus.Running, timeout);
                if (service.Status == ServiceControllerStatus.StopPending)
                    service.WaitForStatus(ServiceControllerStatus.Stopped, timeout);
                service.Refresh();
                if ((command == "stop" || command == "restart") && service.Status != ServiceControllerStatus.Stopped)
                {
                    service.Stop();
                    service.WaitForStatus(ServiceControllerStatus.Stopped, timeout);
                }
                service.Refresh();
                if ((command == "start" || command == "restart") && service.Status != ServiceControllerStatus.Running)
                {
                    service.Start();
                    service.WaitForStatus(ServiceControllerStatus.Running, timeout);
                }
            }
        }

        internal static string LocalUrl()
        {
            // Match the installed service configuration, including custom paths/ports.
            string configDirectory = Path.Combine(Home, "config");
            string overridePort = Environment.GetEnvironmentVariable("OSC_WEBMIXER_WEB_PORT");
            string xmlPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "EarsMixerService.xml");
            if (File.Exists(xmlPath))
            {
                var xml = new XmlDocument();
                xml.XmlResolver = null;
                xml.Load(xmlPath);
                foreach (XmlElement item in xml.SelectNodes("/service/env"))
                {
                    string value = Environment.ExpandEnvironmentVariables(item.GetAttribute("value"));
                    if (item.GetAttribute("name") == "OSC_WEBMIXER_CONFIG_DIR") configDirectory = value;
                    if (item.GetAttribute("name") == "OSC_WEBMIXER_WEB_PORT") overridePort = value;
                }
            }
            int port = 80;
            string filename = Path.Combine(configDirectory, "global.json");
            if (File.Exists(filename))
            {
                var config = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(filename));
                object server;
                if (config.TryGetValue("server", out server))
                {
                    object savedPort;
                    if (((Dictionary<string, object>)server).TryGetValue("port", out savedPort)) port = Convert.ToInt32(savedPort);
                }
            }
            if (!String.IsNullOrEmpty(overridePort)) port = Convert.ToInt32(overridePort);
            if (port < 1 || port > 65535) throw new InvalidDataException("The configured web port is invalid.");
            return "http://127.0.0.1" + (port == 80 ? "" : ":" + port);
        }

        internal static void Open(string path) { Process.Start(new ProcessStartInfo(path) { UseShellExecute = true }); }
        internal static void ShowError(Exception error)
        {
            MessageBox.Show(error.GetBaseException().Message, "EarsMixer", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    internal sealed class TimedWebClient : WebClient
    {
        protected override WebRequest GetWebRequest(Uri address)
        {
            var request = base.GetWebRequest(address);
            request.Timeout = 4000;
            var http = request as HttpWebRequest;
            if (http != null) { http.ReadWriteTimeout = 4000; http.AllowAutoRedirect = false; http.Proxy = null; }
            return request;
        }
    }

    internal sealed class TrayContext : ApplicationContext
    {
        private readonly NotifyIcon icon;
        private readonly System.Windows.Forms.Timer timer;
        private readonly ToolStripMenuItem status, start, stop, restart, checkUpdates, downloadUpdate, releaseNotes;
        private readonly ConnectionWindow window;
        private readonly EventWaitHandle exit = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\EarsMixerTrayExit");
        private readonly CancellationTokenSource updateCancellation = new CancellationTokenSource();
        private DateTime nextUpdateCheck = DateTime.UtcNow.AddSeconds(10);
        private UpdateRelease availableUpdate;
        private string notifiedVersion;
        private bool controlling, checkingUpdates, exiting;

        internal TrayContext()
        {
            var menu = new ContextMenuStrip();
            menu.Items.Add(new ToolStripMenuItem("EarsMixer " + ProductInfo.Version) { Enabled = false });
            status = new ToolStripMenuItem("Checking service...") { Enabled = false };
            menu.Items.Add(status);
            menu.Items.Add("Show mixer QR code", null, (s, e) => ShowConnection());
            menu.Items.Add("Open mixer", null, (s, e) => OpenPage("/"));
            menu.Items.Add("Open admin dashboard", null, (s, e) => OpenPage("/admin"));
            menu.Items.Add(new ToolStripSeparator());
            start = new ToolStripMenuItem("Start service", null, async (s, e) => await Control("start"));
            stop = new ToolStripMenuItem("Stop service", null, async (s, e) => await Control("stop"));
            restart = new ToolStripMenuItem("Restart service", null, async (s, e) => await Control("restart"));
            menu.Items.AddRange(new ToolStripItem[] { start, stop, restart });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Open logs", null, (s, e) => OpenFolder("logs"));
            menu.Items.Add("Open settings and plugins", null, (s, e) => OpenFolder(""));
            menu.Items.Add(new ToolStripSeparator());
            checkUpdates = new ToolStripMenuItem("Check for updates...", null, async (s, e) => await CheckForUpdates(true));
            downloadUpdate = new ToolStripMenuItem("Download update...", null, (s, e) => OpenUpdate(false)) { Visible = false };
            releaseNotes = new ToolStripMenuItem("View release notes", null, (s, e) => OpenUpdate(true)) { Visible = false };
            menu.Items.AddRange(new ToolStripItem[] { checkUpdates, downloadUpdate, releaseNotes });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Exit tray (mixer keeps running)", null, (s, e) => ExitThread());
            string iconPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "favicon.ico");
            icon = new NotifyIcon {
                Icon = File.Exists(iconPath) ? new Icon(iconPath) : SystemIcons.Application,
                Text = "EarsMixer", ContextMenuStrip = menu, Visible = true
            };
            window = new ConnectionWindow();
            icon.DoubleClick += (s, e) => ShowConnection();
            icon.BalloonTipClicked += (s, e) => ShowUpdate();
            timer = new System.Windows.Forms.Timer { Interval = 2000 };
            timer.Tick += async (s, e) => {
                if (exit.WaitOne(0)) { ExitThread(); return; }
                RefreshStatus();
                if (DateTime.UtcNow >= nextUpdateCheck) await CheckForUpdates(false);
            };
            timer.Start();
            RefreshStatus();
        }

        private void ShowConnection() { window.Show(); window.Activate(); window.RefreshConnection(); }
        private void OpenPage(string suffix)
        {
            try { Program.Open(Program.LocalUrl() + suffix); } catch (Exception error) { Program.ShowError(error); }
        }
        private void OpenFolder(string suffix)
        {
            try { Program.Open(Path.Combine(Program.Home, suffix)); } catch (Exception error) { Program.ShowError(error); }
        }
        private async Task CheckForUpdates(bool manual)
        {
            if (checkingUpdates || exiting) return;
            checkingUpdates = true;
            nextUpdateCheck = DateTime.UtcNow.AddHours(6);
            checkUpdates.Enabled = false;
            checkUpdates.Text = "Checking for updates...";
            try
            {
                using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(updateCancellation.Token))
                {
                    timeout.CancelAfter(TimeSpan.FromSeconds(15));
                    availableUpdate = await ReleaseChecker.CheckAsync(ProductInfo.Version, timeout.Token);
                }
                if (exiting) return;
                downloadUpdate.Visible = releaseNotes.Visible = availableUpdate != null;
                if (availableUpdate == null)
                {
                    if (manual) MessageBox.Show("EarsMixer " + ProductInfo.Version + " is installed. No newer Windows update is available.",
                        "EarsMixer updates", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                downloadUpdate.Text = "Download EarsMixer " + availableUpdate.Version + "...";
                if (manual) ShowUpdate();
                else if (notifiedVersion != availableUpdate.Version)
                {
                    notifiedVersion = availableUpdate.Version;
                    icon.ShowBalloonTip(8000, "EarsMixer update available",
                        "Version " + availableUpdate.Version + " is available. Click to view the download.", ToolTipIcon.Info);
                }
            }
            catch (Exception error)
            {
                // An offline mixer network must never interrupt the service or show background errors.
                if (manual && !exiting) MessageBox.Show("Could not check GitHub for updates. Check your internet connection and try again later.\n\n" +
                    error.GetBaseException().Message, "EarsMixer updates", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            finally
            {
                checkingUpdates = false;
                if (!exiting) { checkUpdates.Enabled = true; checkUpdates.Text = "Check for updates..."; }
            }
        }
        private void ShowUpdate()
        {
            if (availableUpdate == null || exiting) return;
            if (MessageBox.Show("EarsMixer " + availableUpdate.Version + " is available. You have version " + ProductInfo.Version +
                ".\n\nOpen the installer download in your browser? Run it when you are ready to update.",
                "EarsMixer update available", MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
                OpenUpdate(false);
        }
        private void OpenUpdate(bool notes)
        {
            if (availableUpdate == null || exiting) return;
            try { Program.Open(notes ? availableUpdate.ReleaseUrl : availableUpdate.DownloadUrl); }
            catch (Exception error) { Program.ShowError(error); }
        }
        private void RefreshStatus()
        {
            bool installed = false, running = false, stopped = false;
            string text;
            try
            {
                using (var service = new ServiceController(Program.ServiceName))
                {
                    var state = service.Status;
                    installed = true;
                    running = state == ServiceControllerStatus.Running;
                    stopped = state == ServiceControllerStatus.Stopped;
                    text = running ? "Service running" : stopped ? "Service stopped" : "Service: " + state;
                }
            }
            catch { text = "Service unavailable - install or check Windows Services"; }
            status.Text = controlling ? "Changing service status..." : text;
            icon.Text = "EarsMixer - " + (running ? "running" : stopped ? "stopped" : "unavailable");
            start.Enabled = !controlling && installed && stopped;
            stop.Enabled = restart.Enabled = !controlling && installed && running;
            window.SetServiceState(status.Text, running);
        }
        private async Task Control(string command)
        {
            controlling = true;
            RefreshStatus();
            try
            {
                // UAC applies only to service changes, never to the tray or QR window.
                using (var process = Process.Start(new ProcessStartInfo(Application.ExecutablePath,
                    "--service-command " + command) { UseShellExecute = true, Verb = "runas" }))
                    await Task.Run(() => process.WaitForExit());
            }
            catch (System.ComponentModel.Win32Exception error)
            {
                if (error.NativeErrorCode != 1223) Program.ShowError(error); // User cancelled UAC.
            }
            catch (Exception error) { Program.ShowError(error); }
            finally { controlling = false; RefreshStatus(); }
        }
        protected override void ExitThreadCore()
        {
            exiting = true;
            updateCancellation.Cancel(); updateCancellation.Dispose();
            timer.Stop(); timer.Dispose();
            exit.Dispose();
            window.Dispose();
            icon.Visible = false; icon.Icon.Dispose(); icon.ContextMenuStrip.Dispose(); icon.Dispose();
            base.ExitThreadCore();
        }
    }

    internal sealed class ConnectionWindow : Form
    {
        private readonly PictureBox qr;
        private readonly Label state, hint;
        private readonly TextBox url;
        private readonly Button copy;
        private readonly System.Windows.Forms.Timer refresh;
        private bool fetching, running;
        private int generation;

        internal ConnectionWindow()
        {
            Text = "EarsMixer - connect your device";
            ClientSize = new Size(420, 580);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi;
            Font = new Font("Segoe UI", 10);
            BackColor = Color.FromArgb(245, 247, 250);
            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(20), ColumnCount = 1, RowCount = 7 };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            foreach (int height in new int[] { 34, 26, 320, 44, 34, 38, 30 }) layout.RowStyles.Add(new RowStyle(SizeType.Absolute, height));
            layout.Controls.Add(new Label { Text = "Connect to EarsMixer", Font = new Font("Segoe UI", 17, FontStyle.Bold), Dock = DockStyle.Fill });
            state = new Label { Text = "Checking service...", Dock = DockStyle.Fill };
            layout.Controls.Add(state);
            qr = new PictureBox { Dock = DockStyle.Fill, SizeMode = PictureBoxSizeMode.Zoom, BackColor = Color.White };
            layout.Controls.Add(qr);
            hint = new Label { Text = "Scan with a phone or tablet on the same network.", Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter };
            layout.Controls.Add(hint);
            url = new TextBox { ReadOnly = true, Dock = DockStyle.Fill, TextAlign = HorizontalAlignment.Center };
            layout.Controls.Add(url);
            var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.LeftToRight };
            copy = new Button { Text = "Copy link", AutoSize = true, Enabled = false };
            copy.Click += (s, e) => { try { Clipboard.SetText(url.Text); } catch (Exception error) { Program.ShowError(error); } };
            var admin = new Button { Text = "Admin dashboard", AutoSize = true };
            admin.Click += (s, e) => { try { Program.Open(Program.LocalUrl() + "/admin"); } catch (Exception error) { Program.ShowError(error); } };
            buttons.Controls.Add(copy); buttons.Controls.Add(admin);
            layout.Controls.Add(buttons);
            layout.Controls.Add(new Label { Text = "Service controls: right-click the EarsMixer tray icon.", Dock = DockStyle.Fill, ForeColor = Color.DimGray });
            Controls.Add(layout);
            refresh = new System.Windows.Forms.Timer { Interval = 5000 };
            refresh.Tick += (s, e) => RefreshConnection();
            refresh.Start();
            FormClosing += (s, e) => { if (e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); } };
        }
        internal void SetServiceState(string text, bool isRunning)
        {
            state.Text = text;
            if (running != isRunning) generation++;
            running = isRunning;
            if (!running) ClearQr("Start the service from the tray icon to connect.");
        }
        private void ClearQr(string message)
        {
            var old = qr.Image; qr.Image = null; if (old != null) old.Dispose();
            url.Text = ""; copy.Enabled = false; hint.Text = message;
        }
        internal async void RefreshConnection()
        {
            if (!Visible || fetching || !running) return;
            fetching = true;
            int requestGeneration = generation;
            try
            {
                string json;
                using (var client = new TimedWebClient()) json = await client.DownloadStringTaskAsync(Program.LocalUrl() + "/api/connection");
                if (IsDisposed || !running || requestGeneration != generation) return;
                var data = new JavaScriptSerializer().Deserialize<Dictionary<string, string>>(json);
                Uri link;
                if (!Uri.TryCreate(data["url"], UriKind.Absolute, out link) || (link.Scheme != "http" && link.Scheme != "https"))
                    throw new InvalidDataException("The mixer returned an invalid connection URL.");
                byte[] bytes = Convert.FromBase64String(data["qr"].Substring(data["qr"].IndexOf(',') + 1));
                using (var stream = new MemoryStream(bytes))
                using (var image = Image.FromStream(stream))
                {
                    var old = qr.Image; qr.Image = new Bitmap(image); if (old != null) old.Dispose();
                }
                url.Text = link.AbsoluteUri; copy.Enabled = true;
                hint.Text = link.IsLoopback ? "No network address yet. Connect this PC to the mixer network." : "Scan with a phone or tablet on the same network.";
            }
            catch (Exception)
            {
                if (!IsDisposed && requestGeneration == generation) ClearQr("Waiting for the web server. Check the logs if this continues.");
            }
            finally { fetching = false; }
        }
        protected override void Dispose(bool disposing)
        {
            if (disposing) { refresh.Dispose(); if (qr.Image != null) qr.Image.Dispose(); }
            base.Dispose(disposing);
        }
    }
}
