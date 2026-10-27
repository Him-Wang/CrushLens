using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Windows.Forms;

namespace CrushLens
{
    public class ArchivePage : UserControl
    {
        public event Action<ChatSession> OpenSession;
        public Action<string> Toast;

        private readonly Label _title;
        private readonly Label _subtitle;
        private readonly Label _count;
        private readonly FlowLayoutPanel _list;
        private readonly PillButton _openFolder;
        private readonly PillButton _refresh;
        private readonly EmptyArchive _empty;

        public ArchivePage()
        {
            BackColor = Palette.Bg;
            DoubleBuffered = true;

            _title = Make("聊天档案", Theme.H1, Palette.Ink);
            _subtitle = Make("保存在本机的最新报告。可以随时打开、导出，或彻底删除。", Theme.Small, Palette.Muted);
            _count = Make("", Theme.Small, Palette.Muted);
            Controls.Add(_title);
            Controls.Add(_subtitle);
            Controls.Add(_count);

            _refresh = new PillButton();
            _refresh.Text = "刷新";
            _refresh.Kind = ButtonKind.Secondary;
            _refresh.Click += delegate { RefreshList(); };
            Controls.Add(_refresh);

            _openFolder = new PillButton();
            _openFolder.Text = "打开数据目录";
            _openFolder.Kind = ButtonKind.Ghost;
            _openFolder.Click += delegate { OpenFolder(); };
            Controls.Add(_openFolder);

            _list = new FlowLayoutPanel();
            _list.BackColor = Palette.Bg;
            _list.FlowDirection = FlowDirection.TopDown;
            _list.WrapContents = false;
            _list.AutoScroll = true;
            _list.Padding = new Padding(0, 6, 8, 20);
            _list.Resize += delegate { LayoutCards(); };
            Controls.Add(_list);

            _empty = new EmptyArchive();
            _empty.Visible = false;
            Controls.Add(_empty);

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
            _count.SetBounds(pad + 2, 80, 400, 18);
            _openFolder.SetBounds(Width - pad - 132, 26, 132, 36);
            _refresh.SetBounds(Width - pad - 132 - 80, 26, 72, 36);
            _list.SetBounds(pad, 112, Width - pad * 2, Math.Max(200, Height - 132));
            _empty.SetBounds(pad, 112, Width - pad * 2, Math.Max(200, Height - 132));
            LayoutCards();
        }

        private void LayoutCards()
        {
            int w = _list.ClientSize.Width - 24;
            if (w < 200) return;
            for (int i = 0; i < _list.Controls.Count; i++)
            {
                ArchiveCard c = _list.Controls[i] as ArchiveCard;
                if (c != null) c.Width = w;
            }
        }

        public void RefreshList()
        {
            List<ChatSession> sessions = Storage.LoadSessions();
            _list.SuspendLayout();
            _list.Controls.Clear();
            for (int i = 0; i < sessions.Count; i++)
            {
                ChatSession s = sessions[i];
                if (s.Report == null) continue;
                ArchiveCard card = new ArchiveCard(s);
                card.Open += delegate(object sender, EventArgs e)
                {
                    ArchiveCard c = (ArchiveCard)sender;
                    if (OpenSession != null) OpenSession(c.Session);
                };
                card.Delete += delegate(object sender, EventArgs e)
                {
                    ArchiveCard c = (ArchiveCard)sender;
                    if (!UiDialog.Confirm(this, "删除这份档案？", "《" + c.Session.DisplayTitle() + "》以及其中的分析结果会从本机删除，无法撤销。")) return;
                    try
                    {
                        Storage.DeleteSession(c.Session.Id);
                        RefreshList();
                        if (Toast != null) Toast("档案已删除。");
                    }
                    catch (Exception ex)
                    {
                        Log.Error("删除档案失败", ex);
                        UiDialog.Error(this, "删除失败", ex.Message);
                    }
                };
                _list.Controls.Add(card);
            }
            _list.ResumeLayout();
            LayoutCards();
            int count = 0;
            for (int i = 0; i < _list.Controls.Count; i++) if (_list.Controls[i] is ArchiveCard) count++;
            _count.Text = count == 0 ? "还没有保存的档案" : "共 " + count + " 份本地报告 · 数据在程序旁的 CrushLens_Data";
            _empty.Visible = count == 0;
            _list.Visible = count > 0;
        }

        public void RefreshDataDir()
        {
            try { AppPaths.EnsureData(); } catch { }
        }

        private void OpenFolder()
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
    }

    public class ArchiveCard : Control
    {
        public event EventHandler Open;
        public event EventHandler Delete;
        public ChatSession Session;

        private bool _hover;
        private bool _deleteHover;
        private bool _openHover;

        public ArchiveCard(ChatSession session)
        {
            Session = session;
            Height = 104;
            Width = 700;
            BackColor = Palette.Bg;
            Cursor = Cursors.Hand;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                     ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
        }

