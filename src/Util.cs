using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace CrushLens
{
    public static class Json
    {
        private static JavaScriptSerializer _serializer;

        private static JavaScriptSerializer Serializer
        {
            get
            {
                if (_serializer == null)
                {
                    _serializer = new JavaScriptSerializer();
                    _serializer.MaxJsonLength = int.MaxValue;
                    _serializer.RecursionLimit = 200;
                }
                return _serializer;
            }
        }

        public static string Serialize(object value)
        {
            return Serializer.Serialize(value);
        }

        public static T Deserialize<T>(string json)
        {
            return Serializer.Deserialize<T>(json);
        }

        public static object DeserializeObject(string json)
        {
            return Serializer.DeserializeObject(json);
        }

        public static string ExtractJsonObject(string text)
        {
            if (text == null) return "";
            string s = text.Trim();
            if (s.StartsWith("```", StringComparison.Ordinal))
            {
                int nl = s.IndexOf('\n');
                if (nl >= 0) s = s.Substring(nl + 1);
                int fence = s.LastIndexOf("```", StringComparison.Ordinal);
                if (fence >= 0) s = s.Substring(0, fence);
                s = s.Trim();
            }
            int first = s.IndexOf('{');
            int last = s.LastIndexOf('}');
            if (first >= 0 && last > first)
            {
                s = s.Substring(first, last - first + 1);
            }
            return s;
        }

        public static Dictionary<string, object> TryObject(string text)
        {
            string candidate = ExtractJsonObject(text);
            if (string.IsNullOrEmpty(candidate)) return null;
            try
            {
                Dictionary<string, object> d = Serializer.Deserialize<Dictionary<string, object>>(candidate);
                if (d != null) return d;
            }
            catch
            {
            }
            string repaired = Regex.Replace(candidate, @",\s*([}\]])", "$1");
            repaired = Regex.Replace(repaired, @"[\u201c\u201d]", "\"");
            try
            {
                return Serializer.Deserialize<Dictionary<string, object>>(repaired);
            }
            catch
            {
                return null;
            }
        }

        public static object Get(Dictionary<string, object> d, string key)
        {
            if (d == null || key == null) return null;
            object value;
            if (d.TryGetValue(key, out value)) return value;
            foreach (KeyValuePair<string, object> pair in d)
            {
                if (string.Equals(pair.Key, key, StringComparison.OrdinalIgnoreCase))
                    return pair.Value;
            }
            return null;
        }

        public static string Str(Dictionary<string, object> d, string key)
        {
            object v = Get(d, key);
            if (v == null) return "";
            return Convert.ToString(v, CultureInfo.InvariantCulture).Trim();
        }

        public static int Int(Dictionary<string, object> d, string key, int fallback)
        {
            object v = Get(d, key);
            if (v == null) return fallback;
            try
            {
                if (v is string)
                {
                    string s = ((string)v).Trim();
                    if (s.EndsWith("%", StringComparison.Ordinal)) s = s.Substring(0, s.Length - 1);
                    double parsed;
                    if (double.TryParse(s, NumberStyles.Any, CultureInfo.InvariantCulture, out parsed))
                        return (int)Math.Round(parsed);
                    return fallback;
                }
                return Convert.ToInt32(v, CultureInfo.InvariantCulture);
            }
            catch
            {
                return fallback;
            }
        }

        public static List<object> Array(Dictionary<string, object> d, string key)
        {
            object v = Get(d, key);
            List<object> result = new List<object>();
            if (v == null) return result;
            IList list = v as IList;
            if (list != null)
            {
                for (int i = 0; i < list.Count; i++) result.Add(list[i]);
            }
            return result;
        }

        public static Dictionary<string, object> AsObject(object value)
        {
            return value as Dictionary<string, object>;
        }
    }

    public static class Fmt
    {
        public static readonly CultureInfo Cn = CultureInfo.GetCultureInfo("zh-CN");

        public static string Number(int n)
        {
            return n.ToString("N0", Cn);
        }

        public static string Percent(double ratio)
        {
            return (ratio * 100.0).ToString("0", Cn) + "%";
        }

        public static string ShortDate(long unixMs)
        {
            if (unixMs <= 0) return "时间未知";
            DateTime t = TimeUtil.FromMs(unixMs);
            return t.ToString("M 月 d 日", Cn);
        }

        public static string FullDate(long unixMs)
        {
            if (unixMs <= 0) return "时间未知";
            return TimeUtil.FromMs(unixMs).ToString("yyyy 年 M 月 d 日 HH:mm", Cn);
        }

        public static string Clock(long unixMs)
        {
            if (unixMs <= 0) return "";
            return TimeUtil.FromMs(unixMs).ToString("HH:mm", Cn);
        }

        public static string Ago(long unixMs)
        {
            if (unixMs <= 0) return "";
            TimeSpan span = DateTime.Now - TimeUtil.FromMs(unixMs);
            if (span.TotalMinutes < 1) return "刚刚";
            if (span.TotalMinutes < 60) return ((int)span.TotalMinutes) + " 分钟前";
            if (span.TotalHours < 24) return ((int)span.TotalHours) + " 小时前";
            if (span.TotalDays < 30) return ((int)span.TotalDays) + " 天前";
            return ShortDate(unixMs);
        }

        public static string Duration(double seconds)
        {
            if (seconds <= 0 || double.IsNaN(seconds) || double.IsInfinity(seconds)) return "—";
            if (seconds < 60) return Math.Round(seconds).ToString("0", Cn) + " 秒";
            if (seconds < 3600) return Math.Round(seconds / 60.0).ToString("0", Cn) + " 分钟";
            if (seconds < 86400) return (seconds / 3600.0).ToString("0.#", Cn) + " 小时";
            return (seconds / 86400.0).ToString("0.#", Cn) + " 天";
        }

        public static string Truncate(string text, int max)
        {
            if (string.IsNullOrEmpty(text)) return "";
            text = text.Replace("\r", " ").Replace("\n", " ").Trim();
            if (text.Length <= max) return text;
            return text.Substring(0, Math.Max(0, max - 1)) + "…";
        }

        public static string Plural(int count, string unit)
        {
            return count.ToString("N0", Cn) + " " + unit;
        }

        public static string FileStamp()
        {
            return DateTime.Now.ToString("yyyyMMdd_HHmm", CultureInfo.InvariantCulture);
        }
    }

    public static class TimeUtil
    {
        public static DateTime FromMs(long ms)
        {
            try
            {
                return DateTimeOffset.FromUnixTimeMilliseconds(ms).ToLocalTime().DateTime;
            }
            catch
            {
                return DateTime.MinValue;
            }
        }

        public static long ToMs(DateTime local)
        {
            try
            {
                DateTime unspecified = DateTime.SpecifyKind(local, DateTimeKind.Unspecified);
                TimeSpan offset = TimeZoneInfo.Local.GetUtcOffset(unspecified);
                return new DateTimeOffset(unspecified, offset).ToUnixTimeMilliseconds();
            }
            catch
            {
                return 0;
            }
        }

        public static long NowMs()
        {
            return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }

        public static string DayKey(DateTime local)
        {
            return local.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }
    }

    public static class TextKit
    {
        public static string ReadAllTextSmart(string path)
        {
            byte[] bytes = File.ReadAllBytes(path);
            if (bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF)
                return Encoding.UTF8.GetString(bytes, 3, bytes.Length - 3);
            if (bytes.Length >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE)
                return Encoding.Unicode.GetString(bytes, 2, bytes.Length - 2);
            if (bytes.Length >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF)
                return Encoding.BigEndianUnicode.GetString(bytes, 2, bytes.Length - 2);

            try
            {
                UTF8Encoding strict = new UTF8Encoding(false, true);
                return strict.GetString(bytes);
            }
            catch
            {
                try
                {
                    return Encoding.GetEncoding(936).GetString(bytes);
                }
                catch
                {
                    return Encoding.UTF8.GetString(bytes);
                }
            }
        }

        public static string SafeFileName(string name)
        {
            if (string.IsNullOrEmpty(name)) return "CrushLens_report";
            foreach (char c in Path.GetInvalidFileNameChars())
                name = name.Replace(c, '_');
            name = name.Replace(" ", "");
            if (name.Length > 60) name = name.Substring(0, 60);
            return name;
        }

        public static string Html(string text)
        {
            if (text == null) return "";
            return WebUtility.HtmlEncode(text).Replace("\r\n", "\n").Replace("\n", "<br/>");
        }

        public static string OneLine(string text)
        {
            if (text == null) return "";
            return Regex.Replace(text.Replace("\r", " ").Replace("\n", " "), @"\s+", " ").Trim();
        }

        public static bool IsLocalEndpoint(string url)
        {
            try
            {
                Uri u = new Uri(url);
                string h = u.Host.ToLowerInvariant();
                return h == "localhost" || h == "127.0.0.1" || h == "::1" || h.EndsWith(".local", StringComparison.Ordinal);
            }
            catch
            {
                return false;
            }
        }

        public static string NormalizeOpenAIBase(string baseUrl)
        {
            string b = (baseUrl ?? "").Trim();
            while (b.EndsWith("/", StringComparison.Ordinal)) b = b.Substring(0, b.Length - 1);
            if (b.EndsWith("/chat/completions", StringComparison.OrdinalIgnoreCase)) return b;
            return b + "/chat/completions";
        }

        public static string NormalizeModelsUrl(string baseUrl)
        {
            string b = (baseUrl ?? "").Trim();
            while (b.EndsWith("/", StringComparison.Ordinal)) b = b.Substring(0, b.Length - 1);
            if (b.EndsWith("/chat/completions", StringComparison.OrdinalIgnoreCase))
                b = b.Substring(0, b.Length - "/chat/completions".Length);
            if (b.EndsWith("/models", StringComparison.OrdinalIgnoreCase)) return b;
            return b + "/models";
        }

        public static string Clip(string text, int max)
        {
            if (text == null) return "";
            if (text.Length <= max) return text;
            return text.Substring(0, max);
        }
    }

    public static class AppInfo
    {
        public const string Name = "CrushLens";
        public const string ChineseName = "心动镜";
        public const string Version = "1.0.0";
        public const string Tagline = "本地聊天好感度分析";
    }

    public static class Log
    {
        private static readonly object Sync = new object();

        public static void Write(string message)
        {
            try
            {
                AppPaths.EnsureData();
                string path = Path.Combine(AppPaths.DataDir, "app.log");
                FileInfo fi = new FileInfo(path);
                if (fi.Exists && fi.Length > 1024 * 1024)
                {
                    try { File.Delete(path); } catch { }
                }
                File.AppendAllText(path,
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) + "  " + message + Environment.NewLine,
                    new UTF8Encoding(false));
            }
            catch
            {
            }
        }

        public static void Error(string context, Exception ex)
        {
            if (ex == null)
            {
                Write("ERROR " + context);
                return;
            }
            Write("ERROR " + context + " :: " + ex.GetType().Name + " :: " + ex.Message);
        }
    }

    public static class Native
    {
        public const int WM_NCLBUTTONDOWN = 0xA1;
        public const int HT_CAPTION = 0x2;
        public const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;

        [DllImport("user32.dll")]
        public static extern bool ReleaseCapture();

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        public static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern bool SetProcessDPIAware();

        [DllImport("dwmapi.dll")]
        public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

        [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
        public static extern int SetCurrentProcessExplicitAppUserModelID(string appId);

        public static void EnableRoundedCorners(IntPtr handle)
        {
            try
            {
                int value = 2;
                DwmSetWindowAttribute(handle, DWMWA_WINDOW_CORNER_PREFERENCE, ref value, sizeof(int));
            }
            catch
            {
            }
        }

        public static void DragWindow(IntPtr handle)
        {
            ReleaseCapture();
            SendMessage(handle, WM_NCLBUTTONDOWN, (IntPtr)HT_CAPTION, IntPtr.Zero);
        }
    }
}
