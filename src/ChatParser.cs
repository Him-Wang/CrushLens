using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;

namespace CrushLens
{
    public class ParseResult
    {
        public List<ChatMessage> Messages = new List<ChatMessage>();
        public List<string> Names = new List<string>();
        public string Format = "文本";
        public string Warning = "";
        public string Raw = "";
    }

    public static class ChatParser
    {
        private static readonly Regex WhatsAppBracket = new Regex(
            @"^\[(\d{1,2}/\d{1,2}/\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?\s*[APap][Mm])\]\s*([^:]{1,40}):\s*(.*)$",
            RegexOptions.Compiled);

        private static readonly Regex WhatsAppDash = new Regex(
            @"^(\d{1,2}/\d{1,2}/\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?)\s+-\s+([^:]{1,40}):\s*(.*)$",
            RegexOptions.Compiled);

        private static readonly Regex BracketHeader = new Regex(
            @"^\[([^\]]{4,40})\]\s*([^:]{1,40}):\s*(.*)$",
            RegexOptions.Compiled);

        private static readonly Regex QqTimeHeader = new Regex(
            @"^([^:]{1,40}):\s*(\d{1,2}[-/]\d{1,2}(?:[-/]\d{2,4})?\s+\d{1,2}:\d{2}(?::\d{2})?)\s*$",
            RegexOptions.Compiled);

        private static readonly Regex NameTimeLine = new Regex(
            @"^([^:]{1,40}?)\s+(\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)\s*$",
            RegexOptions.Compiled);

        private static readonly Regex TimeNameHeader = new Regex(
            @"^\[?(\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)\]?\s+([^:]{1,40}):\s*(.*)$",
            RegexOptions.Compiled);

        private static readonly Regex GenericHeader = new Regex(
            @"^([^:]{1,40}):\s*(.*)$",
            RegexOptions.Compiled);

        private static readonly Regex TimePrefix = new Regex(
            @"^\[?(\d{2,4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?|\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?|\d{1,2}:\d{2}(?::\d{2})?)\]?\s+(.*)$",
            RegexOptions.Compiled);

        private static readonly Regex DateLine = new Regex(
            @"^\[?(\d{4}年\d{1,2}月\d{1,2}日|\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}月\d{1,2}日|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})[\s,]+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[APap][Mm])?\]?$",
            RegexOptions.Compiled);

        private static readonly Regex JustTime = new Regex(
            @"^\[?\d{1,2}:\d{2}(?::\d{2})?\]?$",
            RegexOptions.Compiled);

        private static readonly string[] SystemNames = new string[]
        {
            "系统", "系统消息", "微信团队", "QQ系统消息", "System", "system", "WhatsApp", "Telegram"
        };

        public static ParseResult Parse(string raw)
        {
            ParseResult result = new ParseResult();
            result.Raw = raw ?? "";
            string text = (raw ?? "").Replace("\r\n", "\n").Replace('\r', '\n').Trim('\uFEFF', '\0');
            if (string.IsNullOrWhiteSpace(text))
            {
                result.Warning = "内容为空。";
                return result;
            }

            string trimmed = text.TrimStart();
            bool jsonLike = trimmed.StartsWith("{", StringComparison.Ordinal) ||
                            (trimmed.StartsWith("[", StringComparison.Ordinal) && trimmed.Length > 1 &&
                             (trimmed[1] == '{' || trimmed[1] == '[' || trimmed[1] == '"'));
            if (jsonLike)
            {
                ParseResult json = TryParseJson(text);
                if (json != null && json.Messages.Count > 0)
                {
                    Finish(json);
                    return json;
                }
            }

            result = ParseLines(text);
            Finish(result);
            return result;
        }