        private Rectangle DeleteRect
        {
            get { return new Rectangle(Width - 54, 70, 32, 22); }
        }

        private Rectangle OpenRect
        {
            get { return new Rectangle(Width - 130, 32, 104, 26); }
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            _hover = true;
            bool dh = DeleteRect.Contains(e.Location);
            bool oh = OpenRect.Contains(e.Location);
            if (dh != _deleteHover || oh != _openHover)
            {
                _deleteHover = dh;
                _openHover = oh;
                Cursor = dh || oh ? Cursors.Hand : Cursors.Hand;
                Invalidate();
            }
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            base.OnMouseLeave(e);
            _hover = false;
            _deleteHover = false;
            _openHover = false;
            Invalidate();
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            if (e.Button != MouseButtons.Left) return;
            if (DeleteRect.Contains(e.Location))
            {
                if (Delete != null) Delete(this, EventArgs.Empty);
            }
            else
            {
                if (Open != null) Open(this, EventArgs.Empty);
            }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.Clear(Palette.Bg);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            RectangleF card = new RectangleF(0, 0, Width, Height - 8);
            Ui.Card(g, card, 13f, _hover ? Color.FromArgb(255, 252, 251) : Palette.Card, _hover ? Color.FromArgb(232, 210, 210) : Palette.Line);
            int score = Session.Report != null ? Session.Report.Score : 0;
            Rectangle badge = new Rectangle(18, 20, 58, 58);
            Ui.FillRound(g, badge, 12f, Ui.ScoreSoft(score));
            TextRenderer.DrawText(g, score.ToString(), new Font(Theme.FontFamily, 18f, FontStyle.Bold),
                new Rectangle(badge.X, badge.Y + 4, badge.Width, 34), Ui.ScoreColor(score), Ui.Center);
            TextRenderer.DrawText(g, "好感度", Theme.Tiny, new Rectangle(badge.X, badge.Bottom - 18, badge.Width, 12), Ui.ScoreColor(score), Ui.Center);

            TextRenderer.DrawText(g, Session.DisplayTitle(), Theme.MediumBold,
                new Rectangle(92, 14, Width - 230, 24), Palette.Ink,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);
            Rectangle stage = new Rectangle(92, 42, 56, 19);
            Ui.Pill(g, stage, Session.Stage, Theme.Tiny, Palette.BgDeep, Palette.Muted);
            string date = Session.UpdatedAt > 0 ? Fmt.Ago(Session.UpdatedAt) : Fmt.ShortDate(Session.CreatedAt);
            TextRenderer.DrawText(g, date + "  ·  " + Session.Messages.Count + " 条消息  ·  " + (Session.Report != null ? Session.Report.Label : ""),
                Theme.Tiny, new Rectangle(156, 42, Width - 300, 20), Palette.Muted,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);
            string preview = Session.Report != null ? Session.Report.Headline : "";
            TextRenderer.DrawText(g, preview, Theme.Small, new Rectangle(92, 66, Width - 240, 20), Palette.InkSoft,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);

            if (_openHover) Ui.FillRound(g, OpenRect, 8f, Palette.RoseSoft);
            TextRenderer.DrawText(g, "打开报告  →", Theme.SmallBold, OpenRect, Palette.RoseDark,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            if (_deleteHover) Ui.FillRound(g, DeleteRect, 7f, Palette.RoseSoft);
            TextRenderer.DrawText(g, "删除", Theme.Tiny, DeleteRect, _deleteHover ? Palette.RoseDark : Palette.Muted,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        }
    }

    public class EmptyArchive : Control
    {
        public EmptyArchive()
        {
            BackColor = Palette.Bg;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                     ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.Clear(Palette.Bg);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            RectangleF card = new RectangleF(0, 0, Width, Math.Min(360, Height));
            Ui.Card(g, card, 16f, Palette.Card, Palette.Line);
            using (Pen p = new Pen(Palette.LineStrong, 1.5f))
            {
                p.DashStyle = DashStyle.Dash;
                g.DrawEllipse(p, Width / 2f - 40, 46, 80, 80);
            }
            using (GraphicsPath hp = Ui.Heart(new RectangleF(Width / 2f - 14, 76, 28, 24)))
            using (SolidBrush b = new SolidBrush(Color.FromArgb(246, 213, 218)))
                g.FillPath(b, hp);
            TextRenderer.DrawText(g, "这里还没有档案", Theme.H2, new Rectangle(0, 150, Width, 30), Palette.Ink, Ui.Center);
            TextRenderer.DrawText(g, "完成一次分析后，报告会自动保存到这里。\n数据只在本机，删除后无法恢复。", Theme.Small,
                new Rectangle(24, 188, Width - 48, 48), Palette.Muted, Ui.WrapCenter);
        }
    }
}
