using System;
using System.Drawing;
using System.Windows.Forms;

namespace CrushLens
{
    public class MainForm : Form
    {
        private AppSettings _settings;
        private readonly Sidebar _sidebar;
        private readonly WindowBar _windowBar;
        private readonly Panel _rightHost;
        private readonly Panel _pageHost;
        private readonly AnalysisPage _analysis;
        private readonly DashboardPage _dashboard;
        private readonly ArchivePage _archive;
        private readonly GuidePage _guide;
        private readonly Toast _toast;
        private readonly bool _demo;
        private readonly bool _openSettingsOnShow;

        public MainForm(AppSettings settings, bool demo, bool openSettingsOnShow)
        {
            _settings = settings;
            _demo = demo;
            _openSettingsOnShow = openSettingsOnShow;

            Text = "CrushLens 心动镜 · 本地好感度分析";
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Palette.Bg;
            MinimumSize = new Size(1080, 700);
            Rectangle wa = Screen.PrimaryScreen.WorkingArea;
            Width = Math.Max(1080, Math.Min(1280, wa.Width - 40));
            Height = Math.Max(700, Math.Min(820, wa.Height - 24));
            DoubleBuffered = true;
            KeyPreview = true;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
            catch { }

            _rightHost = new Panel();
            _rightHost.BackColor = Palette.Bg;
            _rightHost.Dock = DockStyle.Fill;

            _sidebar = new Sidebar();
            _sidebar.Dock = DockStyle.Left;
            _sidebar.SetApiStatus(IsReady(settings));

            _pageHost = new Panel();
            _pageHost.BackColor = Palette.Bg;
            _pageHost.Dock = DockStyle.Fill;

            _windowBar = new WindowBar(this);
            _windowBar.Dock = DockStyle.Top;

            _analysis = new AnalysisPage();
            _analysis.Dock = DockStyle.Fill;
            _analysis.Settings = settings;
            _analysis.OpenSettings = delegate { return OpenSettings(); };
            _analysis.Toast = ShowToast;
            _analysis.DataChanged += delegate
            {
                _dashboard.SetSession(_analysis.CurrentSession);
            };

            _dashboard = new DashboardPage();
            _dashboard.Dock = DockStyle.Fill;
            _dashboard.NewAnalysisRequested += delegate
            {
                ShowPage(0);
                _analysis.NewAnalysis();
            };
            _dashboard.ArchiveRequested += delegate { ShowPage(2); _archive.RefreshList(); };

            _archive = new ArchivePage();
            _archive.Dock = DockStyle.Fill;
            _archive.Toast = ShowToast;
            _archive.OpenSession += delegate(ChatSession s)
            {
                _analysis.LoadSession(s);
                _dashboard.SetSession(s);
                ShowPage(0);
                ShowToast("已打开本地档案。");
            };

            _guide = new GuidePage();
            _guide.Dock = DockStyle.Fill;
            _guide.SettingsRequested = delegate { OpenSettings(); };
            _guide.OpenDataDir = OpenDataFolder;

            _pageHost.Controls.Add(_analysis);
            _pageHost.Controls.Add(_dashboard);
            _pageHost.Controls.Add(_archive);
            _pageHost.Controls.Add(_guide);

            _rightHost.Controls.Add(_pageHost);
            _rightHost.Controls.Add(_windowBar);
            Controls.Add(_rightHost);
            Controls.Add(_sidebar);

            _sidebar.NavChanged += delegate { ShowPage(_sidebar.Active); };
            _sidebar.SettingsClicked += delegate { OpenSettings(); };

            _toast = new Toast();
            Controls.Add(_toast);
            _toast.BringToFront();

            Resize += MainResize;
            Shown += MainShown;
            FormClosing += MainClosing;

            ShowPage(0);
            MainResize(null, EventArgs.Empty);
        }

        private bool IsReady(AppSettings s)
        {
            if (s == null) return false;
            return s.HasKey || TextKit.IsLocalEndpoint(s.BaseUrl);
        }

        private void MainResize(object sender, EventArgs e)
        {
            if (WindowState == FormWindowState.Maximized)
            {
                MaximizedBounds = Screen.FromControl(this).WorkingArea;
            }
            if (_toast != null && _toast.Visible)
                _toast.Location = new Point((ClientSize.Width - _toast.Width) / 2, ClientSize.Height - 74);
        }

        private void MainShown(object sender, EventArgs e)
        {
            Native.EnableRoundedCorners(Handle);
            if (_demo)
            {
                ChatSession demo = DemoData.CreateSession();
                _analysis.LoadSession(demo);
                _dashboard.SetSession(demo);
                ShowPage(0);
                ShowToast("已载入示例报告 · 本次不会调用 API，也不会保存档案。");
            }
            if (_openSettingsOnShow)
            {
                BeginInvoke(new Action(delegate { OpenSettings(); }));
            }
        }

        private void MainClosing(object sender, FormClosingEventArgs e)
        {
            if (_analysis != null) _analysis.CancelWork();
        }

        private void ShowPage(int index)
        {
            if (index < 0 || index > 3) return;
            _analysis.Visible = index == 0;
            _dashboard.Visible = index == 1;
            _archive.Visible = index == 2;
            _guide.Visible = index == 3;
            _sidebar.SetActive(index);
            string title = index == 0 ? "分析台" : (index == 1 ? "数据看板" : (index == 2 ? "聊天档案" : "使用指南"));
            _windowBar.SetPageName(title);
            if (index == 1)
            {
                _dashboard.SetSession(_analysis.CurrentSession);
            }
            else if (index == 2)
            {
                _archive.RefreshList();
            }
            _toast.BringToFront();
        }

        public bool OpenSettings()
        {
            using (SettingsForm dlg = new SettingsForm(_settings, this))
            {
                if (dlg.ShowDialog(this) != DialogResult.OK) return false;
                _settings = dlg.Result;
                _analysis.ApplySettings(_settings);
                _sidebar.SetApiStatus(IsReady(_settings));
                ShowToast("设置已保存。下一次分析会使用新的模型。");
                return true;
            }
        }

        public void ShowToast(string message)
        {
            if (_toast == null) return;
            _toast.ShowMessage(message);
            _toast.Location = new Point((ClientSize.Width - _toast.Width) / 2, ClientSize.Height - 74);
            _toast.BringToFront();
        }

        private void OpenDataFolder()
        {
            try
            {
                AppPaths.EnsureData();
                System.Diagnostics.Process.Start("explorer.exe", "\"" + AppPaths.DataDir + "\"");
            }
            catch (Exception ex)
            {
                UiDialog.Error(this, "无法打开目录", ex.Message);
            }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            using (Pen p = new Pen(Palette.LineStrong)) e.Graphics.DrawRectangle(p, 0, 0, Width - 1, Height - 1);
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ClassStyle = cp.ClassStyle | 0x20000; // CS_DROPSHADOW
                return cp;
            }
        }
    }
}