        private static void Finish(ParseResult result)
        {
            Dictionary<string, int> counts = new Dictionary<string, int>();
            for (int i = 0; i < result.Messages.Count; i++)
            {
                ChatMessage m = result.Messages[i];
                m.Id = i + 1;
                m.Sender = (m.Sender ?? "").Trim();
                m.Content = (m.Content ?? "").Trim();
                if (!counts.ContainsKey(m.Sender)) counts[m.Sender] = 0;
                counts[m.Sender] = counts[m.Sender] + 1;
            }

            List<KeyValuePair<string, int>> pairs = new List<KeyValuePair<string, int>>(counts);
            pairs.Sort(delegate(KeyValuePair<string, int> a, KeyValuePair<string, int> b)
            {
                int c = b.Value.CompareTo(a.Value);
                if (c != 0) return c;
                return string.Compare(a.Key, b.Key, StringComparison.CurrentCulture);
            });
            result.Names.Clear();
            for (int i = 0; i < pairs.Count; i++)
            {
                if (pairs[i].Value > 0) result.Names.Add(pairs[i].Key);
            }

            int timestamped = 0;
            for (int i = 0; i < result.Messages.Count; i++)
                if (result.Messages[i].Timestamp > 0) timestamped++;

            if (result.Messages.Count == 0)
                result.Warning = "没有识别到聊天消息，请检查格式或先载入示例。";
            else if (result.Names.Count < 2)
                result.Warning = "只识别到一位发言人，请确认每条消息都带有昵称。";
            else if (timestamped == 0)
                result.Warning = "已识别消息，但没有识别到时间；时间趋势和回复速度将不可用。";
            else if (result.Messages.Count < 8)
                result.Warning = "消息较少，分析结果可能不够稳定。";
            else
                result.Warning = "";
        }

        private static ParseResult ParseLines(string text)
        {
            ParseResult result = new ParseResult();
            string[] lines = text.Split('\n');
            ChatMessage current = null;
            string format = "通用文本";

            for (int i = 0; i < lines.Length; i++)
            {
                string line = (lines[i] ?? "").TrimEnd();
                string t = line.Trim();
                if (t.Length == 0)
                {
                    if (current != null && current.Content.Length > 0) current.Content += "\n";
                    continue;
                }

                Match m = WhatsAppBracket.Match(t);
                if (m.Success)
                {
                    Flush(result, ref current);
                    format = "WhatsApp";
                    long waTs;
                    string waTime = m.Groups[1].Value + " " + m.Groups[2].Value;
                    TryParseTimestamp(waTime, out waTs);
                    Start(ref current, m.Groups[3].Value, m.Groups[4].Value, waTs, waTime);
                    continue;
                }

                m = WhatsAppDash.Match(t);
                if (m.Success)
                {
                    Flush(result, ref current);
                    format = "WhatsApp";
                    long waTs;
                    string waTime = m.Groups[1].Value + " " + m.Groups[2].Value;
                    TryParseTimestamp(waTime, out waTs);
                    Start(ref current, m.Groups[3].Value, m.Groups[4].Value, waTs, waTime);
                    continue;
                }

                m = QqTimeHeader.Match(t);
                if (m.Success)
                {
                    Flush(result, ref current);
                    format = "QQ / 时间行";
                    long qqTs;
                    TryParseTimestamp(m.Groups[2].Value, out qqTs);
                    Start(ref current, m.Groups[1].Value, "", qqTs, m.Groups[2].Value);
                    continue;
                }

                m = NameTimeLine.Match(t);
                if (m.Success && IsNameCandidate(m.Groups[1].Value))
                {
                    Flush(result, ref current);
                    format = "微信 / 昵称时间";
                    long ntTs;
                    TryParseTimestamp(m.Groups[2].Value, out ntTs);
                    Start(ref current, m.Groups[1].Value, "", ntTs, m.Groups[2].Value);
                    continue;
                }

                m = TimeNameHeader.Match(t);
                if (m.Success)
                {
                    Flush(result, ref current);
                    format = "通用文本 / 时间戳";
                    long tnTs;
                    TryParseTimestamp(m.Groups[1].Value, out tnTs);
                    Start(ref current, m.Groups[2].Value, m.Groups[3].Value, tnTs, m.Groups[1].Value);
                    continue;
                }

                m = BracketHeader.Match(t);
                if (m.Success && LooksLikeTimestamp(m.Groups[1].Value))
                {
                    Flush(result, ref current);
                    format = "通用文本 / 时间戳";
                    long brTs;
                    TryParseTimestamp(m.Groups[1].Value, out brTs);
                    Start(ref current, m.Groups[2].Value, m.Groups[3].Value, brTs, m.Groups[1].Value);
                    continue;
                }

                // WeChat desktop three-line form: name, timestamp, message.
                if (i + 1 < lines.Length && IsNameCandidate(t) && LooksLikeDateLine(lines[i + 1].Trim()))
                {
                    Flush(result, ref current);
                    format = "微信三行";
                    long wxTs;
                    TryParseTimestamp(lines[i + 1].Trim(), out wxTs);
                    Start(ref current, t, "", wxTs, lines[i + 1].Trim());
                    i++;
                    continue;
                }

                if (DateLine.IsMatch(t) || JustTime.IsMatch(t) || IsDateDivider(t))
                {
                    continue;
                }

                m = GenericHeader.Match(t);
                if (m.Success && IsNameCandidate(m.Groups[1].Value))
                {
                    string sender = m.Groups[1].Value.Trim();
                    string body = m.Groups[2].Value;
                    long gTs = 0;
                    string timeText = "";
                    string rest;
                    if (TryParseTimestampPrefix(body, out gTs, out rest))
                    {
                        body = rest;
                        timeText = "";
                        if (string.IsNullOrWhiteSpace(body) && i + 1 < lines.Length)
                        {
                            Flush(result, ref current);
                            Start(ref current, sender, "", gTs, timeText);
                            format = "QQ / 通用文本";
                            continue;
                        }
                    }
                    Flush(result, ref current);
                    Start(ref current, sender, body, gTs, timeText);
                    continue;
                }

                if (current != null)
                {
                    if (current.Content.Length > 0) current.Content += "\n";
                    current.Content += line.Trim();
                }
            }

            Flush(result, ref current);
            result.Format = format;
            return result;
        }

