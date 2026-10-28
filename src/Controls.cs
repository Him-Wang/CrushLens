using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Media;
using System.Windows.Forms;

namespace CrushLens
{
    public class ScrollCanvas : Control
    {
        protected int ScrollY;
        protected int ContentHeight;
        private bool _thumbDrag;
        private int _dragStartY;
        private int _dragStartScroll;
        private Rectangle _thumbRect;
        private bool _thumbHover;
        private readonly SurfacePanel _surface;

        private class SurfacePanel : Control
        {
            public ScrollCanvas Owner;

            public SurfacePanel()
            {
                SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                         ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
                TabStop = false;
                Enabled = true;
            }

            private MouseEventArgs ToParent(MouseEventArgs e)
            {
                return new MouseEventArgs(e.Button, e.Clicks, e.X + Left, e.Y + Top, e.Delta);
            }

            protected override void OnPaintBackground(PaintEventArgs e)
            {
                e.Graphics.Clear(BackColor);
            }

            protected override void OnPaint(PaintEventArgs e)
            {
                e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                e.Graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
                if (Owner != null) Owner.PaintContent(e.Graphics);
            }

            protected override void OnMouseWheel(MouseEventArgs e)
            {
                if (Owner != null) Owner.ForwardMouseWheel(ToParent(e));
            }

            protected override void OnMouseEnter(EventArgs e)
            {
                base.OnMouseEnter(e);
                if (Owner != null)
                {
                    Owner.Focus();
                    Cursor = Owner.Cursor;
                }
            }

            protected override void OnMouseDown(MouseEventArgs e)
            {
                if (Owner != null)
                {
                    Owner.Focus();
                    Owner.ForwardMouseDown(ToParent(e));
                }
            }

            protected override void OnMouseUp(MouseEventArgs e)
            {
                if (Owner != null) Owner.ForwardMouseUp(ToParent(e));
            }

            protected override void OnMouseMove(MouseEventArgs e)
            {
                if (Owner != null)
                {
                    Owner.ForwardMouseMove(ToParent(e));
                    Cursor = Owner.Cursor;
                }
            }

            protected override void OnMouseLeave(EventArgs e)
            {
                base.OnMouseLeave(e);
                if (Owner != null) Owner.Cursor = Cursors.Default;
            }
        }

        public ScrollCanvas()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                     ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
            BackColor = Palette.Bg;
            TabStop = true;
            _surface = new SurfacePanel();
            _surface.Owner = this;
            _surface.BackColor = BackColor;
            _surface.Enabled = true;
            Controls.Add(_surface);
        }

        public int ContentWidth
        {
            get { return Math.Max(40, ClientSize.Width - 12); }
        }

        public void ScrollToBottom()
        {
            ScrollY = Math.Max(0, ContentHeight - ClientSize.Height);
            PositionSurface();
            Invalidate();
        }

        public void SetContentHeight(int height)
        {
            height = Math.Max(0, height);
            if (height != ContentHeight)
            {
                ContentHeight = height;
                ClampScroll();
                PositionSurface();
                Invalidate();
            }
        }

        protected void ClampScroll()
        {
            int max = Math.Max(0, ContentHeight - ClientSize.Height);
            if (ScrollY > max) ScrollY = max;
            if (ScrollY < 0) ScrollY = 0;
            PositionSurface();
        }

        private void PositionSurface()
        {
            if (_surface == null) return;
            int width = ContentWidth;
            int height = Math.Max(ClientSize.Height, ContentHeight);
            _surface.BackColor = BackColor;
            _surface.SetBounds(0, -ScrollY, Math.Max(20, width), Math.Max(1, height));
            _surface.Invalidate();
        }

        protected override void OnMouseEnter(EventArgs e)
        {
            base.OnMouseEnter(e);
            if (!Focused) Focus();
        }

        internal void ForwardMouseWheel(MouseEventArgs e)
        {
            OnMouseWheel(e);
        }

        internal void ForwardMouseDown(MouseEventArgs e)
        {
            OnMouseDown(e);
        }

        internal void ForwardMouseUp(MouseEventArgs e)
        {
            OnMouseUp(e);
        }

