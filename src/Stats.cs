using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace CrushLens
{
    public static class StatsEngine
    {
        private static readonly string[] KeywordList = new string[]
        {
            "晚安", "早安", "想你", "喜欢你", "可爱", "哈哈", "笑死", "在干嘛", "干嘛呢",
            "周末", "见面", "一起", "下次", "有空", "到家", "注意安全", "记得", "别熬夜", "早点睡",
            "忙", "累", "电影", "咖啡", "奶茶", "吃饭", "好吃", "照片", "分享", "真的", "好啊", "可以",
            "嗯嗯", "没事", "辛苦", "加油", "好梦", "睡了吗"
        };

        public static LocalStats Compute(List<ChatMessage> all, string meName, string crushName)
        {
            LocalStats stats = new LocalStats();
            stats.MeName = meName ?? "";
            stats.CrushName = crushName ?? "";
            if (all == null) all = new List<ChatMessage>();

            List<ChatMessage> msgs = new List<ChatMessage>();
            for (int i = 0; i < all.Count; i++)
            {
                ChatMessage m = all[i];
                if (m == null) continue;
                bool isMine = SameName(m.Sender, meName);
                bool isCrush = SameName(m.Sender, crushName);
                if (!isMine && !isCrush)
                {
                    stats.Skipped++;
                    continue;
                }
                m.IsMine = isMine;
                msgs.Add(m);
            }

            stats.Total = msgs.Count;
            for (int i = 0; i < msgs.Count; i++)
            {
                ChatMessage m = msgs[i];
                if (m.IsMine) stats.Mine++;
                else stats.Crush++;
                if (m.Timestamp > 0) stats.Timestamped++;
            }

            if (stats.Total == 0) return stats;

            long first = 0;
            long last = 0;
            List<double> mineReply = new List<double>();
            List<double> crushReply = new List<double>();
            int mineCharTotal = 0;
            int crushCharTotal = 0;
            int lateMine = 0;
            int lateCrush = 0;
            HashSet<string> activeDays = new HashSet<string>();
            Dictionary<string, int[]> dayCounts = new Dictionary<string, int[]>();
            long previousTs = 0;
            ChatMessage previous = null;

            for (int i = 0; i < msgs.Count; i++)
            {
                ChatMessage m = msgs[i];
                int len = (m.Content ?? "").Trim().Length;
                if (m.IsMine) mineCharTotal += len;
                else crushCharTotal += len;

                if (m.Timestamp > 0)
                {
                    if (first == 0 || m.Timestamp < first) first = m.Timestamp;
                    if (last == 0 || m.Timestamp > last) last = m.Timestamp;

                    DateTime local = TimeUtil.FromMs(m.Timestamp);
                    string key = TimeUtil.DayKey(local);
                    if (!activeDays.Contains(key)) activeDays.Add(key);
                    if (!dayCounts.ContainsKey(key)) dayCounts[key] = new int[2];
                    if (m.IsMine) dayCounts[key][0]++;
                    else dayCounts[key][1]++;

                    int hour = local.Hour;
                    stats.Hourly[hour]++;
                    if (m.IsMine) stats.HourlyMine[hour]++;
                    else stats.HourlyCrush[hour]++;
                    if (hour >= 23 || hour < 2)
                    {
                        stats.LateNight++;
                        if (m.IsMine) lateMine++;
                        else lateCrush++;
                    }

                    bool startsConversation = previousTs == 0 || (m.Timestamp - previousTs) >= 3L * 3600L * 1000L;
                    if (startsConversation)
                    {
                        if (m.IsMine) stats.MineInitiations++;
                        else stats.CrushInitiations++;
                    }

                    if (previous != null && previous.Timestamp > 0 &&
                        !SameName(previous.Sender, m.Sender) &&
                        m.Timestamp >= previous.Timestamp)
                    {
                        double gapSec = (m.Timestamp - previous.Timestamp) / 1000.0;
                        if (gapSec <= 6 * 3600)
                        {
                            if (m.IsMine) { mineReply.Add(gapSec); stats.MineReplies++; }
                            else { crushReply.Add(gapSec); stats.CrushReplies++; }
                        }
                    }

                    if (previous != null && SameName(previous.Sender, m.Sender))
                    {
                        if (m.IsMine) stats.MineDoubleTexts++;
                        else stats.CrushDoubleTexts++;
                    }

                    if (previousTs > 0 && m.Timestamp > previousTs)
                    {
                        double gapH = (m.Timestamp - previousTs) / 3600000.0;
                        if (gapH > stats.LongestGapHours && gapH < 24 * 30) stats.LongestGapHours = (int)Math.Round(gapH);
                    }
                    previousTs = m.Timestamp;
                }

                previous = m;
            }

            stats.FirstTs = first;
            stats.LastTs = last;
            stats.Timestamped = 0;
            for (int i = 0; i < msgs.Count; i++) if (msgs[i].Timestamp > 0) stats.Timestamped++;
            stats.ActiveDays = activeDays.Count;
            if (activeDays.Count > 0)
            {
                DateTime fd = TimeUtil.FromMs(first).Date;
                DateTime ld = TimeUtil.FromMs(last).Date;
                stats.SpanDays = Math.Max(1, (int)(ld - fd).TotalDays + 1);
            }

            stats.MineAvgChars = stats.Mine == 0 ? 0 : (double)mineCharTotal / stats.Mine;
            stats.CrushAvgChars = stats.Crush == 0 ? 0 : (double)crushCharTotal / stats.Crush;
            stats.MessagesPerDay = activeDays.Count == 0 ? stats.Total : (double)stats.Total / activeDays.Count;
            stats.MineMedianReplySec = Median(mineReply);
            stats.CrushMedianReplySec = Median(crushReply);
            stats.LateNightMine = lateMine;
            stats.LateNightCrush = lateCrush;

            // Questions were counted above in two passes; normalize to avoid double count.
            stats.MineQuestions = CountQuestions(msgs, true);
            stats.CrushQuestions = CountQuestions(msgs, false);

            BuildDays(stats, dayCounts);
            BuildStreaks(stats, activeDays);
            BuildKeywords(stats, msgs);
            BuildObservations(stats);
            return stats;
        }

        private static int CountQuestions(List<ChatMessage> msgs, bool mine)
        {
            int n = 0;
            for (int i = 0; i < msgs.Count; i++)
            {
                if (msgs[i].IsMine != mine) continue;
                string c = msgs[i].Content ?? "";
                if (c.IndexOf('?') >= 0 || c.IndexOf('？') >= 0) n++;
            }
            return n;
        }

        private static void BuildDays(LocalStats stats, Dictionary<string, int[]> dayCounts)
        {
            if (stats.LastTs <= 0) return;
            DateTime end = TimeUtil.FromMs(stats.LastTs).Date;
            for (int i = 13; i >= 0; i--)
            {
                DateTime d = end.AddDays(-i);
                string key = TimeUtil.DayKey(d);
                int[] c;
                if (!dayCounts.TryGetValue(key, out c)) c = new int[2];
                DayStat ds = new DayStat();
                ds.Key = key;
                ds.Label = d.ToString("M/d", CultureInfo.InvariantCulture);
                ds.Mine = c[0];
                ds.Crush = c[1];
                stats.Days.Add(ds);
            }
        }

        private static void BuildStreaks(LocalStats stats, HashSet<string> activeDays)
        {
            if (activeDays.Count == 0) return;
            List<DateTime> days = new List<DateTime>();
            foreach (string key in activeDays)
            {
                DateTime parsed;
                if (DateTime.TryParseExact(key, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out parsed))
                    days.Add(parsed);
            }
            days.Sort();
            int longest = 1;
            int run = 1;
            for (int i = 1; i < days.Count; i++)
            {
                if ((days[i] - days[i - 1]).TotalDays == 1) run++;
                else run = 1;
                if (run > longest) longest = run;
            }
            int current = 1;
            for (int i = days.Count - 1; i > 0; i--)
            {
                if ((days[i] - days[i - 1]).TotalDays == 1) current++;
                else break;
            }
            stats.LongestStreak = longest;
            stats.CurrentStreak = current;
        }

        private static void BuildKeywords(LocalStats stats, List<ChatMessage> msgs)
        {
            List<KeywordStat> list = new List<KeywordStat>();
            for (int k = 0; k < KeywordList.Length; k++)
            {
                string word = KeywordList[k];
                KeywordStat ks = new KeywordStat();
                ks.Word = word;
                for (int i = 0; i < msgs.Count; i++)
                {
                    string content = msgs[i].Content ?? "";
                    int count = CountOccurrences(content, word);
                    if (count == 0) continue;
                    if (msgs[i].IsMine) ks.Mine += count;
                    else ks.Crush += count;
                }
                if (ks.Total > 0) list.Add(ks);
            }
            list.Sort(delegate(KeywordStat a, KeywordStat b)
            {
                int c = b.Total.CompareTo(a.Total);
                if (c != 0) return c;
                return string.Compare(a.Word, b.Word, StringComparison.CurrentCulture);
            });
            stats.Keywords = list;
        }

        private static int CountOccurrences(string text, string word)
        {
            if (string.IsNullOrEmpty(text) || string.IsNullOrEmpty(word)) return 0;
            int n = 0;
            int idx = 0;
            while ((idx = text.IndexOf(word, idx, StringComparison.CurrentCultureIgnoreCase)) >= 0)
            {
                n++;
                idx += word.Length;
            }
            return n;
        }

        private static void BuildObservations(LocalStats stats)
        {
            if (stats.Total == 0) return;
            string crush = string.IsNullOrEmpty(stats.CrushName) ? "对方" : stats.CrushName;
            string me = string.IsNullOrEmpty(stats.MeName) ? "你" : "你";
            int initTotal = stats.MineInitiations + stats.CrushInitiations;
            if (initTotal >= 4)
            {
                double minePct = (double)stats.MineInitiations / initTotal;
                if (minePct >= 0.62)
                    stats.Observations.Add(me + "更常开启对话（" + Fmt.Percent(minePct) + "），可以留一点让对方主动的空间。");
                else if (minePct <= 0.38)
                    stats.Observations.Add(crush + "更常开启对话（" + Fmt.Percent(1 - minePct) + "），互动主动性偏向对方。");
                else
                    stats.Observations.Add("双方的对话开启比较均衡，主动性接近五五开。");
            }

            if (stats.MineReplies >= 2 && stats.CrushReplies >= 2 &&
                stats.MineMedianReplySec > 0 && stats.CrushMedianReplySec > 0)
            {
                double ratio = stats.CrushMedianReplySec / Math.Max(1.0, stats.MineMedianReplySec);
                if (ratio <= 0.7)
                    stats.Observations.Add(crush + "的中位回复速度比你快 " + Fmt.Percent(1 - ratio) + "，回应优先级较高。");
                else if (ratio >= 1.45)
                    stats.Observations.Add(me + "通常回得更快，对方的中位回复间隔更长。");
                else
                    stats.Observations.Add("双方的回复速度相近，节奏比较同步。");
            }

            if (stats.Mine > 2 && stats.Crush > 2)
            {
                double ratio = stats.CrushAvgChars / Math.Max(1.0, stats.MineAvgChars);
                if (ratio >= 1.35)
                    stats.Observations.Add(crush + "的平均消息长度明显更长，愿意在文字里投入更多信息。");
                else if (ratio <= 0.72)
                    stats.Observations.Add(me + "的平均消息长度更长，对方偏向短句回应。");
                else
                    stats.Observations.Add("双方的消息长度接近，表达投入大致对等。");
            }

            if (stats.LateNight >= 4)
            {
                double pct = (double)stats.LateNight / stats.Total;
                stats.Observations.Add("有 " + stats.LateNight + " 条消息发生在 23:00–02:00（" + Fmt.Percent(pct) + "），夜间聊天占了一定比例。");
            }

            if (stats.MineDoubleTexts >= 4 && stats.MineDoubleTexts > stats.CrushDoubleTexts + 2)
                stats.Observations.Add(me + "连续追发的情况更多；如果对方暂时没回，留一点空白会比连续补消息更轻松。");

            if (stats.Timestamped < stats.Total * 0.6)
                stats.Observations.Add("有时间戳的消息不足，回复速度和节奏类指标仅供参考。");
            if (stats.Total < 12)
                stats.Observations.Add("样本较少，任何分数都更容易被单条消息影响。");
        }

        private static double Median(List<double> values)
        {
            if (values == null || values.Count == 0) return 0;
            values.Sort();
            int mid = values.Count / 2;
            if (values.Count % 2 == 1) return values[mid];
            return (values[mid - 1] + values[mid]) / 2.0;
        }

        public static bool SameName(string a, string b)
        {
            if (a == null || b == null) return false;
            return string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase);
        }

        public static string BuildCompactSummary(LocalStats s)
        {
            if (s == null || s.Total == 0) return "暂无本地统计。";
            StringBuilder sb = new StringBuilder();
            sb.Append("两人有效消息 ").Append(s.Total).Append(" 条（我 ").Append(s.Mine)
              .Append(" / ").Append(s.CrushName).Append(" ").Append(s.Crush).Append("）；");
            sb.Append("覆盖 ").Append(s.ActiveDays).Append(" 个活跃日；");
            sb.Append("对话开启：我 ").Append(s.MineInitiations).Append(" 次，对方 ").Append(s.CrushInitiations).Append(" 次；");
            if (s.MineMedianReplySec > 0) sb.Append("中位回复：我 ").Append(Fmt.Duration(s.MineMedianReplySec)).Append("，");
            if (s.CrushMedianReplySec > 0) sb.Append("对方 ").Append(Fmt.Duration(s.CrushMedianReplySec)).Append("；");
            sb.Append("平均字数：我 ").Append(Math.Round(s.MineAvgChars)).Append("，对方 ").Append(Math.Round(s.CrushAvgChars)).Append("；");
            sb.Append("深夜消息 ").Append(s.LateNight).Append(" 条。");
            return sb.ToString();
        }
    }
}