        private static void Start(ref ChatMessage current, string sender, string content, long timestamp, string timeText)
        {
            current = new ChatMessage();
            current.Sender = CleanSender(sender);
            current.Content = (content ?? "").Trim();
            current.Timestamp = timestamp;
            current.TimeText = timeText ?? "";
        }

        private static void Flush(ParseResult result, ref ChatMessage current)
        {
            if (current == null) return;
            current.Content = (current.Content ?? "").Trim();
            current.Sender = CleanSender(current.Sender);
            if (current.Content.Length > 0 && current.Sender.Length > 0 && !IsSystemSender(current.Sender))
                result.Messages.Add(current);
            current = null;
        }

        private static string CleanSender(string sender)
        {
            string s = (sender ?? "").Trim().Trim('"', '\'', '“', '”');
            s = Regex.Replace(s, @"\s+", " ");
            if (s.Length > 40) s = s.Substring(0, 40);
            return s;
        }

        private static bool IsNameCandidate(string value)
        {
            string s = (value ?? "").Trim();
            if (s.Length == 0 || s.Length > 40) return false;
            if (s.IndexOf(':') >= 0 || s.IndexOf('：') >= 0) return false;
            if (s.StartsWith("[", StringComparison.Ordinal) || s.StartsWith("(", StringComparison.Ordinal)) return false;
            if (s.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || s.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) return false;
            if (LooksLikeTimestamp(s)) return false;
            if (s == "图片" || s == "表情" || s == "语音" || s == "视频" || s == "文件") return false;
            return true;
        }