        internal void ForwardMouseMove(MouseEventArgs e)
        {
            OnMouseMove(e);
        }

        protected override void OnMouseWheel(MouseEventArgs e)
        {
            base.OnMouseWheel(e);
            int max = Math.Max(0, ContentHeight - ClientSize.Height);
            if (max <= 0) return;
            ScrollY -= e.Delta;
            if (ScrollY < 0) ScrollY = 0;
            if (ScrollY > max) ScrollY = max;
            PositionSurface();
            Invalidate();
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            if (e.Button == MouseButtons.Left && _thumbRect.Contains(e.Location))
            {
                _thumbDrag = true;
                _dragStartY = e.Y;
                _dragStartScroll = ScrollY;
                Capture = true;
            }
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            bool hover = _thumbRect.Contains(e.Location);
            if (hover != _thumbHover)
            {
                _thumbHover = hover;
                Cursor = hover ? Cursors.Hand : Cursors.Default;
                Invalidate();
            }
            if (_thumbDrag)
            {
                int max = Math.Max(1, ContentHeight - ClientSize.Height);
                int track = Math.Max(1, ClientSize.Height - 12 - _thumbRect.Height);
                int delta = (int)((e.Y - _dragStartY) * (double)max / track);
                ScrollY = _dragStartScroll + delta;
                ClampScroll();
                Invalidate();
            }
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            _thumbDrag = false;
            Capture = false;
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            base.OnMouseLeave(e);
            if (!_thumbDrag && _thumbHover)
            {
                _thumbHover = false;
                Cursor = Cursors.Default;
                Invalidate();
            }
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            ClampScroll();
            Recalc();
            PositionSurface();
            Invalidate();
        }

        protected virtual void Recalc()
        {
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.Clear(BackColor);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            DrawScrollbar(g);
            base.OnPaint(e);
        }

        protected virtual void PaintContent(Graphics g)
        {
        }

