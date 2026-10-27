using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
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
            SetContentHeight(0);
            Invalidate();
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
            if (_session == null || _items.Count == 0)
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