        private static bool IsSystemSender(string sender)
        {
            string s = (sender ?? "").Trim();
            for (int i = 0; i < SystemNames.Length; i++)
            {
                if (string.Equals(s, SystemNames[i], StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }

        private static bool LooksLikeDateLine(string value)
        {
            string s = (value ?? "").Trim();
            return DateLine.IsMatch(s) || LooksLikeTimestamp(s);
        }

        private static bool LooksLikeTimestamp(string value)
        {
            long ms;
            return TryParseTimestamp(value, out ms);
        }

        private static bool TryParseTimestampPrefix(string body, out long ms, out string rest)
        {
            ms = 0;
            rest = body ?? "";
            Match m = TimePrefix.Match((body ?? "").Trim());
            if (!m.Success) return false;
            if (!TryParseTimestamp(m.Groups[1].Value, out ms)) return false;
            rest = m.Groups[2].Value.Trim();
            return true;
        }

        private static bool IsDateDivider(string value)
        {
            string s = (value ?? "").Trim();
            if (s.Length > 40) return false;
            if (DateLine.IsMatch(s)) return true;
            if (s.EndsWith("的消息记录", StringComparison.Ordinal)) return true;
            if (s.StartsWith("以下", StringComparison.Ordinal)) return true;
            return false;
        }

        public static bool TryParseTimestamp(string value, out long ms)
        {
            ms = 0;
            string s = (value ?? "").Trim();
            if (s.Length == 0) return false;
            s = s.Trim('[', ']', '(', ')');
            s = Regex.Replace(s, @"\s+", " ");

            if (Regex.IsMatch(s, @"^\d{10}$"))
            {
                long sec;
                if (long.TryParse(s, out sec)) { ms = sec * 1000; return true; }
            }
            if (Regex.IsMatch(s, @"^\d{13}$"))
            {
                if (long.TryParse(s, out ms)) return true;
            }

            // Time only: use today's date.
            Match tm = Regex.Match(s, @"^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([APap][Mm])?$");
            if (tm.Success)
            {
                int hour = int.Parse(tm.Groups[1].Value, CultureInfo.InvariantCulture);
                int minute = int.Parse(tm.Groups[2].Value, CultureInfo.InvariantCulture);
                int second = tm.Groups[3].Success ? int.Parse(tm.Groups[3].Value, CultureInfo.InvariantCulture) : 0;
                string ap = tm.Groups[4].Value.ToLowerInvariant();
                if (ap == "pm" && hour < 12) hour += 12;
                if (ap == "am" && hour == 12) hour = 0;
                DateTime now = DateTime.Now;
                ms = TimeUtil.ToMs(new DateTime(now.Year, now.Month, now.Day, hour, minute, second));
                return true;
            }

            // Month/day without a year.
            Match md = Regex.Match(s, @"^(\d{1,2})[-/月](\d{1,2})日?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([APap][Mm])?$");
            if (md.Success && !Regex.IsMatch(s, @"^\d{1,2}[-/]\d{1,2}[-/]\d"))
            {
                int month = int.Parse(md.Groups[1].Value, CultureInfo.InvariantCulture);
                int day = int.Parse(md.Groups[2].Value, CultureInfo.InvariantCulture);
                int hour = int.Parse(md.Groups[3].Value, CultureInfo.InvariantCulture);
                int minute = int.Parse(md.Groups[4].Value, CultureInfo.InvariantCulture);
                int second = md.Groups[5].Success ? int.Parse(md.Groups[5].Value, CultureInfo.InvariantCulture) : 0;
                string ap = md.Groups[6].Value.ToLowerInvariant();
                if (ap == "pm" && hour < 12) hour += 12;
                if (ap == "am" && hour == 12) hour = 0;
                DateTime candidate;
                try
                {
                    candidate = new DateTime(DateTime.Now.Year, month, day, hour, minute, second);
                }
                catch
                {
                    return false;
                }
                if (candidate > DateTime.Now.AddDays(30)) candidate = candidate.AddYears(-1);
                ms = TimeUtil.ToMs(candidate);
                return true;
            }

            string[] formats = new string[]
            {
                "yyyy-M-d H:mm:ss", "yyyy-M-d H:mm", "yyyy/M/d H:mm:ss", "yyyy/M/d H:mm",
                "yyyy/M/d h:mm:ss tt", "yyyy/M/d h:mm tt",
                "yyyy年M月d日 H:mm:ss", "yyyy年M月d日 H:mm",
                "yyyy-M-d h:mm:ss tt", "yyyy-M-d h:mm tt",
                "M/d/yy h:mm:ss tt", "M/d/yy h:mm tt", "M/d/yyyy h:mm:ss tt", "M/d/yyyy h:mm tt",
                "d/M/yyyy H:mm:ss", "d/M/yyyy H:mm", "d/M/yyyy h:mm:ss tt", "d/M/yyyy h:mm tt",
                "M/d/yy H:mm:ss", "M/d/yy H:mm", "M/d/yyyy H:mm:ss", "M/d/yyyy H:mm",
                "yyyy-M-d", "yyyy/M/d", "yyyy年M月d日",
                "M月d日 H:mm:ss", "M月d日 H:mm"
            };

            DateTime dt;
            if (DateTime.TryParseExact(s, formats, CultureInfo.InvariantCulture,
                DateTimeStyles.AllowWhiteSpaces, out dt))
            {
                ms = TimeUtil.ToMs(dt);
                return true;
            }

            DateTimeOffset dto;
            if (DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture,
                DateTimeStyles.AllowWhiteSpaces, out dto))
            {
                ms = dto.ToUnixTimeMilliseconds();
                return true;
            }

            if (DateTime.TryParse(s, CultureInfo.GetCultureInfo("zh-CN"), DateTimeStyles.AllowWhiteSpaces, out dt))
            {
                ms = TimeUtil.ToMs(dt);
                return true;
            }
            return false;
        }

        private static ParseResult TryParseJson(string text)
        {
            try
            {
                object root = Json.DeserializeObject(text);
                List<object> items = new List<object>();
                Dictionary<string, object> obj = root as Dictionary<string, object>;
                if (obj != null)
                {
                    object messages = Json.Get(obj, "messages");
                    if (messages == null) messages = Json.Get(obj, "chat");
                    if (messages == null) messages = Json.Get(obj, "data");
                    IList list = messages as IList;
                    if (list != null)
                    {
                        for (int i = 0; i < list.Count; i++) items.Add(list[i]);
                    }
                }
                else
                {
                    IList list = root as IList;
                    if (list != null)
                    {
                        for (int i = 0; i < list.Count; i++) items.Add(list[i]);
                    }
                }
                if (items.Count == 0) return null;

                ParseResult result = new ParseResult();
                result.Format = "JSON";
                for (int i = 0; i < items.Count; i++)
                {
                    Dictionary<string, object> item = items[i] as Dictionary<string, object>;
                    if (item == null)
                    {
                        IList arr = items[i] as IList;
                        if (arr != null && arr.Count >= 2)
                        {
                            string arrSender = Convert.ToString(arr[0], CultureInfo.InvariantCulture);
                            string arrContent = Convert.ToString(arr[1], CultureInfo.InvariantCulture);
                            long arrTs = 0;
                            if (arr.Count >= 3) TryParseJsonTime(arr[2], out arrTs);
                            AddJsonMessage(result, arrSender, arrContent, arrTs);
                        }
                        continue;
                    }

                    string sender = FirstString(item, new string[] { "sender", "senderName", "sender_name", "from", "name", "author", "nickname", "speaker", "role" });
                    string content = FirstString(item, new string[] { "content", "text", "message", "body", "msg", "value" });
                    object timeObj = FirstObject(item, new string[] { "timestamp", "time", "date", "createdAt", "createTime", "sendTime", "ts" });
                    long ts = 0;
                    if (timeObj != null) TryParseJsonTime(timeObj, out ts);
                    AddJsonMessage(result, sender, content, ts);
                }
                if (result.Messages.Count == 0) return null;
                return result;
            }
            catch
            {
                Log.Write("WARN JSON 聊天解析失败（聊天原文不写入日志）。");
                return null;
            }
        }

        private static void AddJsonMessage(ParseResult result, string sender, string content, long ts)
        {
            sender = CleanSender(sender);
            content = (content ?? "").Trim();
            if (sender.Length == 0 || content.Length == 0 || IsSystemSender(sender)) return;
            ChatMessage m = new ChatMessage();
            m.Sender = sender;
            m.Content = content;
            m.Timestamp = ts;
            m.TimeText = ts > 0 ? Fmt.FullDate(ts) : "";
            result.Messages.Add(m);
        }

        private static string FirstString(Dictionary<string, object> item, string[] keys)
        {
            for (int i = 0; i < keys.Length; i++)
            {
                object v = Json.Get(item, keys[i]);
                if (v != null)
                {
                    string s = Convert.ToString(v, CultureInfo.InvariantCulture);
                    if (!string.IsNullOrEmpty(s)) return s;
                }
            }
            return "";
        }

        private static object FirstObject(Dictionary<string, object> item, string[] keys)
        {
            for (int i = 0; i < keys.Length; i++)
            {
                object v = Json.Get(item, keys[i]);
                if (v != null) return v;
            }
            return null;
        }

        private static bool TryParseJsonTime(object value, out long ms)
        {
            ms = 0;
            if (value == null) return false;
            if (value is int || value is long || value is double || value is decimal)
            {
                double d = Convert.ToDouble(value, CultureInfo.InvariantCulture);
                if (d <= 0) return false;
                if (d < 100000000000.0) d = d * 1000.0;
                ms = (long)d;
                return ms > 0;
            }
            string s = Convert.ToString(value, CultureInfo.InvariantCulture);
            if (string.IsNullOrEmpty(s)) return false;
            if (Regex.IsMatch(s, @"^\d{10,13}$"))
            {
                long n;
                if (long.TryParse(s, out n))
                {
                    ms = n < 100000000000L ? n * 1000 : n;
                    return true;
                }
            }
            DateTimeOffset dto;
            if (DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out dto))
            {
                ms = dto.ToUnixTimeMilliseconds();
                return true;
            }
            return TryParseTimestamp(s, out ms);
        }
    }
}