        private void DrawScrollbar(Graphics g)
        {
            _thumbRect = Rectangle.Empty;
            if (ContentHeight <= ClientSize.Height + 2) return;
            int trackTop = 6;
            int trackHeight = ClientSize.Height - 12;
            int thumbHeight = Math.Max(36, (int)((double)ClientSize.Height / ContentHeight * trackHeight));
            int maxScroll = Math.Max(1, ContentHeight - ClientSize.Height);
            int thumbTop = trackTop + (int)((double)Math.Max(0, Math.Min(ScrollY, maxScroll)) / maxScroll * (trackHeight - thumbHeight));
            _thumbRect = new Rectangle(ClientSize.Width - 9, thumbTop, 4, thumbHeight);
            Color color = _thumbHover || _thumbDrag ? Color.FromArgb(168, 148, 140) : Color.FromArgb(206, 191, 184);
            Ui.FillRound(g, _thumbRect, 2f, color);
        }
    }

    public enum ButtonKind
    {
        Primary,
        Secondary,
        Ghost,
        Soft,
        Danger
    }

    public class PillButton : Control
    {
        private bool _hover;
        private bool _pressed;

        public ButtonKind Kind = ButtonKind.Primary;
        public int Radius = 9;

        public PillButton()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                     ControlStyles.UserPaint | ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
            Font = Theme.BodyBold;
            Cursor = Cursors.Hand;
            Height = 36;
            Width = 112;
            ForeColor = Palette.White;
            TabStop = true;
        }

        protected override void OnMouseEnter(EventArgs e)
        {
            base.OnMouseEnter(e);
            _hover = true;
            Invalidate();
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            base.OnMouseLeave(e);
            _hover = false;
            _pressed = false;
            Invalidate();
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            if (e.Button == MouseButtons.Left)
            {
                _pressed = true;
                Invalidate();
            }
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            _pressed = false;
            Invalidate();
        }

        protected override void OnEnabledChanged(EventArgs e)
        {
            base.OnEnabledChanged(e);
            Cursor = Enabled ? Cursors.Hand : Cursors.Default;
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            RectangleF r = new RectangleF(0.5f, 0.5f, Width - 1f, Height - 1f);
            Color fill = Color.Empty;
            Color border = Color.Empty;
            Color fore;

            if (!Enabled)
            {
                fill = Palette.BgDeep;
                fore = Palette.MutedLight;
            }
            else if (Kind == ButtonKind.Primary)
            {
                Color top = _pressed ? Palette.RoseDeep : (_hover ? Ui.Lighten(Palette.Rose, 0.08f) : Palette.Rose);
                Color bottom = _pressed ? Palette.RoseDark : Ui.Darken(Palette.Rose, _hover ? 0.02f : 0.08f);
                using (LinearGradientBrush b = new LinearGradientBrush(r, top, bottom, 90f))
                {
                    using (GraphicsPath p = Ui.Rounded(r, Radius)) g.FillPath(b, p);
                }
                fore = Palette.White;
            }
            else if (Kind == ButtonKind.Danger)
            {
                fill = _hover ? Palette.RoseSoft : Palette.Card;
                border = Palette.Rose;
                fore = Palette.RoseDark;
            }
            else if (Kind == ButtonKind.Soft)
            {
                fill = _hover ? Ui.Darken(Palette.RoseSoft, 0.03f) : Palette.RoseSoft;
                fore = Palette.RoseDark;
            }
            else if (Kind == ButtonKind.Secondary)
            {
                fill = _hover ? Palette.CardSoft : Palette.Card;
                border = Palette.LineStrong;
                fore = Palette.InkSoft;
            }
            else
            {
                fill = _hover ? Palette.BgDeep : Color.Transparent;
                fore = _hover ? Palette.Ink : Palette.Muted;
            }

            if (Kind == ButtonKind.Primary)
            {
                if (!Enabled)
                {
                    Ui.FillRound(g, r, Radius, Palette.BgDeep);
                }
            }
            else
            {
                if (fill.A > 0) Ui.FillRound(g, r, Radius, fill);
                if (border != Color.Empty) Ui.StrokeRound(g, r, Radius, border, 1f);
            }

            TextRenderer.DrawText(g, Text, Font, new Rectangle(6, 0, Width - 12, Height), fore,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding |
                TextFormatFlags.EndEllipsis);
        }
    }

    public class WindowBar : Control
    {
        private readonly Form _form;
        private int _hover = -1;
        private string _pageName = "分析台";

        public WindowBar(Form form)
        {
            _form = form;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                     ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
            BackColor = Palette.Bg;
            Height = 44;
        }

        public void SetPageName(string name)
        {
            _pageName = name;
            Invalidate();
        }

        private Rectangle Btn(int i)
        {
            int w = 44;
            return new Rectangle(Width - w * (3 - i), 0, w, Height);
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            int h = -1;
            for (int i = 0; i < 3; i++)
                if (Btn(i).Contains(e.Location)) h = i;
            if (h != _hover)
            {
                _hover = h;
                Cursor = h >= 0 ? Cursors.Hand : Cursors.Default;
                Invalidate();
            }
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            base.OnMouseLeave(e);
            _hover = -1;
            Cursor = Cursors.Default;
            Invalidate();
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            if (e.Button != MouseButtons.Left) return;
            int button = -1;
            for (int i = 0; i < 3; i++)
                if (Btn(i).Contains(e.Location)) button = i;
            if (button >= 0)
            {
                if (button == 0) _form.WindowState = FormWindowState.Minimized;
                else if (button == 1) _form.WindowState = _form.WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
                else _form.Close();
                return;
            }
            Native.DragWindow(_form.Handle);
        }

        protected override void OnDoubleClick(EventArgs e)
        {
            base.OnDoubleClick(e);
            _form.WindowState = _form.WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.Clear(Palette.Bg);
            using (Pen p = new Pen(Palette.Line)) g.DrawLine(p, 0, Height - 1, Width, Height - 1);
            Ui.Dot(g, 22, Height / 2f - 3, 6, Palette.Green);
            TextRenderer.DrawText(g, "本地模式", Theme.SmallBold, new Rectangle(34, 0, 64, Height), Palette.InkSoft,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, "·  对话只在内存与程序目录中流转", Theme.Small, new Rectangle(96, 0, 360, Height), Palette.Muted,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, _pageName, Theme.SmallBold, new Rectangle(Width - 430, 0, 280, Height), Palette.Muted,
                TextFormatFlags.Right | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);

            for (int i = 0; i < 3; i++)
            {
                Rectangle r = Btn(i);
                if (_hover == i)
                {
                    Color hc = i == 2 ? Color.FromArgb(250, 232, 235) : Palette.BgDeep;
                    using (SolidBrush b = new SolidBrush(hc)) g.FillRectangle(b, r);
                }
                DrawWindowGlyph(g, i, r, _hover == i && i == 2 ? Palette.RoseDark : Palette.InkSoft);
            }
        }

        private void DrawWindowGlyph(Graphics g, int index, Rectangle r, Color color)
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (Pen p = new Pen(color, 1.3f))
            {
                int cx = r.X + r.Width / 2;
                int cy = r.Y + r.Height / 2;
                if (index == 0)
                {
                    g.DrawLine(p, cx - 5, cy + 4, cx + 5, cy + 4);
                }
                else if (index == 1)
                {
                    if (_form.WindowState == FormWindowState.Maximized)
                    {
                        g.DrawRectangle(p, cx - 5, cy - 4, 8, 8);
                        g.DrawLine(p, cx - 2, cy - 6, cx + 6, cy - 6);
                        g.DrawLine(p, cx + 6, cy - 6, cx + 6, cy + 2);
                    }
                    else
                    {
                        g.DrawRectangle(p, cx - 5, cy - 5, 10, 10);
                    }
                }
                else
                {
                    g.DrawLine(p, cx - 5, cy - 5, cx + 5, cy + 5);
                    g.DrawLine(p, cx + 5, cy - 5, cx - 5, cy + 5);
                }
            }
        }
    }

    public class Sidebar : Control
    {
        private int _active;
        private int _hover = -1;
        private bool _apiReady;
        private readonly string[] _items = new string[] { "分析台", "数据看板", "聊天档案", "使用指南" };

        public event EventHandler NavChanged;
        public event EventHandler SettingsClicked;

        public Sidebar()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                     ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
            BackColor = Palette.Sidebar;
            Width = 228;
        }

        public int Active
        {
            get { return _active; }
        }

        public void SetActive(int index)
        {
            if (index < 0 || index > 3) return;
            _active = index;
            Invalidate();
        }

        public void SetApiStatus(bool ready)
        {
            _apiReady = ready;
            Invalidate();
        }

        private Rectangle ItemRect(int i)
        {
            return new Rectangle(14, 148 + i * 50, Width - 28, 42);
        }

        private Rectangle SettingsRect
        {
            get { return new Rectangle(14, Height - 56, Width - 28, 38); }
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            int h = -1;
            for (int i = 0; i < _items.Length; i++)
                if (ItemRect(i).Contains(e.Location)) h = i;
            if (SettingsRect.Contains(e.Location)) h = 9;
            if (h != _hover)
            {
                _hover = h;
                Cursor = h >= 0 ? Cursors.Hand : Cursors.Default;
                Invalidate();
            }
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            base.OnMouseLeave(e);
            _hover = -1;
            Cursor = Cursors.Default;
            Invalidate();
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            if (e.Button != MouseButtons.Left) return;
            for (int i = 0; i < _items.Length; i++)
            {
                if (ItemRect(i).Contains(e.Location))
                {
                    if (_active != i)
                    {
                        _active = i;
                        Invalidate();
                        if (NavChanged != null) NavChanged(this, EventArgs.Empty);
                    }
                    return;
                }
            }
            if (SettingsRect.Contains(e.Location))
            {
                if (SettingsClicked != null) SettingsClicked(this, EventArgs.Empty);
                return;
            }
            if (e.Y < 120 && FindForm() != null) Native.DragWindow(FindForm().Handle);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.Clear(Palette.Sidebar);
            g.SmoothingMode = SmoothingMode.AntiAlias;

            Ui.Logo(g, new Rectangle(22, 22, 38, 38));
            TextRenderer.DrawText(g, "CrushLens", Theme.Brand, new Rectangle(72, 24, 140, 24), Palette.White,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, "心动镜 · 本地分析", Theme.BrandSub, new Rectangle(73, 46, 140, 18), Palette.SidebarMuted,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);

            TextRenderer.DrawText(g, "工作台", Theme.Tiny, new Rectangle(24, 112, 120, 20), Palette.SidebarMuted,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);

            for (int i = 0; i < _items.Length; i++)
            {
                Rectangle r = ItemRect(i);
                if (_active == i)
                {
                    Ui.FillRound(g, r, 10f, Palette.SidebarSoft);
                }
                else if (_hover == i)
                {
                    Ui.FillRound(g, r, 10f, Color.FromArgb(39, 29, 37));
                }
                if (_active == i)
                {
                    Ui.FillRound(g, new RectangleF(r.X + 1, r.Y + 12, 3, r.Height - 24), 1.5f, Palette.Rose);
                }
                Color iconColor = _active == i ? Palette.Rose : Palette.SidebarMuted;
                DrawNavIcon(g, i, new Rectangle(r.X + 16, r.Y + 12, 18, 18), iconColor);
                Color textColor = _active == i ? Palette.White : Palette.SidebarText;
                TextRenderer.DrawText(g, _items[i], _active == i ? Theme.BodyBold : Theme.Body,
                    new Rectangle(r.X + 46, r.Y, r.Width - 58, r.Height), textColor,
                    TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            }

            // Privacy card
            Rectangle pc = new Rectangle(14, Height - 216, Width - 28, 148);
            Ui.FillRound(g, pc, 12f, Color.FromArgb(39, 29, 37));
            Ui.StrokeRound(g, new RectangleF(pc.X + 0.5f, pc.Y + 0.5f, pc.Width - 1, pc.Height - 1), 12f, Color.FromArgb(57, 43, 52), 1f);
            Ui.Dot(g, pc.X + 16, pc.Y + 19, 7, _apiReady ? Palette.Green : Palette.Amber);
            TextRenderer.DrawText(g, _apiReady ? "API 已就绪" : "尚未配置 API", Theme.SmallBold,
                new Rectangle(pc.X + 30, pc.Y + 13, pc.Width - 42, 20), Palette.SidebarText,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, "数据留在本机", Theme.SmallBold,
                new Rectangle(pc.X + 16, pc.Y + 42, pc.Width - 32, 20), Palette.White,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, "无账号 · 无遥测 · 无云端同步\n聊天只写入 CrushLens_Data",
                Theme.Tiny, new Rectangle(pc.X + 16, pc.Y + 64, pc.Width - 30, 52), Palette.SidebarMuted,
                TextFormatFlags.Left | TextFormatFlags.WordBreak | TextFormatFlags.NoPadding);

            Rectangle sr = SettingsRect;
            if (_hover == 9) Ui.FillRound(g, sr, 9f, Color.FromArgb(39, 29, 37));
            DrawGear(g, new Rectangle(sr.X + 10, sr.Y + 11, 16, 16), Palette.SidebarMuted);
            TextRenderer.DrawText(g, "设置", Theme.Small, new Rectangle(sr.X + 34, sr.Y, 80, sr.Height), Palette.SidebarMuted,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, "v1.2 · portable", Theme.Tiny, new Rectangle(sr.X + 100, sr.Y, sr.Width - 110, sr.Height),
                Color.FromArgb(109, 91, 101), TextFormatFlags.Right | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        }

        private void DrawNavIcon(Graphics g, int index, Rectangle r, Color color)
        {
            using (Pen p = new Pen(color, 1.5f))
            {
                if (index == 0)
                {
                    RectangleF hr = new RectangleF(r.X + 2, r.Y + 3, 14, 12);
                    using (GraphicsPath hp = Ui.Heart(hr)) g.DrawPath(p, hp);
                }
                else if (index == 1)
                {
                    g.DrawLine(p, r.X + 2, r.Bottom - 3, r.Right - 2, r.Bottom - 3);
                    g.DrawLine(p, r.X + 4, r.Bottom - 4, r.X + 4, r.Y + 10);
                    g.DrawLine(p, r.X + 9, r.Bottom - 4, r.X + 9, r.Y + 5);
                    g.DrawLine(p, r.X + 14, r.Bottom - 4, r.X + 14, r.Y + 8);
                }
                else if (index == 2)
                {
                    g.DrawRectangle(p, r.X + 2, r.Y + 5, 14, 11);
                    g.DrawLine(p, r.X + 2, r.Y + 7, r.X + 8, r.Y + 2);
                    g.DrawLine(p, r.X + 8, r.Y + 2, r.X + 11, r.Y + 5);
                }
                else
                {
                    g.DrawEllipse(p, r.X + 2, r.Y + 2, 14, 14);
                    g.DrawLine(p, r.X + 8, r.Y + 7, r.X + 8, r.Y + 10);
                    g.DrawLine(p, r.X + 8, r.Y + 13, r.X + 8, r.Y + 13);
                }
            }
        }

        private void DrawGear(Graphics g, Rectangle r, Color color)
        {
            using (Pen p = new Pen(color, 1.3f))
            {
                g.DrawEllipse(p, r.X + 4, r.Y + 4, r.Width - 8, r.Height - 8);
                for (int i = 0; i < 4; i++)
                {
                    double a = Math.PI / 4 + i * Math.PI / 2;
                    float x1 = r.X + r.Width / 2f + (float)Math.Cos(a) * 4;
                    float y1 = r.Y + r.Height / 2f + (float)Math.Sin(a) * 4;
                    float x2 = r.X + r.Width / 2f + (float)Math.Cos(a) * 7;
                    float y2 = r.Y + r.Height / 2f + (float)Math.Sin(a) * 7;
                    g.DrawLine(p, x1, y1, x2, y2);
                }
            }
        }
    }

    public class CardPanel : Panel
    {
        public int Radius = 14;
        public Color BorderColor = Palette.Line;
        public Color FillColor = Palette.Card;

        public CardPanel()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                     ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
            BackColor = Palette.Card;
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            using (GraphicsPath p = Ui.Rounded(new RectangleF(0, 0, Width, Height), Radius))
                Region = new Region(p);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.Clear(FillColor);
            Ui.StrokeRound(g, new RectangleF(0.5f, 0.5f, Width - 1f, Height - 1f), Radius, BorderColor, 1f);
        }
    }

    public class PlaceholderTextBox : UserControl
    {
        private readonly TextBox _box;
        private readonly Label _placeholder;
        private bool _focused;
        private string _placeholderText = "";

        public PlaceholderTextBox()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                     ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
            BackColor = Palette.CardSoft;
            Padding = new Padding(12, 10, 12, 10);
            _box = new TextBox();
            _box.Multiline = true;
            _box.BorderStyle = BorderStyle.None;
            _box.BackColor = Palette.CardSoft;
            _box.ForeColor = Palette.Ink;
            _box.Font = Theme.Body;
            _box.ScrollBars = ScrollBars.Vertical;
            _box.AcceptsReturn = true;
            _box.WordWrap = true;
            _box.ShortcutsEnabled = true;
            _box.TextChanged += BoxTextChanged;
            _box.Enter += BoxEnter;
            _box.Leave += BoxLeave;
            _box.KeyDown += BoxKeyDown;
            Controls.Add(_box);

            _placeholder = new Label();
            _placeholder.AutoSize = false;
            _placeholder.BackColor = Palette.CardSoft;
            _placeholder.ForeColor = Palette.Muted;
            _placeholder.Font = Theme.Body;
            _placeholder.Cursor = Cursors.IBeam;
            _placeholder.Click += PlaceholderClick;
            Controls.Add(_placeholder);
            _placeholder.BringToFront();
        }

        public TextBox InnerTextBox
        {
            get { return _box; }
        }

        public string PlaceholderText
        {
            get { return _placeholderText; }
            set
            {
                _placeholderText = value ?? "";
                _placeholder.Text = _placeholderText;
                _placeholder.Visible = _box.Text.Length == 0;
            }
        }

        public override string Text
        {
            get { return _box.Text; }
            set
            {
                _box.Text = value ?? "";
                _placeholder.Visible = _box.Text.Length == 0;
            }
        }

        public void SetText(string value)
        {
            Text = value;
        }

        public void FocusInput()
        {
            _box.Focus();
        }

        private void BoxTextChanged(object sender, EventArgs e)
        {
            _placeholder.Visible = _box.Text.Length == 0;
            OnTextChanged(e);
        }

        private void BoxEnter(object sender, EventArgs e)
        {
            _focused = true;
            Invalidate();
        }

        private void BoxLeave(object sender, EventArgs e)
        {
            _focused = false;
            Invalidate();
        }

        private void BoxKeyDown(object sender, KeyEventArgs e)
        {
            if (e.Control && e.KeyCode == Keys.V && Clipboard.ContainsText())
            {
                // The native paste path is intentionally left alone.
            }
        }

        private void PlaceholderClick(object sender, EventArgs e)
        {
            _box.Focus();
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            _box.SetBounds(Padding.Left, Padding.Top, Math.Max(10, Width - Padding.Left - Padding.Right), Math.Max(10, Height - Padding.Top - Padding.Bottom));
            _placeholder.SetBounds(Padding.Left + 1, Padding.Top + 1, Math.Max(10, Width - Padding.Left - Padding.Right - 4), Math.Min(78, Height - Padding.Top - Padding.Bottom));
            if (_placeholder.Visible) _placeholder.BringToFront();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.Clear(Palette.CardSoft);
            Ui.StrokeRound(g, new RectangleF(0.5f, 0.5f, Width - 1f, Height - 1f), 10f, _focused ? Ui.Lighten(Palette.Rose, 0.35f) : Palette.Line, 1f);
            base.OnPaint(e);
        }
    }

    public class NoteBox : Control
    {
        public string Title = "";
        public string Body = "";
        public Color Tint = Palette.RoseSoft;
        public Color Accent = Palette.RoseDark;
        public int Radius = 10;

        public NoteBox()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                     ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
            BackColor = Palette.Card;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.Clear(BackColor);
            Ui.FillRound(g, new RectangleF(0, 0, Width, Height), Radius, Tint);
            Ui.FillRound(g, new RectangleF(14, 16, 3, 18), 1.5f, Accent);
            TextRenderer.DrawText(g, Title, Theme.SmallBold, new Rectangle(24, 12, Width - 36, 22), Accent,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, Body, Theme.Tiny, new Rectangle(24, 34, Width - 38, Height - 40), Palette.InkSoft,
                TextFormatFlags.Left | TextFormatFlags.WordBreak | TextFormatFlags.NoPadding);
        }
    }

    public class Toast : Control
    {
        private readonly Timer _timer;
        private string _message = "";

        public Toast()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                     ControlStyles.UserPaint | ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
            Visible = false;
            _timer = new Timer();
            _timer.Interval = 2800;
            _timer.Tick += delegate
            {
                _timer.Stop();
                Visible = false;
            };
        }

        public void ShowMessage(string message)
        {
            _message = message ?? "";
            if (_message.Length == 0) return;
            using (Graphics g = CreateGraphics())
            {
                Size size = TextRenderer.MeasureText(g, _message, Theme.SmallBold,
                    new Size(600, 40), TextFormatFlags.NoPadding | TextFormatFlags.SingleLine);
                Width = Math.Min(620, size.Width + 52);
            }
            Height = 38;
            Visible = true;
            BringToFront();
            _timer.Stop();
            _timer.Start();
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            RectangleF r = new RectangleF(0, 0, Width, Height);
            Ui.FillRound(g, r, Height / 2f, Color.FromArgb(242, 34, 26, 32));
            Ui.Dot(g, 15, Height / 2f - 3, 6, Palette.Green);
            TextRenderer.DrawText(g, _message, Theme.SmallBold, new Rectangle(28, 0, Width - 40, Height), Palette.White,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);
        }
    }

    public enum DialogKind
    {
        Info,
        Warning,
        Error,
        Confirm
    }

    public class UiDialog : Form
    {
        private readonly DialogKind _kind;
        private bool _confirmed;

        private UiDialog(string title, string message, DialogKind kind, bool confirm)
        {
            _kind = kind;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterParent;
            ShowInTaskbar = false;
            BackColor = Palette.Bg;
            Width = 480;
            Text = title;
            KeyPreview = true;
            DoubleBuffered = true;
            using (Graphics g = CreateGraphics())
            {
                int textH = TextRenderer.MeasureText(g, message, Theme.Body, new Size(398, 320),
                    TextFormatFlags.WordBreak | TextFormatFlags.NoPadding).Height;
                Height = 178 + Math.Min(260, textH);
            }
            Height = Math.Max(210, Math.Min(430, Height));

            Label titleLabel = new Label();
            titleLabel.Text = title;
            titleLabel.Font = Theme.H3;
            titleLabel.ForeColor = Palette.Ink;
            titleLabel.AutoSize = false;
            titleLabel.SetBounds(92, 30, Width - 130, 30);
            titleLabel.BackColor = Color.Transparent;
            Controls.Add(titleLabel);

            Label msg = new Label();
            msg.Text = message;
            msg.Font = Theme.Body;
            msg.ForeColor = Palette.InkSoft;
            msg.AutoSize = false;
            msg.SetBounds(32, 82, Width - 64, Height - 160);
            msg.BackColor = Color.Transparent;
            Controls.Add(msg);

            PillButton ok = new PillButton();
            ok.Text = confirm ? "确认" : "知道了";
            ok.Kind = ButtonKind.Primary;
            ok.SetBounds(Width - 136, Height - 62, 104, 36);
            ok.Click += OkClicked;
            Controls.Add(ok);

            if (confirm)
            {
                PillButton cancel = new PillButton();
                cancel.Text = "取消";
                cancel.Kind = ButtonKind.Secondary;
                cancel.SetBounds(Width - 250, Height - 62, 100, 36);
                cancel.Click += delegate { DialogResult = DialogResult.Cancel; Close(); };
                Controls.Add(cancel);
            }

            Paint += DialogPaint;
            MouseDown += DialogMouseDown;
            KeyDown += DialogKeyDown;
            Shown += delegate { ok.Focus(); };
        }

        private void DialogPaint(object sender, PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (Pen p = new Pen(Palette.LineStrong)) g.DrawRectangle(p, 0, 0, Width - 1, Height - 1);
            Color accent = _kind == DialogKind.Error ? Palette.Rose : (_kind == DialogKind.Warning ? Palette.Amber : Palette.Green);
            Color soft = _kind == DialogKind.Error ? Palette.RoseSoft : (_kind == DialogKind.Warning ? Palette.AmberSoft : Palette.GreenSoft);
            Ui.FillRound(g, new RectangleF(32, 26, 44, 44), 22f, soft);
            if (_kind == DialogKind.Confirm || _kind == DialogKind.Info)
            {
                TextRenderer.DrawText(g, "i", Theme.H2, new Rectangle(32, 26, 44, 44),
                    accent, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            }
            else
            {
                TextRenderer.DrawText(g, "!", Theme.H2, new Rectangle(32, 26, 44, 44),
                    accent, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            }
        }

        private void DialogMouseDown(object sender, MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left && e.Y < 70) Native.DragWindow(Handle);
        }

        private void DialogKeyDown(object sender, KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Escape)
            {
                DialogResult = DialogResult.Cancel;
                Close();
            }
            else if (e.KeyCode == Keys.Enter)
            {
                _confirmed = true;
                DialogResult = DialogResult.OK;
                Close();
            }
        }

        private void OkClicked(object sender, EventArgs e)
        {
            _confirmed = true;
            DialogResult = DialogResult.OK;
            Close();
        }

        public static void Info(IWin32Window owner, string title, string message)
        {
            using (UiDialog d = new UiDialog(title, message, DialogKind.Info, false))
                d.ShowDialog(owner);
        }

        public static void Warn(IWin32Window owner, string title, string message)
        {
            using (UiDialog d = new UiDialog(title, message, DialogKind.Warning, false))
                d.ShowDialog(owner);
        }

        public static void Error(IWin32Window owner, string title, string message)
        {
            using (UiDialog d = new UiDialog(title, message, DialogKind.Error, false))
                d.ShowDialog(owner);
        }

        public static bool Confirm(IWin32Window owner, string title, string message)
        {
            using (UiDialog d = new UiDialog(title, message, DialogKind.Confirm, true))
            {
                DialogResult result = d.ShowDialog(owner);
                return result == DialogResult.OK && d._confirmed;
            }
        }
    }
}
