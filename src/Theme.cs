using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Windows.Forms;

namespace CrushLens
{
    public static class Palette
    {
        public static readonly Color Bg = Color.FromArgb(247, 243, 239);
        public static readonly Color BgDeep = Color.FromArgb(242, 236, 231);
        public static readonly Color Card = Color.FromArgb(255, 253, 252);
        public static readonly Color CardSoft = Color.FromArgb(251, 247, 244);
        public static readonly Color Ink = Color.FromArgb(43, 35, 40);
        public static readonly Color InkSoft = Color.FromArgb(74, 62, 68);
        public static readonly Color Muted = Color.FromArgb(139, 126, 132);
        public static readonly Color MutedLight = Color.FromArgb(174, 161, 166);
        public static readonly Color Line = Color.FromArgb(234, 225, 219);
        public static readonly Color LineStrong = Color.FromArgb(221, 209, 202);
        public static readonly Color Rose = Color.FromArgb(224, 91, 114);
        public static readonly Color RoseDark = Color.FromArgb(190, 65, 86);
        public static readonly Color RoseDeep = Color.FromArgb(156, 48, 68);
        public static readonly Color RoseSoft = Color.FromArgb(251, 234, 238);
        public static readonly Color Peach = Color.FromArgb(244, 184, 155);
        public static readonly Color PeachSoft = Color.FromArgb(253, 243, 236);
        public static readonly Color Green = Color.FromArgb(76, 148, 118);
        public static readonly Color GreenSoft = Color.FromArgb(235, 246, 240);
        public static readonly Color Amber = Color.FromArgb(194, 133, 62);
        public static readonly Color AmberSoft = Color.FromArgb(252, 242, 226);
        public static readonly Color Blue = Color.FromArgb(95, 126, 157);
        public static readonly Color BlueSoft = Color.FromArgb(237, 243, 248);
        public static readonly Color Sidebar = Color.FromArgb(33, 25, 32);
        public static readonly Color SidebarSoft = Color.FromArgb(44, 33, 42);
        public static readonly Color SidebarText = Color.FromArgb(240, 230, 235);
        public static readonly Color SidebarMuted = Color.FromArgb(159, 139, 149);
        public static readonly Color SidebarLine = Color.FromArgb(64, 49, 59);
        public static readonly Color White = Color.White;
    }

    public static class Theme
    {
        public const string FontFamily = "Microsoft YaHei UI";

        public static readonly Font Tiny = new Font(FontFamily, 7.5f, FontStyle.Regular, GraphicsUnit.Point);
        public static readonly Font Small = new Font(FontFamily, 8.5f, FontStyle.Regular, GraphicsUnit.Point);
        public static readonly Font SmallBold = new Font(FontFamily, 8.5f, FontStyle.Bold, GraphicsUnit.Point);
        public static readonly Font Body = new Font(FontFamily, 9.5f, FontStyle.Regular, GraphicsUnit.Point);
        public static readonly Font BodyBold = new Font(FontFamily, 9.5f, FontStyle.Bold, GraphicsUnit.Point);
        public static readonly Font Medium = new Font(FontFamily, 10.5f, FontStyle.Regular, GraphicsUnit.Point);
        public static readonly Font MediumBold = new Font(FontFamily, 10.5f, FontStyle.Bold, GraphicsUnit.Point);
        public static readonly Font H3 = new Font(FontFamily, 12f, FontStyle.Bold, GraphicsUnit.Point);
        public static readonly Font H2 = new Font(FontFamily, 15f, FontStyle.Bold, GraphicsUnit.Point);
        public static readonly Font H1 = new Font(FontFamily, 21f, FontStyle.Bold, GraphicsUnit.Point);
        public static readonly Font Score = new Font(FontFamily, 34f, FontStyle.Bold, GraphicsUnit.Point);
        public static readonly Font Brand = new Font(FontFamily, 15f, FontStyle.Bold, GraphicsUnit.Point);
        public static readonly Font BrandSub = new Font(FontFamily, 8f, FontStyle.Regular, GraphicsUnit.Point);
    }

    public static class Ui
    {
        public const TextFormatFlags Wrap = TextFormatFlags.WordBreak | TextFormatFlags.NoPadding | TextFormatFlags.TextBoxControl;
        public const TextFormatFlags WrapCenter = TextFormatFlags.WordBreak | TextFormatFlags.NoPadding | TextFormatFlags.HorizontalCenter | TextFormatFlags.TextBoxControl;
        public const TextFormatFlags Left = TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis;
        public const TextFormatFlags Center = TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding;

