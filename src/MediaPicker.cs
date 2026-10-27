using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Windows.Forms;

namespace CrushLens
{
    public class MediaItem
    {
        public string FileName = "";
        public string OriginalName = "";
        public string MimeType = "image/jpeg";
        public int Width;
        public int Height;
        public long Size;
        public byte[] Data;
        public Bitmap Thumb;

        public ChatMedia ToChatMedia()
        {
            ChatMedia m = new ChatMedia();
            m.FileName = FileName;
            m.OriginalName = OriginalName;
            m.MimeType = MimeType;
            m.Width = Width;
            m.Height = Height;
            m.Size = Size;
            m.Data = Data;
            return m;
        }

        public void Dispose()
        {
            if (Thumb != null)
            {
                Thumb.Dispose();
                Thumb = null;
            }
        }
    }

    public static class MediaUtil
    {
        public const int MaxCount = 6;
        public const int MaxFileBytes = 24 * 1024 * 1024;
        public const int MaxEdge = 1400;

        public static bool IsImageFile(string path)
        {
            string ext = Path.GetExtension(path ?? "").ToLowerInvariant();
            return ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".bmp" || ext == ".gif";
        }

        public static string FileFilter()
        {
            return "图片 / 表情包 (*.png;*.jpg;*.jpeg;*.bmp;*.gif)|*.png;*.jpg;*.jpeg;*.bmp;*.gif|所有文件 (*.*)|*.*";
        }

        public static MediaItem FromFile(string path, out string error)
        {
            error = "";
            try
            {
                FileInfo fi = new FileInfo(path);
                if (!fi.Exists) { error = "文件不存在。"; return null; }
                if (fi.Length > MaxFileBytes) { error = "图片超过 24 MB，建议先压缩。"; return null; }
                if (!IsImageFile(path)) { error = "这张图片的格式暂不支持（支持 PNG / JPG / BMP / GIF）。"; return null; }
                using (Image source = Image.FromFile(path))
                {
                    return Build(source, path, fi.Length, out error);
                }
            }
            catch (Exception ex)
            {
                Log.Error("读取图片失败", ex);
                error = "无法读取这张图片：" + ex.Message;
                return null;
            }
        }

        public static MediaItem FromChatMedia(ChatMedia media, out string error)
        {
            error = "";
            if (media == null || media.Data == null || media.Data.Length == 0)
            {
                error = "图片附件文件缺失。";
                return null;
            }
            try
            {
                using (MemoryStream ms = new MemoryStream(media.Data))
                using (Image source = Image.FromStream(ms))
                {
                    MediaItem item = Build(source, media.OriginalName, media.Size, out error);
                    if (item == null) return null;
                    item.FileName = media.FileName;
                    item.OriginalName = media.OriginalName;
                    item.Data = media.Data;
                    item.Size = media.Data.Length;
                    item.Width = media.Width > 0 ? media.Width : item.Width;
                    item.Height = media.Height > 0 ? media.Height : item.Height;
                    return item;
                }
            }
            catch (Exception ex)
            {
                Log.Error("加载图片附件失败", ex);
                error = "无法加载已保存的图片附件。";
                return null;
            }
        }

        private static MediaItem Build(Image source, string originalName, long originalBytes, out string error)
        {
            error = "";
            int sw = source.Width;
            int sh = source.Height;
            if (sw < 1 || sh < 1) { error = "图片尺寸无效。"; return null; }
            double scale = Math.Min(1.0, (double)MaxEdge / Math.Max(sw, sh));
            int w = Math.Max(1, (int)Math.Round(sw * scale));
            int h = Math.Max(1, (int)Math.Round(sh * scale));

            byte[] jpeg;
            using (Bitmap canvas = new Bitmap(w, h, PixelFormat.Format24bppRgb))
            {
                using (Graphics g = Graphics.FromImage(canvas))
                {
                    g.Clear(Color.White);
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.SmoothingMode = SmoothingMode.HighQuality;
                    g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    g.DrawImage(source, new Rectangle(0, 0, w, h));
                }
                using (MemoryStream ms = new MemoryStream())
                {
                    EncoderParameters ep = new EncoderParameters(1);
                    ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 88L);
                    ImageCodecInfo codec = FindJpegCodec();
                    if (codec != null) canvas.Save(ms, codec, ep);
                    else canvas.Save(ms, ImageFormat.Jpeg);
                    jpeg = ms.ToArray();
                }
            }

            MediaItem item = new MediaItem();
            item.FileName = "img_" + Guid.NewGuid().ToString("N").Substring(0, 10) + ".jpg";
            item.OriginalName = string.IsNullOrEmpty(originalName) ? "image.jpg" : Path.GetFileName(originalName);
            item.MimeType = "image/jpeg";
            item.Width = w;
            item.Height = h;
            item.Size = jpeg.Length;
            item.Data = jpeg;
            item.Thumb = MakeThumb(jpeg);
            return item;
        }

