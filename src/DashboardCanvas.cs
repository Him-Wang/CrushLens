using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace CrushLens
{
    public class DashboardCanvas : ScrollCanvas
    {
        private ChatSession _session;
        private LocalStats _stats;

        public DashboardCanvas()
        {
            BackColor = Palette.Bg;
        }

        public void SetSession(ChatSession session)
        {
            _session = session;
            _stats = session != null ? (session.Stats ?? StatsEngine.Compute(session.Messages, session.MeName, session.CrushName)) : null;
            ScrollY = 0;
            Recalc();
            Invalidate();
        }

        protected override void Recalc()
        {
            if (_stats == null || _stats.Total == 0) SetContentHeight(ClientSize.Height);
            else SetContentHeight(630);
        }

        protected override void PaintContent(Graphics g)
        {
            if (_stats == null || _session == null || _stats.Total == 0)
            {
                PaintEmpty(g);
                return;
            }
            int w = ContentWidth;
            int gap = 12;
            int kw = (w - gap * 3) / 4;
            DrawKpi(g, 0, 0, kw, 84, "有效消息", Fmt.Number(_stats.Total), "我 " + _stats.Mine + "  ·  " + _stats.CrushName + " " + _stats.Crush, Palette.Rose, "01");
            DrawKpi(g, kw + gap, 0, kw, 84, "互动天平", Fmt.Percent(_stats.MineShare), "我的发言占比", Palette.Blue, "02");
            DrawKpi(g, (kw + gap) * 2, 0, kw, 84, "TA 的中位回复", _stats.CrushMedianReplySec > 0 ? Fmt.Duration(_stats.CrushMedianReplySec) : "—",
                "我 " + (_stats.MineMedianReplySec > 0 ? Fmt.Duration(_stats.MineMedianReplySec) : "—"), Palette.Amber, "03");
            DrawKpi(g, (kw + gap) * 3, 0, kw, 84, "活跃天数", _stats.ActiveDays.ToString(),
                "连续 " + _stats.CurrentStreak + " 天 · 最长 " + _stats.LongestStreak + " 天", Palette.Green, "04");

            int top = 96;
            int leftW = (int)((w - gap) * 0.61);
            int rightW = w - gap - leftW;
            DrawActivity(g, new RectangleF(0, top, leftW, 232));
            DrawSignals(g, new RectangleF(leftW + gap, top, rightW, 232));

            int row2 = top + 244;
            DrawHours(g, new RectangleF(0, row2, leftW, 170));
            DrawKeywords(g, new RectangleF(leftW + gap, row2, rightW, 170));

            DrawObservations(g, new RectangleF(0, row2 + 182, w, 100));
        }

        private void DrawKpi(Graphics g, int x, int y, int w, int h, string label, string value, string sub, Color accent, string index)
        {
            RectangleF card = new RectangleF(x, y, w, h);
            Ui.Card(g, card, 13f, Palette.Card, Palette.Line);
            TextRenderer.DrawText(g, label, Theme.Tiny, new Rectangle(x + 16, y + 13, w - 50, 16), Palette.Muted,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, value, new Font(Theme.FontFamily, 23f, FontStyle.Bold),
                new Rectangle(x + 16, y + 30, w - 26, 36), Palette.Ink,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);
            TextRenderer.DrawText(g, sub, Theme.Tiny, new Rectangle(x + 16, y + 68, w - 26, 16), Palette.Muted,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);
            Ui.FillRound(g, new RectangleF(x + w - 30, y + 14, 15, 15), 7.5f, Ui.Lighten(accent, 0.78f));
            TextRenderer.DrawText(g, index, Theme.Tiny, new Rectangle(x + w - 30, y + 14, 15, 15), accent, Ui.Center);
        }

        private void DrawActivity(Graphics g, RectangleF card)
        {
            Ui.Card(g, card, 14f, Palette.Card, Palette.Line);
            TextRenderer.DrawText(g, "近 14 天对话节奏", Theme.H3,
                new Rectangle((int)card.X + 18, (int)card.Y + 14, (int)card.Width - 120, 24), Palette.Ink,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            Ui.Dot(g, card.Right - 132, card.Y + 24, 7, Palette.Rose);
            TextRenderer.DrawText(g, "我", Theme.Tiny, new Rectangle((int)card.Right - 121, (int)card.Y + 15, 22, 18), Palette.Muted,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            Ui.Dot(g, card.Right - 84, card.Y + 24, 7, Palette.Blue);
            TextRenderer.DrawText(g, _session.CrushName, Theme.Tiny, new Rectangle((int)card.Right - 73, (int)card.Y + 15, 68, 18), Palette.Muted,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);

            List<DayStat> days = _stats.Days;
            if (days.Count == 0)
            {
                TextRenderer.DrawText(g, "这批记录没有时间戳，暂时无法绘制节奏。", Theme.Small,
                    new Rectangle((int)card.X + 18, (int)card.Y + 80, (int)card.Width - 36, 50), Palette.Muted, Ui.Wrap);
                return;
            }
            int left = (int)card.X + 36;
            int right = (int)card.Right - 18;
            int baseY = (int)card.Bottom - 42;
            int chartTop = (int)card.Y + 58;
            int chartH = baseY - chartTop;
            int max = 1;
            for (int i = 0; i < days.Count; i++) max = Math.Max(max, days[i].Mine + days[i].Crush);

            using (Pen grid = new Pen(Palette.Line))
            {
                grid.DashStyle = DashStyle.Dot;
                for (int i = 0; i <= 2; i++)
                {
                    int gy = chartTop + i * chartH / 2;
                    g.DrawLine(grid, left, gy, right, gy);
                }
            }
            int slot = (right - left) / Math.Max(1, days.Count);
            int barW = Math.Min(18, Math.Max(7, slot - 10));
            for (int i = 0; i < days.Count; i++)
            {
                DayStat d = days[i];
                int total = d.Mine + d.Crush;
                int cx = left + slot * i + slot / 2;
                int bh = total == 0 ? 0 : (int)Math.Round((double)total / max * (chartH - 6));
                int mineH = total == 0 ? 0 : (int)Math.Round((double)d.Mine / total * bh);
                int crushH = bh - mineH;
                if (total == 0)
                {
                    using (SolidBrush b = new SolidBrush(Palette.BgDeep)) g.FillRectangle(b, cx - barW / 2, baseY - 2, barW, 2);
                }
                else
                {
                    if (mineH > 0) Ui.FillRound(g, new RectangleF(cx - barW / 2, baseY - mineH, barW, mineH), 4f, Palette.Rose);
                    if (crushH > 0) Ui.FillRound(g, new RectangleF(cx - barW / 2, baseY - mineH - crushH, barW, crushH), 4f, Palette.Blue);
                }
                if (i % 2 == 0 || i == days.Count - 1)
                {
                    TextRenderer.DrawText(g, d.Label, Theme.Tiny, new Rectangle(cx - 18, baseY + 8, 36, 15), Palette.Muted,
                        TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
                }
            }
            TextRenderer.DrawText(g, "每天 " + max + " 条", Theme.Tiny, new Rectangle(left - 24, chartTop - 16, 84, 14), Palette.MutedLight,
                TextFormatFlags.Left | TextFormatFlags.NoPadding);
        }

        private void DrawSignals(Graphics g, RectangleF card)
        {
            Ui.Card(g, card, 14f, Palette.Card, Palette.Line);
            TextRenderer.DrawText(g, _session.CrushName + " 的投入信号", Theme.H3,
                new Rectangle((int)card.X + 18, (int)card.Y + 14, (int)card.Width - 36, 24), Palette.Ink,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);
            TextRenderer.DrawText(g, "本地统计 · 不含 AI 推断", Theme.Tiny,
                new Rectangle((int)card.X + 18, (int)card.Y + 38, (int)card.Width - 36, 16), Palette.Muted,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);

            int y = (int)card.Y + 64;
            int init = _stats.MineInitiations + _stats.CrushInitiations;
            double initShare = init == 0 ? 0.5 : (double)_stats.MineInitiations / init;
            DrawCompare(g, card, y, "主动开启", _stats.MineInitiations.ToString(), _stats.CrushInitiations.ToString(), initShare, init == 0);
            y += 40;
            DrawCompare(g, card, y, "平均字数", Math.Round(_stats.MineAvgChars).ToString(), Math.Round(_stats.CrushAvgChars).ToString(),
                _stats.MineAvgChars + _stats.CrushAvgChars == 0 ? 0.5 : _stats.MineAvgChars / (_stats.MineAvgChars + _stats.CrushAvgChars),
                _stats.MineAvgChars + _stats.CrushAvgChars == 0);
            y += 40;
            DrawCompare(g, card, y, "提问消息", _stats.MineQuestions.ToString(), _stats.CrushQuestions.ToString(),
                _stats.MineQuestions + _stats.CrushQuestions == 0 ? 0.5 : (double)_stats.MineQuestions / (_stats.MineQuestions + _stats.CrushQuestions),
                _stats.MineQuestions + _stats.CrushQuestions == 0);
            y += 38;
            TextRenderer.DrawText(g, "中位回复", Theme.Small, new Rectangle((int)card.X + 18, y, 68, 20), Palette.Muted,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, "我 " + (_stats.MineMedianReplySec > 0 ? Fmt.Duration(_stats.MineMedianReplySec) : "—"),
                Theme.SmallBold, new Rectangle((int)card.X + 96, y, (int)card.Width - 116, 20), Palette.Rose,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);
            TextRenderer.DrawText(g, "TA " + (_stats.CrushMedianReplySec > 0 ? Fmt.Duration(_stats.CrushMedianReplySec) : "—"),
                Theme.SmallBold, new Rectangle((int)card.X + 96, y + 18, (int)card.Width - 116, 20), Palette.Blue,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);
        }

        private void DrawCompare(Graphics g, RectangleF card, int y, string label, string mineText, string crushText, double mineShare, bool empty)
        {
            TextRenderer.DrawText(g, label, Theme.Small, new Rectangle((int)card.X + 18, y, 68, 18), Palette.Muted,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, "我 " + mineText, Theme.Tiny, new Rectangle((int)card.X + 96, y, 60, 18), Palette.Rose,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, "TA " + crushText, Theme.Tiny, new Rectangle((int)card.X + 162, y, 60, 18), Palette.Blue,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);
            int bx = (int)card.X + 96;
            int bw = (int)card.Width - 116;
            Ui.FillRound(g, new RectangleF(bx, y + 21, bw, 5), 2.5f, Palette.BgDeep);
            if (!empty)
            {
                int mw = Math.Max(2, (int)(bw * mineShare));
                Ui.FillRound(g, new RectangleF(bx, y + 21, mw, 5), 2.5f, Palette.Rose);
                Ui.FillRound(g, new RectangleF(bx + mw, y + 21, Math.Max(2, bw - mw), 5), 2.5f, Palette.Blue);
            }
        }

        private void DrawHours(Graphics g, RectangleF card)
        {
            Ui.Card(g, card, 14f, Palette.Card, Palette.Line);
            TextRenderer.DrawText(g, "24 小时活跃分布", Theme.H3,
                new Rectangle((int)card.X + 18, (int)card.Y + 14, (int)card.Width - 36, 24), Palette.Ink,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            int max = 1;
            int peak = 0;
            for (int i = 0; i < 24; i++)
            {
                if (_stats.Hourly[i] > max) { max = _stats.Hourly[i]; peak = i; }
            }
            TextRenderer.DrawText(g, "高峰 " + peak.ToString("00") + ":00", Theme.Tiny,
                new Rectangle((int)card.X + 18, (int)card.Y + 38, 110, 16), Palette.Muted,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            int left = (int)card.X + 20;
            int right = (int)card.Right - 20;
            int baseY = (int)card.Bottom - 36;
            int top = (int)card.Y + 66;
            int slot = (right - left) / 24;
            int barW = Math.Max(4, slot - 5);
            for (int i = 0; i < 24; i++)
            {
                int h = _stats.Hourly[i] == 0 ? 2 : Math.Max(4, (int)Math.Round((double)_stats.Hourly[i] / max * (baseY - top)));
                Color c = i == peak ? Palette.Amber : (i >= 23 || i < 6 ? Palette.Peach : Palette.Rose);
                int x = left + i * slot + (slot - barW) / 2;
                Ui.FillRound(g, new RectangleF(x, baseY - h, barW, h), barW / 2f, c);
                if (i % 6 == 0) TextRenderer.DrawText(g, i.ToString("00"), Theme.Tiny, new Rectangle(x - 8, baseY + 5, 24, 14), Palette.Muted,
                    TextFormatFlags.HorizontalCenter | TextFormatFlags.NoPadding);
            }
            TextRenderer.DrawText(g, "00", Theme.Tiny, new Rectangle(left - 6, baseY + 5, 20, 14), Palette.Muted, TextFormatFlags.Left | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, "23", Theme.Tiny, new Rectangle(right - 18, baseY + 5, 20, 14), Palette.Muted, TextFormatFlags.Right | TextFormatFlags.NoPadding);
        }

        private void DrawKeywords(Graphics g, RectangleF card)
        {
            Ui.Card(g, card, 14f, Palette.Card, Palette.Line);
            TextRenderer.DrawText(g, "高频信号词", Theme.H3,
                new Rectangle((int)card.X + 18, (int)card.Y + 14, (int)card.Width - 36, 24), Palette.Ink,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, "只做词频，不代替语境", Theme.Tiny,
                new Rectangle((int)card.X + 18, (int)card.Y + 38, (int)card.Width - 36, 16), Palette.Muted,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            if (_stats.Keywords.Count == 0)
            {
                TextRenderer.DrawText(g, "没有命中预设的信号词。", Theme.Small,
                    new Rectangle((int)card.X + 18, (int)card.Y + 72, (int)card.Width - 36, 40), Palette.Muted, Ui.Wrap);
                return;
            }
            int x = (int)card.X + 18;
            int y = (int)card.Y + 68;
            int right = (int)card.Right - 18;
            int max = Math.Min(7, _stats.Keywords.Count);
            for (int i = 0; i < max; i++)
            {
                KeywordStat k = _stats.Keywords[i];
                string text = k.Word + " " + k.Total;
                Size size = TextRenderer.MeasureText(g, text, Theme.Small, new Size(200, 24), TextFormatFlags.NoPadding);
                int cw = size.Width + 20;
                if (x + cw > right) { x = (int)card.X + 18; y += 32; }
                Color fill = k.Crush > k.Mine ? Palette.BlueSoft : Palette.RoseSoft;
                Color fore = k.Crush > k.Mine ? Palette.Blue : Palette.RoseDark;
                Ui.FillRound(g, new RectangleF(x, y, cw, 25), 12.5f, fill);
                TextRenderer.DrawText(g, text, Theme.Small, new Rectangle(x, y, cw, 25), fore, Ui.Center);
                x += cw + 8;
            }
        }

        private void DrawObservations(Graphics g, RectangleF card)
        {
            Ui.Card(g, card, 14f, Palette.Card, Palette.Line);
            TextRenderer.DrawText(g, "本地观察", Theme.H3,
                new Rectangle((int)card.X + 18, (int)card.Y + 12, 120, 24), Palette.Ink,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, "不需要 API", Theme.Tiny,
                new Rectangle((int)card.X + 90, (int)card.Y + 14, (int)card.Width - 110, 20), Palette.Muted,
                TextFormatFlags.Right | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            int y = (int)card.Y + 42;
            int max = Math.Min(2, _stats.Observations.Count);
            for (int i = 0; i < max; i++)
            {
                Ui.Dot(g, card.X + 22, y + 5, 5, Palette.Rose);
                int h = Ui.Measure(g, _stats.Observations[i], Theme.Small, (int)card.Width - 70, Ui.Wrap).Height;
                TextRenderer.DrawText(g, _stats.Observations[i], Theme.Small,
                    new Rectangle((int)card.X + 36, y - 2, (int)card.Width - 56, h + 4), Palette.InkSoft, Ui.Wrap);
                y += h + 9;
            }
        }

        private void PaintEmpty(Graphics g)
        {
            int w = ContentWidth;
            RectangleF card = new RectangleF(0, 0, w, Math.Max(380, ClientSize.Height - 4));
            Ui.Card(g, card, 16f, Palette.Card, Palette.Line);
            using (Pen p = new Pen(Palette.LineStrong, 1.5f))
            {
                p.DashStyle = DashStyle.Dash;
                g.DrawEllipse(p, w / 2f - 42, 54, 84, 84);
            }
            using (GraphicsPath hp = Ui.Heart(new RectangleF(w / 2f - 15, 86, 30, 26)))
            using (SolidBrush b = new SolidBrush(Color.FromArgb(246, 213, 218)))
                g.FillPath(b, hp);
            bool imageOnly = _session != null && _session.Media != null && _session.Media.Count > 0;
            TextRenderer.DrawText(g, imageOnly ? "这次只有图片" : "还没有可以看的对话", Theme.H2,
                new Rectangle(0, 164, w, 30), Palette.Ink, Ui.Center);
            TextRenderer.DrawText(g, imageOnly
                    ? "这份档案没有可计算的文字统计。\n回到分析台查看视觉报告和逐图解读。"
                    : "完成一次分析后，这里会出现双方的消息量、回复节奏、\n主动性与高频词。全部由本地计算，不额外调用 API。", Theme.Small,
                new Rectangle(24, 202, w - 48, 50), Palette.Muted, Ui.WrapCenter);
        }
    }
}
