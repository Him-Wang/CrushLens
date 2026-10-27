using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Windows.Forms;

namespace CrushLens
{
    public class ChatCanvas : ScrollCanvas
    {
        private ChatSession _session;
        private List<Bubble> _items = new List<Bubble>();
        private int _layoutWidth = -1;
        private int _shown;
        private int _tagged;
        private int _totalSelected;
        private readonly List<Image> _mediaImages = new List<Image>();
        private readonly List<string> _mediaNames = new List<string>();

        private class Bubble
        {
            public ChatMessage Message;
            public int Y;
            public int Height;
            public int BubbleX;
            public int BubbleW;
            public int BubbleH;
            public int TextH;
            public bool NewDay;
            public string DayLabel = "";
            public MessageTag Tag;
        }

        public ChatCanvas()
        {
            BackColor = Palette.Card;
        }

        public int ShownMessages
        {
            get { return _shown; }
        }

        public int TaggedMessages
        {
            get { return _tagged; }
        }

        public int TotalSelected
        {
            get { return _totalSelected; }
        }

        public void SetSession(ChatSession session)
        {
            _session = session;
            _layoutWidth = -1;
            ScrollY = 0;
            LoadMediaImages(session);
            BuildLayout();
            Invalidate();
        }

        public void Clear()
        {
            _session = null;
            _items.Clear();
            _shown = 0;
            _tagged = 0;
            _totalSelected = 0;
            ClearMediaImages();
            SetContentHeight(0);
            Invalidate();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) ClearMediaImages();
            base.Dispose(disposing);
        }

        private void ClearMediaImages()
        {
            for (int i = 0; i < _mediaImages.Count; i++) _mediaImages[i].Dispose();
            _mediaImages.Clear();
            _mediaNames.Clear();
        }

        private void LoadMediaImages(ChatSession session)
        {
            ClearMediaImages();
            if (session == null || session.Media == null) return;
            for (int i = 0; i < session.Media.Count; i++)
            {
                ChatMedia m = session.Media[i];
                if (m == null || m.Data == null || m.Data.Length == 0) continue;
                try
                {
                    using (MemoryStream ms = new MemoryStream(m.Data))
                    using (Image source = Image.FromStream(ms))
                        _mediaImages.Add(new Bitmap(source));
                    _mediaNames.Add(string.IsNullOrEmpty(m.OriginalName) ? "图片 " + (i + 1) : m.OriginalName);
                }
                catch
                {
                    Log.Write("WARN 图片画廊解码失败（已跳过一张图片）。");
                }
            }
        }

        protected override void Recalc()
        {
            _layoutWidth = -1;
            BuildLayout();
        }

        private void BuildLayout()
        {
            _items.Clear();
            _shown = 0;
            _tagged = 0;
            _totalSelected = 0;
            if (_session == null || _session.Messages == null) { SetContentHeight(0); return; }
            int width = ContentWidth;
            if (width < 100) return;
            if (_layoutWidth == width) return;
            _layoutWidth = width;

            List<ChatMessage> msgs = new List<ChatMessage>();
            for (int i = 0; i < _session.Messages.Count; i++)
            {
                ChatMessage m = _session.Messages[i];
                if (StatsEngine.SameName(m.Sender, _session.MeName) || StatsEngine.SameName(m.Sender, _session.CrushName))
                    msgs.Add(m);
            }
            _totalSelected = msgs.Count;
            if (msgs.Count == 0 && _mediaImages.Count > 0)
            {
                SetContentHeight(GalleryHeight(width));
                return;
            }
            int start = Math.Max(0, msgs.Count - 120);
            using (Graphics g = CreateGraphics())
            {
                int y = 14;
                string lastDay = "";
                for (int i = start; i < msgs.Count; i++)
                {
                    ChatMessage m = msgs[i];
                    Bubble b = new Bubble();
                    b.Message = m;
                    string day = m.Timestamp > 0 ? TimeUtil.FromMs(m.Timestamp).ToString("yyyy-MM-dd") : "unknown";
                    if (i == start || day != lastDay)
                    {
                        b.NewDay = true;
                        if (m.Timestamp > 0)
                        {
                            DateTime dt = TimeUtil.FromMs(m.Timestamp);
                            b.DayLabel = dt.ToString("M 月 d 日 · dddd", Fmt.Cn);
                        }
                        else
                        {
                            b.DayLabel = "时间未记录";
                        }
                        y += 30;
                    }
                    lastDay = day;
                    b.Y = y;

                    bool mine = StatsEngine.SameName(m.Sender, _session.MeName);
                    string content = DisplayContent(m);
                    int maxBubble = Math.Min(356, (int)(width * 0.74));
                    Size natural = TextRenderer.MeasureText(g, content, Theme.Body, new Size(2400, 60),
                        TextFormatFlags.NoPadding | TextFormatFlags.SingleLine);
                    int bubbleW = Math.Min(maxBubble, Math.Max(74, natural.Width + 26));
                    Size wrapped = TextRenderer.MeasureText(g, content, Theme.Body, new Size(bubbleW - 24, int.MaxValue),
                        TextFormatFlags.WordBreak | TextFormatFlags.NoPadding | TextFormatFlags.TextBoxControl);
                    bubbleW = Math.Min(maxBubble, Math.Max(74, wrapped.Width + 24));
                    wrapped = TextRenderer.MeasureText(g, content, Theme.Body, new Size(bubbleW - 24, int.MaxValue),
                        TextFormatFlags.WordBreak | TextFormatFlags.NoPadding | TextFormatFlags.TextBoxControl);
                    b.TextH = wrapped.Height;
                    b.BubbleH = b.TextH + 22;
                    b.BubbleW = bubbleW;
                    b.BubbleX = mine ? width - 44 - bubbleW : 44;
                    b.Tag = _session.Report != null ? _session.Report.FindTag(m.Id) : null;
                    int tagH = b.Tag != null ? 24 : 0;
                    b.Height = 22 + b.BubbleH + tagH + 16;
                    _items.Add(b);
                    y += b.Height;
                    _shown++;
                    if (b.Tag != null) _tagged++;
                }
                SetContentHeight(y + 20);
            }
        }

