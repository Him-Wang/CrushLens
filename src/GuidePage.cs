using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace CrushLens
{
    public class GuidePage : UserControl
    {
        public Action SettingsRequested;
        public Action OpenDataDir;

        private readonly Label _title;
        private readonly Label _subtitle;
        private readonly PillButton _settingsButton;
        private readonly PillButton _folderButton;
        private readonly GuideCanvas _canvas;

        public GuidePage()
        {
            BackColor = Palette.Bg;
            DoubleBuffered = true;

            _title = new Label();
            _title.Text = "使用指南";
            _title.Font = Theme.H1;
            _title.ForeColor = Palette.Ink;
            _title.BackColor = Color.Transparent;
            _title.AutoSize = false;
            Controls.Add(_title);

            _subtitle = new Label();
            _subtitle.Text = "关于 API、隐私、数据目录，以及这份报告不该被用来做什么。";
            _subtitle.Font = Theme.Small;
            _subtitle.ForeColor = Palette.Muted;
            _subtitle.BackColor = Color.Transparent;
            _subtitle.AutoSize = false;
            Controls.Add(_subtitle);

            _settingsButton = new PillButton();
            _settingsButton.Text = "配置 API";
            _settingsButton.Kind = ButtonKind.Primary;
            _settingsButton.Click += delegate { if (SettingsRequested != null) SettingsRequested(); };
            Controls.Add(_settingsButton);

            _folderButton = new PillButton();
            _folderButton.Text = "打开数据目录";
            _folderButton.Kind = ButtonKind.Secondary;
            _folderButton.Click += delegate { if (OpenDataDir != null) OpenDataDir(); };
            Controls.Add(_folderButton);

            _canvas = new GuideCanvas();
            _canvas.OpenDataDir += delegate { if (OpenDataDir != null) OpenDataDir(); };
            _canvas.SettingsRequested += delegate { if (SettingsRequested != null) SettingsRequested(); };
            Controls.Add(_canvas);

            Resize += PageResize;
            PageResize(null, EventArgs.Empty);
        }

        private void PageResize(object sender, EventArgs e)
        {
            int pad = 26;
            _title.SetBounds(pad, 14, 300, 36);
            _subtitle.SetBounds(pad + 2, 54, Math.Max(300, Width - pad * 2 - 340), 22);
            _settingsButton.SetBounds(Width - pad - 104, 26, 104, 36);
            _folderButton.SetBounds(Width - pad - 104 - 128, 26, 120, 36);
            _canvas.SetBounds(pad, 104, Width - pad * 2, Math.Max(200, Height - 124));
        }
    }

    public class GuideCanvas : ScrollCanvas
    {
        public event Action OpenDataDir;
        public event Action SettingsRequested;

        private Rectangle _keyLink = Rectangle.Empty;
        private Rectangle _folderLink = Rectangle.Empty;
        private Rectangle _settingsLink = Rectangle.Empty;

        public GuideCanvas()
        {
            BackColor = Palette.Bg;
            SetContentHeight(900);
        }

        protected override void Recalc()
        {
            SetContentHeight(930);
        }

        protected override void PaintContent(Graphics g)
        {
            int w = ContentWidth;

            // Hero
            RectangleF hero = new RectangleF(0, 0, w, 190);
            Ui.Card(g, hero, 16f, Palette.Card, Palette.Line);
            TextRenderer.DrawText(g, "CRUSHLENS / 本地优先", Theme.Tiny,
                new Rectangle(24, 22, w - 48, 18), Palette.Rose,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, "先读懂，再靠近。", Theme.H1,
                new Rectangle(24, 44, w - 48, 42), Palette.Ink,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, "这是一个把聊天记录变成行为观察与沟通建议的小工具。它不是读心术，也不替你决定关系。", Theme.Small,
                new Rectangle(24, 90, w - 60, 24), Palette.Muted,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            DrawStepChip(g, 24, 128, "01", "聊天/截图");
            DrawStepChip(g, 190, 128, "02", "配置 API");
            DrawStepChip(g, 356, 128, "03", "读懂信号");

            int y = 206;
            RectangleF api = new RectangleF(0, y, w, 226);
            Ui.Card(g, api, 14f, Palette.Card, Palette.Line);
            TextRenderer.DrawText(g, "API 怎么接", Theme.H3,
                new Rectangle(22, y + 18, 140, 24), Palette.Ink,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, "只支持 OpenAI 兼容的 Chat Completions 接口。填 Base URL、模型 ID 与自己的 Key；\n本机模型（如 Ollama、LM Studio）可以留空 Key；图片分析需要视觉模型。", Theme.Small,
                new Rectangle(22, y + 48, w - 44, 40), Palette.InkSoft, Ui.Wrap);
            DrawProvider(g, 22, y + 98, "DeepSeek", "api.deepseek.com/v1");
            DrawProvider(g, 22, y + 128, "通义千问", "dashscope.aliyuncs.com/compatible-mode/v1");
            DrawProvider(g, 22, y + 158, "Kimi / 智谱 / 硅基流动", "各自兼容接口");
            DrawProvider(g, 22, y + 188, "OpenAI / OpenRouter", "api.openai.com/v1 等");

            int rx = Math.Max(320, w - 260);
            _keyLink = new Rectangle(rx, y + 98, 220, 24);
            TextRenderer.DrawText(g, "去 DeepSeek 控制台申请 Key  →", Theme.SmallBold, _keyLink, Palette.RoseDark,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, "不要求把 Key 发到任何对话里。", Theme.Tiny,
                new Rectangle(rx, y + 126, 226, 20), Palette.Muted,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            _settingsLink = new Rectangle(rx, y + 158, 180, 30);
            Ui.FillRound(g, _settingsLink, 8f, Palette.RoseSoft);
            TextRenderer.DrawText(g, "打开模型设置", Theme.SmallBold, _settingsLink, Palette.RoseDark, Ui.Center);

            y += 242;
            RectangleF privacy = new RectangleF(0, y, w, 188);
            Ui.Card(g, privacy, 14f, Palette.Card, Palette.Line);
            TextRenderer.DrawText(g, "数据会去哪里？", Theme.H3,
                new Rectangle(22, y + 18, 200, 24), Palette.Ink,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            DrawBullet(g, 22, y + 54, w - 44, "聊天原文和图片只写入程序旁的 CrushLens_Data；删除档案即删除文件。", Palette.Green);
            DrawBullet(g, 22, y + 82, w - 44, "分析时只把本次文字节选和已选图片发送到你填写的 API；没有遥测。", Palette.Green);
            DrawBullet(g, 22, y + 110, w - 44, "API Key 使用 Windows DPAPI 加密保存，绑定当前 Windows 用户；不写入业务数据到注册表或 AppData。", Palette.Green);
            DrawBullet(g, 22, y + 138, w - 44, "把整个程序文件夹放到 U 盘即可带走；更换电脑后需要重新填写 Key。", Palette.Green);
            _folderLink = new Rectangle(22, y + 164, 120, 18);
            TextRenderer.DrawText(g, "打开数据目录  →", Theme.Tiny, _folderLink, Palette.RoseDark,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);

            y += 204;
            RectangleF limits = new RectangleF(0, y, w, 176);
            Ui.Card(g, limits, 14f, Palette.Card, Palette.Line);
            TextRenderer.DrawText(g, "边界与提醒", Theme.H3,
                new Rectangle(22, y + 18, 200, 24), Palette.Ink,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, "可以看", Theme.SmallBold,
                new Rectangle(24, y + 54, 60, 20), Palette.Green,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, "谁更主动、回复节奏、话题投入、是否愿意落实见面。", Theme.Small,
                new Rectangle(80, y + 54, w - 110, 20), Palette.InkSoft,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);
            TextRenderer.DrawText(g, "不要看", Theme.SmallBold,
                new Rectangle(24, y + 82, 60, 20), Palette.Amber,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, "不要用它读心、给关系下判决，更不要拿来设计操控或试探底线。", Theme.Small,
                new Rectangle(80, y + 82, w - 110, 20), Palette.InkSoft,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);
            TextRenderer.DrawText(g, "分数不是对方喜欢你的概率。图片可能模糊或被误读，看不清就写不确定；明确拒绝就是拒绝，尊重边界比提高分数重要。", Theme.Tiny,
                new Rectangle(24, y + 116, w - 48, 40), Palette.Muted, Ui.Wrap);

            y += 192;
            TextRenderer.DrawText(g, "功能灵感来自开源项目 Crush Monitor 与 ChatLab；本工具的界面与实现为独立编写。", Theme.Tiny,
                new Rectangle(0, y, w, 20), Palette.MutedLight,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, "CrushLens v1.2 · portable · 不安装、不写注册表、不上传云端", Theme.Tiny,
                new Rectangle(0, y + 20, w, 20), Palette.MutedLight,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        }

        private void DrawStepChip(Graphics g, int x, int y, string n, string text)
        {
            Rectangle r = new Rectangle(x, y, 150, 38);
            Ui.FillRound(g, r, 10f, Palette.Bg);
            Ui.FillRound(g, new Rectangle(x + 10, y + 8, 21, 21), 6f, Palette.RoseSoft);
            TextRenderer.DrawText(g, n, Theme.Tiny, new Rectangle(x + 10, y + 8, 21, 21), Palette.RoseDark, Ui.Center);
            TextRenderer.DrawText(g, text, Theme.SmallBold, new Rectangle(x + 38, y, 102, 38), Palette.Ink,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        }

        private void DrawProvider(Graphics g, int x, int y, string name, string url)
        {
            Ui.Dot(g, x, y + 8, 5, Palette.Peach);
            TextRenderer.DrawText(g, name, Theme.Tiny, new Rectangle(x + 12, y, 150, 18), Palette.Ink,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);
            TextRenderer.DrawText(g, url, Theme.Tiny, new Rectangle(x + 160, y, 260, 18), Palette.Muted,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);
        }

        private void DrawBullet(Graphics g, int x, int y, int w, string text, Color color)
        {
            Ui.Dot(g, x, y + 5, 5, color);
            TextRenderer.DrawText(g, text, Theme.Small, new Rectangle(x + 14, y - 2, w - 14, 24), Palette.InkSoft,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            Point pt = new Point(e.X, e.Y + ScrollY);
            bool hit = _keyLink.Contains(pt) || _folderLink.Contains(pt) || _settingsLink.Contains(pt);
            Cursor = hit ? Cursors.Hand : Cursors.Default;
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            Point pt = new Point(e.X, e.Y + ScrollY);
            if (_keyLink.Contains(pt))
            {
                try { System.Diagnostics.Process.Start("https://platform.deepseek.com/api_keys"); } catch { }
            }
            else if (_folderLink.Contains(pt))
            {
                if (OpenDataDir != null) OpenDataDir();
            }
            else if (_settingsLink.Contains(pt))
            {
                if (SettingsRequested != null) SettingsRequested();
            }
        }
    }
}