        public static GraphicsPath Rounded(RectangleF r, float radius)
        {
            GraphicsPath path = new GraphicsPath();
            float d = Math.Max(1f, Math.Min(radius * 2f, Math.Min(r.Width, r.Height)));
            if (d <= 1f)
            {
                path.AddRectangle(r);
                return path;
            }
            path.AddArc(r.X, r.Y, d, d, 180, 90);
            path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        public static void FillRound(Graphics g, RectangleF r, float radius, Color color)
        {
            SmoothingMode old = g.SmoothingMode;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (GraphicsPath path = Rounded(r, radius))
            using (SolidBrush brush = new SolidBrush(color))
                g.FillPath(brush, path);
            g.SmoothingMode = old;
        }

        public static void StrokeRound(Graphics g, RectangleF r, float radius, Color color, float width)
        {
            SmoothingMode old = g.SmoothingMode;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (GraphicsPath path = Rounded(r, radius))
            using (Pen pen = new Pen(color, width))
                g.DrawPath(pen, path);
            g.SmoothingMode = old;
        }

        public static void Card(Graphics g, RectangleF r, float radius, Color fill, Color border)
        {
            FillRound(g, r, radius, fill);
            if (border != Color.Empty)
            {
                RectangleF inner = new RectangleF(r.X + 0.5f, r.Y + 0.5f, r.Width - 1f, r.Height - 1f);
                StrokeRound(g, inner, radius, border, 1f);
            }
        }

        public static void Text(Graphics g, string value, Font font, Rectangle r, Color color, TextFormatFlags flags)
        {
            TextRenderer.DrawText(g, value ?? "", font, r, color, flags);
        }

        public static Size Measure(Graphics g, string value, Font font, int width, TextFormatFlags flags)
        {
            if (width < 1) width = 1;
            return TextRenderer.MeasureText(g, value ?? "", font, new Size(width, int.MaxValue), flags);
        }

        public static int TextHeight(Graphics g, string value, Font font, int width)
        {
            return Measure(g, value, font, width, Wrap).Height;
        }

        public static void Pill(Graphics g, Rectangle r, string text, Font font, Color fill, Color fore)
        {
            FillRound(g, r, r.Height / 2f, fill);
            Text(g, text, font, r, fore, Center);
        }

        public static GraphicsPath Heart(RectangleF r)
        {
            GraphicsPath path = new GraphicsPath();
            int n = 180;
            PointF[] pts = new PointF[n];
            float cx = r.X + r.Width / 2f;
            float cy = r.Y + r.Height * 0.49f;
            float sx = r.Width / 33f;
            float sy = r.Height / 30f;
            for (int i = 0; i < n; i++)
            {
                double t = Math.PI * 2 * i / n;
                double x = 16.0 * Math.Pow(Math.Sin(t), 3);
                double y = 13.0 * Math.Cos(t) - 5.0 * Math.Cos(2 * t) - 2.0 * Math.Cos(3 * t) - Math.Cos(4 * t);
                pts[i] = new PointF((float)(cx + x * sx), (float)(cy - y * sy));
            }
            path.AddPolygon(pts);
            return path;
        }

        public static void Logo(Graphics g, Rectangle r)
        {
            FillRound(g, r, r.Width * 0.28f, Palette.SidebarSoft);
            RectangleF hr = new RectangleF(r.X + r.Width * 0.23f, r.Y + r.Height * 0.20f, r.Width * 0.54f, r.Height * 0.56f);
            using (GraphicsPath hp = Heart(hr))
            using (LinearGradientBrush brush = new LinearGradientBrush(hr, Palette.Rose, Palette.Peach, 55f))
                g.FillPath(brush, hp);
        }

        public static void Dot(Graphics g, float x, float y, float size, Color color)
        {
            SmoothingMode old = g.SmoothingMode;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (SolidBrush b = new SolidBrush(color))
                g.FillEllipse(b, x, y, size, size);
            g.SmoothingMode = old;
        }

        public static Color ScoreColor(int score)
        {
            if (score >= 75) return Palette.Rose;
            if (score >= 55) return Palette.Amber;
            return Palette.Blue;
        }

        public static Color ScoreSoft(int score)
        {
            if (score >= 75) return Palette.RoseSoft;
            if (score >= 55) return Palette.AmberSoft;
            return Palette.BlueSoft;
        }

        public static string TrendArrow(string trend)
        {
            if (trend == "升温中") return "↗";
            if (trend == "降温中") return "↘";
            if (trend == "稳定") return "→";
            return "·";
        }

        public static void DrawScrollThumb(Graphics g, Control c, int scrollY, int contentHeight)
        {
            if (contentHeight <= c.ClientSize.Height + 2) return;
            int trackTop = 6;
            int trackHeight = c.ClientSize.Height - 12;
            int thumbHeight = Math.Max(36, (int)((double)c.ClientSize.Height / contentHeight * trackHeight));
            int maxScroll = Math.Max(1, contentHeight - c.ClientSize.Height);
            int thumbTop = trackTop + (int)((double)Math.Max(0, Math.Min(scrollY, maxScroll)) / maxScroll * (trackHeight - thumbHeight));
            Rectangle r = new Rectangle(c.ClientSize.Width - 9, thumbTop, 4, thumbHeight);
            FillRound(g, r, 2f, Color.FromArgb(205, 190, 183));
        }

        public static string Initial(string name)
        {
            if (string.IsNullOrEmpty(name)) return "?";
            return name.Substring(0, 1).ToUpperInvariant();
        }

        public static Color Lighten(Color c, float amount)
        {
            return Color.FromArgb(c.A,
                (int)Math.Min(255, c.R + (255 - c.R) * amount),
                (int)Math.Min(255, c.G + (255 - c.G) * amount),
                (int)Math.Min(255, c.B + (255 - c.B) * amount));
        }

        public static Color Darken(Color c, float amount)
        {
            return Color.FromArgb(c.A,
                (int)Math.Max(0, c.R * (1 - amount)),
                (int)Math.Max(0, c.G * (1 - amount)),
                (int)Math.Max(0, c.B * (1 - amount)));
        }
    }
}