        protected override void PaintContent(Graphics g)
        {
            if (_session == null)
            {
                TextRenderer.DrawText(g, "还没有可展示的聊天记录。", Theme.Small,
                    new Rectangle(0, 80, ContentWidth, 40), Palette.Muted, Ui.Center);
                return;
            }
            if (_items.Count == 0 && _mediaImages.Count > 0)
            {
                PaintGallery(g);
                return;
            }
            if (_items.Count == 0)
            {
                TextRenderer.DrawText(g, "还没有可展示的聊天记录。", Theme.Small,
                    new Rectangle(0, 80, ContentWidth, 40), Palette.Muted, Ui.Center);
                return;
            }
            int top = ScrollY;
            int bottom = ScrollY + ClientSize.Height;
            for (int i = 0; i < _items.Count; i++)
            {
                Bubble b = _items[i];
                if (b.Y + b.Height < top - 10) continue;
                if (b.Y > bottom + 10) break;
                if (b.NewDay) DrawDay(g, b);
                DrawBubble(g, b);
            }
        }

        private int GalleryCols(int width)
        {
            return width >= 500 ? 3 : 2;
        }

        private int GalleryHeight(int width)
        {
            int cols = GalleryCols(width);
            int rows = (int)Math.Ceiling((double)_mediaImages.Count / cols);
            int tileW = Math.Max(90, (width - 24 - (cols - 1) * 10) / cols);
            return 14 + 34 + rows * (tileW + 42) + 30;
        }

        private void PaintGallery(Graphics g)
        {
            int width = ContentWidth;
            int cols = GalleryCols(width);
            int gap = 10;
            int tileW = Math.Max(90, (width - 24 - (cols - 1) * gap) / cols);
            int imageH = tileW;
            TextRenderer.DrawText(g, "附件预览 · " + _mediaImages.Count + " 张", Theme.H3,
                new Rectangle(12, 12, width - 24, 26), Palette.Ink,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, "仅图片分析；视觉模型会读取图片中的文字与画面。", Theme.Tiny,
                new Rectangle(12, 38, width - 24, 18), Palette.Muted,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);
            int y = 68;
            for (int i = 0; i < _mediaImages.Count; i++)
            {
                int col = i % cols;
                int row = i / cols;
                int x = 12 + col * (tileW + gap);
                int ty = y + row * (tileW + 42);
                Rectangle r = new Rectangle(x, ty, tileW, imageH);
                Ui.FillRound(g, r, 10f, Palette.CardSoft);
                Image img = _mediaImages[i];
                float scale = Math.Min((float)(tileW - 8) / img.Width, (float)(imageH - 8) / img.Height);
                int dw = Math.Max(1, (int)(img.Width * scale));
                int dh = Math.Max(1, (int)(img.Height * scale));
                int dx = x + (tileW - dw) / 2;
                int dy = ty + (imageH - dh) / 2;
                using (GraphicsPath path = Ui.Rounded(new RectangleF(x + 1, ty + 1, tileW - 2, imageH - 2), 9f))
                {
                    GraphicsState state = g.Save();
                    g.SetClip(path);
                    g.DrawImage(img, new Rectangle(dx, dy, dw, dh));
                    g.Restore(state);
                }
                Ui.StrokeRound(g, new RectangleF(x + 0.5f, ty + 0.5f, tileW - 1, imageH - 1), 10f, Palette.Line, 1f);
                TextRenderer.DrawText(g, Fmt.Truncate(_mediaNames[i], 22), Theme.Tiny,
                    new Rectangle(x, ty + imageH + 3, tileW, 18), Palette.Muted,
                    TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);
                Ui.Pill(g, new Rectangle(x + 6, ty + 6, 22, 18), (i + 1).ToString(), Theme.Tiny,
                    Color.FromArgb(195, 40, 32, 38), Palette.White);
            }
            TextRenderer.DrawText(g, "压缩图只留在本机；分析时随节选发送到你配置的视觉 API。", Theme.Tiny,
                new Rectangle(12, GalleryHeight(width) - 28, width - 24, 20), Palette.Muted,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.WordBreak);
        }

