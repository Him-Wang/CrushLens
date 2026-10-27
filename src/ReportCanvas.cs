using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace CrushLens
{
    public enum ReportMode
    {
        Empty,
        Loading,
        Report,
        Error
    }

    public class ReportCanvas : ScrollCanvas
    {
        public event Action<string> CopyRequested;

        private ReportMode _mode = ReportMode.Empty;
        private AiReport _report;
        private ChatSession _session;
        private string _error = "";
        private string _phase = "正在读懂这段对话…";
        private readonly Timer _anim;
        private int _angle;
        private List<Section> _sections = new List<Section>();
        private int _layoutWidth = -1;
        private Rectangle _nextRect;

        private class Section
        {
            public string Kind;
            public int Y;
            public int H;
        }

        public ReportCanvas()
        {
            BackColor = Palette.Bg;
            _anim = new Timer();
            _anim.Interval = 45;
            _anim.Tick += delegate
            {
                _angle = (_angle + 6) % 360;
                Invalidate();
            };
        }

        public ReportMode Mode
        {
            get { return _mode; }
        }

        public void SetEmpty()
        {
            _mode = ReportMode.Empty;
            _report = null;
            _session = null;
            _anim.Stop();
            ScrollY = 0;
            SetContentHeight(ClientSize.Height);
            Invalidate();
        }

        public void SetLoading(string phase)
        {
            _mode = ReportMode.Loading;
            _phase = string.IsNullOrEmpty(phase) ? "正在读懂这段对话…" : phase;
            _report = null;
            _session = null;
            _anim.Start();
            ScrollY = 0;
            SetContentHeight(ClientSize.Height);
            Invalidate();
        }

        public void SetReport(ChatSession session)
        {
            _mode = ReportMode.Report;
            _session = session;
            _report = session != null ? session.Report : null;
            _anim.Stop();
            ScrollY = 0;
            _layoutWidth = -1;
            BuildLayout();
            Invalidate();
        }

        public void SetError(string message)
        {
            _mode = ReportMode.Error;
            _error = message ?? "未知错误";
            _report = null;
            _session = null;
            _anim.Stop();
            ScrollY = 0;
            SetContentHeight(ClientSize.Height);
            Invalidate();
        }

        public void UpdatePhase(string phase)
        {
            if (_mode != ReportMode.Loading) return;
            _phase = phase;
            Invalidate();
        }

        protected override void Recalc()
        {
            if (_mode == ReportMode.Report)
            {
                _layoutWidth = -1;
                BuildLayout();
            }
            else
            {
                SetContentHeight(ClientSize.Height);
            }
        }

        private void BuildLayout()
        {
            if (_mode != ReportMode.Report || _session == null || _report == null) return;
            int width = ContentWidth;
            if (width < 120) return;
            if (_layoutWidth == width) return;
            _layoutWidth = width;
            _sections.Clear();
            int y = 0;
            Add("score", ref y, 244);
            using (Graphics g = CreateGraphics())
            {
                int summaryText = Ui.Measure(g, _report.Summary, Theme.Body, width - 40, Ui.Wrap).Height;
                Add("summary", ref y, Math.Max(138, 60 + summaryText + 18));

                Add("dimensions", ref y, 242);

                if (_report.MediaNotes.Count > 0)
                {
                    int mediaH = 50;
                    for (int i = 0; i < _report.MediaNotes.Count; i++)
                    {
                        MediaNote n = _report.MediaNotes[i];
                        int dh = Ui.Measure(g, n.Description, Theme.Small, width - 66, Ui.Wrap).Height;
                        int sh = string.IsNullOrEmpty(n.Signal) ? 0 : Ui.Measure(g, n.Signal, Theme.Tiny, width - 66, Ui.Wrap).Height + 8;
                        mediaH += Math.Max(34, dh + sh + 16);
                    }
                    Add("media", ref y, Math.Max(96, mediaH + 8));
                }

                int signalsH = 50;
                for (int i = 0; i < _report.Signals.Count; i++)
                {
                    SignalItem s = _report.Signals[i];
                    int detailH = Ui.Measure(g, s.Detail, Theme.Small, width - 66, Ui.Wrap).Height;
                    int quoteH = string.IsNullOrEmpty(s.Quote) ? 0 : 24;
                    signalsH += 28 + detailH + quoteH + 18;
                }
                Add("signals", ref y, Math.Max(96, signalsH + 8));

                int cautionsH = 52;
                for (int i = 0; i < _report.Cautions.Count; i++)
                {
                    int ch = Ui.Measure(g, _report.Cautions[i], Theme.Small, width - 68, Ui.Wrap).Height;
                    cautionsH += Math.Max(34, ch + 16);
                }
                Add("cautions", ref y, Math.Max(90, cautionsH + 8));

                int reasonH = Ui.Measure(g, _report.ReplyGradeReason, Theme.Small, width - 105, Ui.Wrap).Height;
                int nextH = Ui.Measure(g, _report.NextMessage, Theme.Body, width - 70, Ui.Wrap).Height;
                int replyH = 62 + Math.Max(54, reasonH + 26) + 24 + Math.Max(58, nextH + 34) + 54;
                Add("reply", ref y, Math.Max(220, replyH));
            }
            SetContentHeight(y + 10);
        }

        private void Add(string kind, ref int y, int h)
        {
            Section s = new Section();
            s.Kind = kind;
            s.Y = y;
            s.H = h;
            _sections.Add(s);
            y += h + 12;
        }

        protected override void PaintContent(Graphics g)
        {
            if (_mode == ReportMode.Empty)
            {
                PaintEmpty(g);
                return;
            }
            if (_mode == ReportMode.Loading)
            {
                PaintLoading(g);
                return;
            }
            if (_mode == ReportMode.Error)
            {
                PaintError(g);
                return;
            }
            if (_session == null || _report == null) return;

            int width = ContentWidth;
            for (int i = 0; i < _sections.Count; i++)
            {
                Section s = _sections[i];
                if (s.Y + s.H < ScrollY - 20 || s.Y > ScrollY + ClientSize.Height + 20) continue;
                RectangleF card = new RectangleF(0, s.Y, width, s.H);
                Ui.Card(g, card, 14f, Palette.Card, Palette.Line);
                if (s.Kind == "score") PaintScore(g, card);
                else if (s.Kind == "summary") PaintSummary(g, card);
                else if (s.Kind == "dimensions") PaintDimensions(g, card);
                else if (s.Kind == "media") PaintMedia(g, card);
                else if (s.Kind == "signals") PaintSignals(g, card);
                else if (s.Kind == "cautions") PaintCautions(g, card);
                else if (s.Kind == "reply") PaintReply(g, card);
            }
        }

        private void PaintEmpty(Graphics g)
        {
            int w = ContentWidth;
            RectangleF card = new RectangleF(0, 0, w, Math.Max(400, ClientSize.Height - 4));
            Ui.Card(g, card, 16f, Palette.Card, Palette.Line);
            float cx = w / 2f;
            using (Pen p = new Pen(Palette.LineStrong, 1.5f))
            {
                p.DashStyle = DashStyle.Dash;
                g.DrawEllipse(p, cx - 48, 50, 96, 96);
            }
            using (GraphicsPath hp = Ui.Heart(new RectangleF(cx - 17, 87, 34, 30)))
            using (SolidBrush b = new SolidBrush(Color.FromArgb(245, 210, 216)))
                g.FillPath(b, hp);
            TextRenderer.DrawText(g, "先读懂，再靠近", Theme.H2, new Rectangle(0, 174, w, 30), Palette.Ink, Ui.Center);
            TextRenderer.DrawText(g, "粘贴一段聊天，CrushLens 会结合行为统计与 AI 判断，\n给你一份不夸张、可执行的好感度报告。", Theme.Small,
                new Rectangle(24, 212, w - 48, 48), Palette.Muted, Ui.WrapCenter);

            int sy = 286;
            DrawStep(g, w, sy, "01", "粘贴或导入聊天", "支持微信、QQ、WhatsApp 与通用文本");
            DrawStep(g, w, sy + 52, "02", "配置自己的 API Key", "密钥只留本机，AI 只收到本次节选");
            DrawStep(g, w, sy + 104, "03", "拿到报告与下一步", "好感度、六个维度、回复建议");

            RectangleF note = new RectangleF(20, sy + 172, w - 40, 54);
            Ui.FillRound(g, note, 10f, Palette.Bg);
            TextRenderer.DrawText(g, "本地统计始终可用；AI 报告需要一次真实 API 调用。", Theme.Tiny,
                new Rectangle((int)note.X + 12, (int)note.Y, (int)note.Width - 24, (int)note.Height),
                Palette.Muted, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        }

        private void DrawStep(Graphics g, int w, int y, string num, string title, string sub)
        {
            Ui.FillRound(g, new RectangleF(22, y, 28, 28), 8f, Palette.RoseSoft);
            TextRenderer.DrawText(g, num, Theme.SmallBold, new Rectangle(22, y, 28, 28), Palette.RoseDark, Ui.Center);
            TextRenderer.DrawText(g, title, Theme.SmallBold, new Rectangle(62, y - 2, w - 90, 18), Palette.Ink,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, sub, Theme.Tiny, new Rectangle(62, y + 17, w - 90, 18), Palette.Muted,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        }

        private void PaintLoading(Graphics g)
        {
            int w = ContentWidth;
            int h = Math.Max(400, ClientSize.Height - 4);
            RectangleF card = new RectangleF(0, 0, w, h);
            Ui.Card(g, card, 16f, Palette.Card, Palette.Line);
            float cx = w / 2f;
            float cy = 165;
            using (Pen track = new Pen(Palette.RoseSoft, 7f)) g.DrawEllipse(track, cx - 44, cy - 44, 88, 88);
            using (Pen p = new Pen(Palette.Rose, 7f))
            {
                p.StartCap = LineCap.Round;
                p.EndCap = LineCap.Round;
                g.DrawArc(p, cx - 44, cy - 44, 88, 88, _angle, 95);
            }
            using (GraphicsPath hp = Ui.Heart(new RectangleF(cx - 14, cy - 13, 28, 25)))
            using (SolidBrush b = new SolidBrush(Palette.RoseSoft))
                g.FillPath(b, hp);
            TextRenderer.DrawText(g, _phase, Theme.H3, new Rectangle(0, (int)cy + 68, w, 30), Palette.Ink, Ui.Center);
            TextRenderer.DrawText(g, "正在对照主动、回应、关心、开放、亲密与行动六类信号。\n通常需要 10–40 秒，请保持窗口开启。", Theme.Small,
                new Rectangle(24, (int)cy + 104, w - 48, 50), Palette.Muted, Ui.WrapCenter);
            Ui.FillRound(g, new RectangleF(28, cy + 174, w - 56, 44), 10f, Palette.RoseSoft);
            TextRenderer.DrawText(g, "本次聊天节选只会发送到你配置的 API。", Theme.Tiny,
                new Rectangle(40, (int)cy + 174, w - 80, 44), Palette.RoseDark, Ui.Center);
        }

        private void PaintError(Graphics g)
        {
            int w = ContentWidth;
            int h = Math.Max(400, ClientSize.Height - 4);
            Ui.Card(g, new RectangleF(0, 0, w, h), 16f, Palette.Card, Palette.Line);
            Ui.FillRound(g, new RectangleF(w / 2f - 24, 54, 48, 48), 24f, Palette.AmberSoft);
            TextRenderer.DrawText(g, "!", new Font(Theme.FontFamily, 20f, FontStyle.Bold),
                new Rectangle((int)(w / 2f - 24), 54, 48, 48), Palette.Amber, Ui.Center);
            TextRenderer.DrawText(g, "这次没有读到结果", Theme.H2, new Rectangle(0, 122, w, 30), Palette.Ink, Ui.Center);
            TextRenderer.DrawText(g, _error, Theme.Small, new Rectangle(26, 168, w - 52, 160), Palette.InkSoft, Ui.WrapCenter);
            TextRenderer.DrawText(g, "检查 API 设置、Key 权限与账户额度后，\n点击左上角的「编辑记录」再试一次。", Theme.Tiny,
                new Rectangle(26, 342, w - 52, 50), Palette.Muted, Ui.WrapCenter);
        }

        private void PaintScore(Graphics g, RectangleF card)
        {
            TextRenderer.DrawText(g, "好感度  /  AFFECTION SCORE", Theme.Tiny,
                new Rectangle((int)card.X + 20, (int)card.Y + 16, (int)card.Width - 40, 18), Palette.Muted,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);

            if (_session.IsDemo)
            {
                Rectangle demo = new Rectangle((int)card.Right - 86, (int)card.Y + 14, 66, 22);
                Ui.Pill(g, demo, "示例报告", Theme.Tiny, Palette.BgDeep, Palette.Muted);
            }

            int score = Scoring.GetScore(_report);
            float ringX = card.X + 22;
            float ringY = card.Y + 52;
            float ring = 104;
            using (Pen track = new Pen(Palette.BgDeep, 9f)) g.DrawEllipse(track, ringX, ringY, ring, ring);
            Color sc = Ui.ScoreColor(score);
            using (Pen arc = new Pen(sc, 9f))
            {
                arc.StartCap = LineCap.Round;
                arc.EndCap = LineCap.Round;
                g.DrawArc(arc, ringX, ringY, ring, ring, 135, 270f * score / 100f);
            }
            TextRenderer.DrawText(g, score.ToString(), Theme.Score,
                new Rectangle((int)ringX, (int)ringY + 22, (int)ring, 50), sc, Ui.Center);
            TextRenderer.DrawText(g, "/ 100", Theme.Tiny,
                new Rectangle((int)ringX, (int)ringY + 68, (int)ring, 16), Palette.Muted, Ui.Center);
            TextRenderer.DrawText(g, "互动好感信号", Theme.Tiny,
                new Rectangle((int)ringX - 8, (int)ringY + 112, (int)ring + 16, 16), Palette.Muted, Ui.Center);

            int rx = (int)card.X + 150;
            int rw = (int)card.Width - 170;
            Rectangle trend = new Rectangle(rx, (int)card.Y + 48, 78, 24);
            Ui.Pill(g, trend, Ui.TrendArrow(_report.Trend) + " " + _report.Trend, Theme.Tiny, Ui.ScoreSoft(score), sc);
            TextRenderer.DrawText(g, _report.Label, Theme.H2, new Rectangle(rx, (int)card.Y + 80, rw, 30), Palette.Ink,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);
            TextRenderer.DrawText(g, _report.Headline, Theme.MediumBold, new Rectangle(rx, (int)card.Y + 116, rw, 48),
                Palette.InkSoft, TextFormatFlags.Left | TextFormatFlags.WordBreak | TextFormatFlags.NoPadding);
            string meta = Scoring.Explain(_report) + " · " + (_report.AnalyzedAt > 0 ? Fmt.Ago(_report.AnalyzedAt) + "生成" : "刚刚生成");
            if (_report.MediaNotes.Count > 0) meta += " · 图 " + _report.MediaNotes.Count;
            TextRenderer.DrawText(g, meta, Theme.Tiny, new Rectangle(rx, (int)card.Y + 174, rw, 18), Palette.Muted,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);

            using (GraphicsPath hp = Ui.Heart(new RectangleF(card.Right - 52, card.Bottom - 40, 24, 21)))
            using (SolidBrush b = new SolidBrush(Color.FromArgb(249, 229, 233)))
                g.FillPath(b, hp);
        }

        private void PaintSummary(Graphics g, RectangleF card)
        {
            TextRenderer.DrawText(g, "AI 总览", Theme.H3, new Rectangle((int)card.X + 20, (int)card.Y + 18, (int)card.Width - 40, 24),
                Palette.Ink, TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            Rectangle text = new Rectangle((int)card.X + 20, (int)card.Y + 52, (int)card.Width - 40, (int)card.Height - 64);
            TextRenderer.DrawText(g, _report.Summary, Theme.Body, text, Palette.InkSoft, Ui.Wrap);
        }

        private void PaintDimensions(Graphics g, RectangleF card)
        {
            TextRenderer.DrawText(g, "六个维度", Theme.H3, new Rectangle((int)card.X + 20, (int)card.Y + 16, 140, 24),
                Palette.Ink, TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, "行为信号，不是心理测量", Theme.Tiny,
                new Rectangle((int)card.X + 120, (int)card.Y + 18, (int)card.Width - 140, 20), Palette.Muted,
                TextFormatFlags.Right | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);

            string[] keys = new string[] { "initiative", "engagement", "care", "openness", "intimacy", "action" };
            string[] labels = new string[] { "主动延续", "回应投入", "关心体贴", "自我开放", "亲密表达", "实际行动" };
            Color[] colors = new Color[] { Palette.Rose, Color.FromArgb(225, 125, 108), Palette.Peach, Palette.Amber, Color.FromArgb(180, 119, 142), Palette.Blue };
            int y = (int)card.Y + 48;
            for (int i = 0; i < keys.Length; i++)
            {
                int val = 0;
                if (!_report.Dimensions.TryGetValue(keys[i], out val)) val = Scoring.GetScore(_report);
                TextRenderer.DrawText(g, labels[i], Theme.Small, new Rectangle((int)card.X + 20, y, 66, 22), Palette.InkSoft,
                    TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
                int bx = (int)card.X + 88;
                int bw = (int)card.Width - 88 - 48;
                Ui.FillRound(g, new RectangleF(bx, y + 9, bw, 6), 3f, Palette.BgDeep);
                Ui.FillRound(g, new RectangleF(bx, y + 9, Math.Max(2, bw * val / 100f), 6), 3f, colors[i]);
                TextRenderer.DrawText(g, val.ToString(), Theme.Tiny, new Rectangle(bx + bw + 8, y, 32, 22), Palette.Muted,
                    TextFormatFlags.Right | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
                y += 29;
            }
        }

        private void PaintMedia(Graphics g, RectangleF card)
        {
            TextRenderer.DrawText(g, "图片 / 表情包解读  /  VISUALS", Theme.Tiny,
                new Rectangle((int)card.X + 20, (int)card.Y + 16, (int)card.Width - 40, 20), Palette.Blue,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            int y = (int)card.Y + 44;
            for (int i = 0; i < _report.MediaNotes.Count; i++)
            {
                MediaNote n = _report.MediaNotes[i];
                Ui.FillRound(g, new RectangleF(card.X + 20, y + 1, 22, 18), 6f, Palette.BlueSoft);
                TextRenderer.DrawText(g, "图" + n.I, Theme.Tiny, new Rectangle((int)card.X + 20, y + 1, 22, 18), Palette.Blue, Ui.Center);
                int dh = Ui.Measure(g, n.Description, Theme.Small, (int)card.Width - 66, Ui.Wrap).Height;
                TextRenderer.DrawText(g, n.Description, Theme.Small,
                    new Rectangle((int)card.X + 50, y, (int)card.Width - 70, dh), Palette.InkSoft, Ui.Wrap);
                y += Math.Max(26, dh + 4);
                if (!string.IsNullOrEmpty(n.Signal))
                {
                    int sh = Ui.Measure(g, n.Signal, Theme.Tiny, (int)card.Width - 70, Ui.Wrap).Height;
                    Ui.FillRound(g, new RectangleF(card.X + 50, y + 2, card.Width - 70, sh + 8), 6f, Palette.BlueSoft);
                    TextRenderer.DrawText(g, n.Signal, Theme.Tiny,
                        new Rectangle((int)card.X + 58, y + 5, (int)card.Width - 86, sh), Palette.Blue, Ui.Wrap);
                    y += sh + 14;
                }
                y += 10;
            }
        }

        private void PaintSignals(Graphics g, RectangleF card)
        {
            TextRenderer.DrawText(g, "心动信号  /  GREEN FLAGS", Theme.Tiny,
                new Rectangle((int)card.X + 20, (int)card.Y + 16, (int)card.Width - 40, 20), Palette.Green,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            int y = (int)card.Y + 44;
            if (_report.Signals.Count == 0)
            {
                TextRenderer.DrawText(g, "这次样本里没有足够明确的信号。", Theme.Small,
                    new Rectangle((int)card.X + 20, y, (int)card.Width - 40, 50), Palette.Muted, Ui.Wrap);
                return;
            }
            for (int i = 0; i < _report.Signals.Count; i++)
            {
                SignalItem s = _report.Signals[i];
                Ui.Dot(g, card.X + 22, y + 6, 7, Palette.Green);
                TextRenderer.DrawText(g, s.Title, Theme.SmallBold,
                    new Rectangle((int)card.X + 38, y, (int)card.Width - 58, 22), Palette.Ink,
                    TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);
                int detailH = Ui.Measure(g, s.Detail, Theme.Small, (int)card.Width - 66, Ui.Wrap).Height;
                TextRenderer.DrawText(g, s.Detail, Theme.Small,
                    new Rectangle((int)card.X + 38, y + 24, (int)card.Width - 66, detailH), Palette.InkSoft, Ui.Wrap);
                y += 30 + detailH;
                if (!string.IsNullOrEmpty(s.Quote))
                {
                    Ui.FillRound(g, new RectangleF(card.X + 38, y + 2, card.Width - 66, 22), 6f, Palette.GreenSoft);
                    TextRenderer.DrawText(g, "“" + Fmt.Truncate(s.Quote, 48) + "”", Theme.Tiny,
                        new Rectangle((int)card.X + 46, y + 2, (int)card.Width - 82, 22), Palette.Green,
                        TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);
                    y += 28;
                }
                y += 12;
            }
        }

        private void PaintCautions(Graphics g, RectangleF card)
        {
            TextRenderer.DrawText(g, "需要留心  /  WATCH OUT", Theme.Tiny,
                new Rectangle((int)card.X + 20, (int)card.Y + 16, (int)card.Width - 40, 20), Palette.Amber,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            int y = (int)card.Y + 44;
            if (_report.Cautions.Count == 0)
            {
                TextRenderer.DrawText(g, "暂未发现明显的风险信号，但仍请尊重真实边界。", Theme.Small,
                    new Rectangle((int)card.X + 20, y, (int)card.Width - 40, 50), Palette.Muted, Ui.Wrap);
                return;
            }
            for (int i = 0; i < _report.Cautions.Count; i++)
            {
                Ui.FillRound(g, new RectangleF(card.X + 20, y + 1, 18, 18), 9f, Palette.AmberSoft);
                TextRenderer.DrawText(g, (i + 1).ToString(), Theme.Tiny,
                    new Rectangle((int)card.X + 20, y + 1, 18, 18), Palette.Amber, Ui.Center);
                int h = Ui.Measure(g, _report.Cautions[i], Theme.Small, (int)card.Width - 68, Ui.Wrap).Height;
                TextRenderer.DrawText(g, _report.Cautions[i], Theme.Small,
                    new Rectangle((int)card.X + 46, y, (int)card.Width - 66, h), Palette.InkSoft, Ui.Wrap);
                y += Math.Max(32, h + 16);
            }
        }

        private void PaintReply(Graphics g, RectangleF card)
        {
            TextRenderer.DrawText(g, "怎么回  /  NEXT MOVE", Theme.Tiny,
                new Rectangle((int)card.X + 20, (int)card.Y + 16, (int)card.Width - 40, 20), Palette.Rose,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);

            int y = (int)card.Y + 48;
            Color gradeColor = GradeColor(_report.ReplyGrade);
            Ui.FillRound(g, new RectangleF(card.X + 20, y, 48, 48), 12f, Ui.ScoreSoft(Scoring.GetScore(_report)));
            TextRenderer.DrawText(g, _report.ReplyGrade, new Font(Theme.FontFamily, 18f, FontStyle.Bold),
                new Rectangle((int)card.X + 20, y, 48, 48), gradeColor, Ui.Center);
            TextRenderer.DrawText(g, "回复表现", Theme.SmallBold,
                new Rectangle((int)card.X + 78, y + 1, (int)card.Width - 100, 20), Palette.Ink,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            int reasonH = Ui.Measure(g, _report.ReplyGradeReason, Theme.Small, (int)card.Width - 105, Ui.Wrap).Height;
            TextRenderer.DrawText(g, _report.ReplyGradeReason, Theme.Small,
                new Rectangle((int)card.X + 78, y + 22, (int)card.Width - 100, reasonH), Palette.InkSoft, Ui.Wrap);
            y += Math.Max(58, reasonH + 34);

            TextRenderer.DrawText(g, "可以这样发", Theme.SmallBold,
                new Rectangle((int)card.X + 20, y, 100, 20), Palette.RoseDark,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            y += 24;
            int nextH = Ui.Measure(g, _report.NextMessage, Theme.Body, (int)card.Width - 70, Ui.Wrap).Height;
            RectangleF box = new RectangleF(card.X + 20, y, card.Width - 40, Math.Max(54, nextH + 28));
            Ui.FillRound(g, box, 10f, Palette.PeachSoft);
            Ui.FillRound(g, new RectangleF(box.X, box.Y + 10, 3, box.Height - 20), 1.5f, Palette.Peach);
            TextRenderer.DrawText(g, _report.NextMessage, Theme.Body,
                new Rectangle((int)box.X + 14, (int)box.Y + 10, (int)box.Width - 28, (int)box.Height - 18), Palette.Ink, Ui.Wrap);
            _nextRect = Rectangle.Round(box);
            TextRenderer.DrawText(g, "点击这段文字复制", Theme.Tiny,
                new Rectangle((int)box.X, (int)box.Bottom - 17, (int)box.Width - 10, 14), Palette.Muted,
                TextFormatFlags.Right | TextFormatFlags.Bottom | TextFormatFlags.NoPadding);
            y = (int)box.Bottom + 12;
            TextRenderer.DrawText(g, _report.Disclaimer, Theme.Tiny,
                new Rectangle((int)card.X + 20, y, (int)card.Width - 40, (int)card.Bottom - y - 10), Palette.Muted,
                TextFormatFlags.Left | TextFormatFlags.WordBreak | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);
        }

        private Color GradeColor(string grade)
        {
            if (string.IsNullOrEmpty(grade)) return Palette.Ink;
            char c = grade[0];
            if (c == 'S') return Palette.RoseDark;
            if (c == 'A') return Palette.Rose;
            if (c == 'B') return Palette.Amber;
            if (c == 'C') return Palette.Blue;
            return Palette.Muted;
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            if (_mode == ReportMode.Report && _report != null && !string.IsNullOrEmpty(_report.NextMessage))
            {
                Point pt = new Point(e.X, e.Y + ScrollY);
                if (_nextRect.Contains(pt))
                {
                    try
                    {
                        Clipboard.SetText(_report.NextMessage);
                        if (CopyRequested != null) CopyRequested("已复制下一句；发不发，仍由你决定。");
                    }
                    catch
                    {
                        if (CopyRequested != null) CopyRequested("复制失败，请手动选择文本。");
                    }
                }
            }
        }
    }
}
