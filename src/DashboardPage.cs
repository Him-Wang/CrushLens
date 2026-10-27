using System;
using System.Drawing;
using System.Windows.Forms;

namespace CrushLens
{
    public class DashboardPage : UserControl
    {
        public event EventHandler NewAnalysisRequested;
        public event EventHandler ArchiveRequested;

        private readonly Label _title;
        private readonly Label _subtitle;
        private readonly Label _meta;
        private readonly PillButton _newButton;
        private readonly PillButton _archiveButton;
        private readonly DashboardCanvas _canvas;

        public DashboardPage()
        {
            BackColor = Palette.Bg;
            DoubleBuffered = true;

            _title = Make("数据看板", Theme.H1, Palette.Ink);
            _subtitle = Make("先看事实，再谈感觉。这里的数字全部在本地计算，不需要 API。", Theme.Small, Palette.Muted);
            _meta = Make("等待第一段对话…", Theme.Small, Palette.Muted);
            Controls.Add(_title);
            Controls.Add(_subtitle);
            Controls.Add(_meta);

            _newButton = new PillButton();
            _newButton.Text = "新建分析";
            _newButton.Kind = ButtonKind.Primary;
            _newButton.Click += delegate { if (NewAnalysisRequested != null) NewAnalysisRequested(this, EventArgs.Empty); };
            Controls.Add(_newButton);

            _archiveButton = new PillButton();
            _archiveButton.Text = "聊天档案";
            _archiveButton.Kind = ButtonKind.Secondary;
            _archiveButton.Click += delegate { if (ArchiveRequested != null) ArchiveRequested(this, EventArgs.Empty); };
            Controls.Add(_archiveButton);

            _canvas = new DashboardCanvas();
            Controls.Add(_canvas);

            Resize += PageResize;
            PageResize(null, EventArgs.Empty);
        }

        private Label Make(string text, Font font, Color color)
        {
            Label l = new Label();
            l.Text = text;
            l.Font = font;
            l.ForeColor = color;
            l.BackColor = Color.Transparent;
            l.AutoSize = false;
            return l;
        }

        private void PageResize(object sender, EventArgs e)
        {
            int pad = 26;
            _title.SetBounds(pad, 14, 300, 36);
            _subtitle.SetBounds(pad + 2, 54, Math.Max(300, Width - pad * 2 - 300), 22);
            _meta.SetBounds(pad + 2, 80, 520, 18);
            _newButton.SetBounds(Width - pad - 112, 26, 112, 36);
            _archiveButton.SetBounds(Width - pad - 112 - 108, 26, 100, 36);
            _canvas.SetBounds(pad, 112, Width - pad * 2, Math.Max(200, Height - 132));
        }

        public void SetSession(ChatSession session)
        {
            _canvas.SetSession(session);
            if (session == null)
            {
                _meta.Text = "等待第一段对话…";
            }
            else
            {
                string when = session.UpdatedAt > 0 ? Fmt.Ago(session.UpdatedAt) : "刚刚";
                _meta.Text = "最近一次分析 · " + session.DisplayTitle() + " · " + when + (session.IsDemo ? " · 示例数据" : "");
            }
        }
    }
}