        private string DisplayContent(ChatMessage m)
        {
            string content = m.Content ?? "";
            if (content.Length > 500)
                content = content.Substring(0, 500) + "\n…（仅显示前 500 字）";
            return content;
        }

        private void DrawDay(Graphics g, Bubble b)
        {
            int w = ContentWidth;
            string label = b.DayLabel;
            Size size = TextRenderer.MeasureText(g, label, Theme.Tiny, new Size(int.MaxValue, 20), TextFormatFlags.NoPadding);
            int pillW = size.Width + 22;
            int cx = w / 2;
            Rectangle pill = new Rectangle(cx - pillW / 2, b.Y - 26, pillW, 20);
            Ui.FillRound(g, pill, 10f, Palette.Bg);
            TextRenderer.DrawText(g, label, Theme.Tiny, pill, Palette.Muted, Ui.Center);
        }

        private void DrawBubble(Graphics g, Bubble b)
        {
            ChatMessage m = b.Message;
            bool mine = StatsEngine.SameName(m.Sender, _session.MeName);
            int w = ContentWidth;
            int nameY = b.Y;
            string name = mine ? "我" : _session.CrushName;
            string time = m.Timestamp > 0 ? Fmt.Clock(m.Timestamp) : "";
            string label = string.IsNullOrEmpty(time) ? name : name + "  ·  " + time;
            Rectangle nameRect = mine
                ? new Rectangle(w - 44 - b.BubbleW, nameY, b.BubbleW + 44, 18)
                : new Rectangle(44, nameY, b.BubbleW + 44, 18);
            TextRenderer.DrawText(g, label, Theme.Tiny, nameRect, Palette.Muted,
                (mine ? TextFormatFlags.Right : TextFormatFlags.Left) | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);

            int by = b.Y + 22;
            Rectangle bubble = new Rectangle(b.BubbleX, by, b.BubbleW, b.BubbleH);
            Color fill = mine ? Palette.Rose : Color.FromArgb(246, 238, 233);
            Color fore = mine ? Palette.White : Palette.Ink;
            Ui.FillRound(g, bubble, 12f, fill);
            TextRenderer.DrawText(g, DisplayContent(m), Theme.Body,
                new Rectangle(bubble.X + 12, bubble.Y + 10, bubble.Width - 24, bubble.Height - 18), fore,
                TextFormatFlags.Left | TextFormatFlags.WordBreak | TextFormatFlags.NoPadding | TextFormatFlags.TextBoxControl);

            // avatar
            int ax = mine ? w - 34 : 6;
            Rectangle av = new Rectangle(ax, by + 2, 26, 26);
            using (SolidBrush brush = new SolidBrush(mine ? Palette.RoseSoft : Color.FromArgb(250, 226, 216)))
                g.FillEllipse(brush, av);
            TextRenderer.DrawText(g, Ui.Initial(name), Theme.SmallBold, av, mine ? Palette.RoseDark : Palette.Amber, Ui.Center);

            if (b.Tag != null)
            {
                string tagText = b.Tag.Emotion;
                if (!string.IsNullOrEmpty(b.Tag.Intent))
                    tagText += (tagText.Length > 0 ? " · " : "") + b.Tag.Intent;
                if (tagText.Length > 0)
                {
                    Size ts = TextRenderer.MeasureText(g, tagText, Theme.Tiny, new Size(220, 20), TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);
                    int tw = Math.Min(220, ts.Width + 18);
                    int tx = mine ? bubble.Right - tw : bubble.Left;
                    Rectangle tr = new Rectangle(tx, bubble.Bottom + 5, tw, 18);
                    Ui.FillRound(g, tr, 9f, mine ? Palette.RoseSoft : Palette.PeachSoft);
                    TextRenderer.DrawText(g, tagText, Theme.Tiny, tr, mine ? Palette.RoseDark : Palette.Amber,
                        TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);
                }
            }
        }
    }
}