        private static Bitmap MakeThumb(byte[] jpeg)
        {
            using (MemoryStream ms = new MemoryStream(jpeg))
            using (Image image = Image.FromStream(ms))
            {
                Bitmap thumb = new Bitmap(54, 54, PixelFormat.Format32bppArgb);
                using (Graphics g = Graphics.FromImage(thumb))
                {
                    g.Clear(Palette.CardSoft);
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    double scale = Math.Max(54.0 / image.Width, 54.0 / image.Height);
                    int w = (int)Math.Ceiling(image.Width * scale);
                    int h = (int)Math.Ceiling(image.Height * scale);
                    int x = (54 - w) / 2;
                    int y = (54 - h) / 2;
                    g.DrawImage(image, new Rectangle(x, y, w, h));
                }
                return thumb;
            }
        }

        private static ImageCodecInfo FindJpegCodec()
        {
            ImageCodecInfo[] codecs = ImageCodecInfo.GetImageEncoders();
            for (int i = 0; i < codecs.Length; i++)
                if (codecs[i].FormatID == ImageFormat.Jpeg.Guid) return codecs[i];
            return null;
        }
    }

    public class MediaPicker : Control
    {
        public event EventHandler Changed;
        public Action<string> Notify;

        private readonly List<MediaItem> _items = new List<MediaItem>();
        private int _hoverAdd;
        private int _hoverDelete = -1;
        private bool _hoverAny;

        public MediaPicker()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                     ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
            BackColor = Palette.Card;
            Height = 82;
            AllowDrop = true;
            DragEnter += PickDragEnter;
            DragDrop += PickDragDrop;
        }

        public int Count
        {
            get { return _items.Count; }
        }

        public List<MediaItem> Items
        {
            get { return _items; }
        }

        public List<ChatMedia> ToChatMedia()
        {
            List<ChatMedia> list = new List<ChatMedia>();
            for (int i = 0; i < _items.Count; i++) list.Add(_items[i].ToChatMedia());
            return list;
        }

        public void Clear()
        {
            for (int i = 0; i < _items.Count; i++) _items[i].Dispose();
            _items.Clear();
            _hoverDelete = -1;
            Invalidate();
            if (Changed != null) Changed(this, EventArgs.Empty);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                for (int i = 0; i < _items.Count; i++) _items[i].Dispose();
                _items.Clear();
            }
            base.Dispose(disposing);
        }

        public void AddPaths(IWin32Window owner, string[] paths)
        {
            if (paths == null) return;
            int added = 0;
            List<string> errors = new List<string>();
            for (int i = 0; i < paths.Length; i++)
            {
                if (_items.Count >= MediaUtil.MaxCount)
                {
                    errors.Add("最多附 " + MediaUtil.MaxCount + " 张图片，其余已忽略。");
                    break;
                }
                string error;
                MediaItem item = MediaUtil.FromFile(paths[i], out error);
                if (item == null)
                {
                    if (!string.IsNullOrEmpty(error)) errors.Add(Path.GetFileName(paths[i]) + "：" + error);
                    continue;
                }
                _items.Add(item);
                added++;
            }
            if (added > 0)
            {
                Invalidate();
                if (Changed != null) Changed(this, EventArgs.Empty);
            }
            if (errors.Count > 0)
            {
                string msg = string.Join("\r\n", errors.ToArray());
                if (owner != null) UiDialog.Warn(owner, "部分图片没有添加", msg);
                else if (Notify != null) Notify(Fmt.Truncate(msg, 80));
            }
        }

        public void SetFromSession(List<ChatMedia> media)
        {
            Clear();
            if (media == null) return;
            for (int i = 0; i < media.Count; i++)
            {
                string error;
                MediaItem item = MediaUtil.FromChatMedia(media[i], out error);
                if (item != null) _items.Add(item);
            }
            Invalidate();
            if (Changed != null) Changed(this, EventArgs.Empty);
        }

        private void OpenPicker()
        {
            if (_items.Count >= MediaUtil.MaxCount)
            {
                if (Notify != null) Notify("最多附 6 张图片。");
                return;
            }
            using (OpenFileDialog dlg = new OpenFileDialog())
            {
                dlg.Title = "选择聊天截图 / 表情包";
                dlg.Filter = MediaUtil.FileFilter();
                dlg.Multiselect = true;
                if (dlg.ShowDialog(FindForm()) != DialogResult.OK) return;
                AddPaths(FindForm(), dlg.FileNames);
            }
        }

        private Rectangle TileRect(int index)
        {
            return new Rectangle(index * 62, 23, 54, 54);
        }

        private Rectangle AddRect
        {
            get { return new Rectangle(_items.Count * 62, 23, 54, 54); }
        }

        private Rectangle DeleteRect(int index)
        {
            Rectangle t = TileRect(index);
            return new Rectangle(t.Right - 8, t.Top - 6, 15, 15);
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            int hd = -1;
            for (int i = 0; i < _items.Count; i++)
                if (DeleteRect(i).Contains(e.Location)) hd = i;
            bool ha = AddRect.Contains(e.Location) && _items.Count < MediaUtil.MaxCount;
            if (hd != _hoverDelete || ha != (_hoverAdd == 1) || !_hoverAny)
            {
                _hoverDelete = hd;
                _hoverAdd = ha ? 1 : 0;
                _hoverAny = true;
                Cursor = (hd >= 0 || ha) ? Cursors.Hand : Cursors.Default;
                Invalidate();
            }
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            base.OnMouseLeave(e);
            _hoverAny = false;
            _hoverAdd = 0;
            _hoverDelete = -1;
            Cursor = Cursors.Default;
            Invalidate();
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            if (e.Button != MouseButtons.Left) return;
            for (int i = 0; i < _items.Count; i++)
            {
                if (DeleteRect(i).Contains(e.Location))
                {
                    _items[i].Dispose();
                    _items.RemoveAt(i);
                    _hoverDelete = -1;
                    Invalidate();
                    if (Changed != null) Changed(this, EventArgs.Empty);
                    return;
                }
            }
            if (AddRect.Contains(e.Location) && _items.Count < MediaUtil.MaxCount) OpenPicker();
        }

        private void PickDragEnter(object sender, DragEventArgs e)
        {
            if (e.Data != null && e.Data.GetDataPresent(DataFormats.FileDrop))
            {
                string[] files = e.Data.GetData(DataFormats.FileDrop) as string[];
                if (files != null)
                {
                    for (int i = 0; i < files.Length; i++)
                        if (MediaUtil.IsImageFile(files[i])) { e.Effect = DragDropEffects.Copy; return; }
                }
            }
        }

        private void PickDragDrop(object sender, DragEventArgs e)
        {
            if (e.Data == null || !e.Data.GetDataPresent(DataFormats.FileDrop)) return;
            string[] files = e.Data.GetData(DataFormats.FileDrop) as string[];
            if (files != null) AddPaths(FindForm(), files);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.Clear(BackColor);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            TextRenderer.DrawText(g, "图片 / 表情包", Theme.SmallBold, new Rectangle(0, 0, 120, 18), Palette.Ink,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, "可选 · 需模型支持视觉 · 最多 6 张", Theme.Tiny,
                new Rectangle(84, 0, Math.Max(120, Width - 180), 18), Palette.Muted,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, _items.Count + " / " + MediaUtil.MaxCount, Theme.Tiny,
                new Rectangle(Width - 50, 0, 50, 18), Palette.Muted,
                TextFormatFlags.Right | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);

            for (int i = 0; i < _items.Count; i++)
            {
                Rectangle r = TileRect(i);
                using (GraphicsPath path = Ui.Rounded(r, 8f))
                {
                    GraphicsState state = g.Save();
                    g.SetClip(path);
                    g.DrawImage(_items[i].Thumb, r);
                    g.Restore(state);
                }
                Ui.StrokeRound(g, new RectangleF(r.X + 0.5f, r.Y + 0.5f, r.Width - 1, r.Height - 1), 8f, Palette.LineStrong, 1f);
                Rectangle del = DeleteRect(i);
                Ui.FillRound(g, del, 7.5f, _hoverDelete == i ? Palette.RoseDark : Color.FromArgb(175, 40, 32, 38));
                using (Pen p = new Pen(Palette.White, 1.2f))
                {
                    g.DrawLine(p, del.X + 5, del.Y + 5, del.Right - 5, del.Bottom - 5);
                    g.DrawLine(p, del.Right - 5, del.Y + 5, del.X + 5, del.Bottom - 5);
                }
            }

            if (_items.Count < MediaUtil.MaxCount)
            {
                Rectangle add = AddRect;
                using (Pen p = new Pen(_hoverAdd == 1 ? Palette.Rose : Palette.LineStrong, 1.2f))
                {
                    p.DashStyle = DashStyle.Dash;
                    using (GraphicsPath path = Ui.Rounded(add, 8f)) g.DrawPath(p, path);
                }
                using (Pen p = new Pen(_hoverAdd == 1 ? Palette.Rose : Palette.Muted, 1.4f))
                {
                    g.DrawLine(p, add.X + 19, add.Y + 27, add.Right - 19, add.Y + 27);
                    g.DrawLine(p, add.X + 27, add.Y + 19, add.X + 27, add.Bottom - 19);
                }
                if (_items.Count == 0)
                {
                    TextRenderer.DrawText(g, "添加聊天截图或表情包，AI 会一起看", Theme.Tiny,
                        new Rectangle(add.Right + 12, 23, Math.Max(80, Width - add.Right - 12), 54), Palette.Muted,
                        TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);
                }
            }
        }
    }
}
