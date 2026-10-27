using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace CrushLens
{
    public static class SelfTest
    {
        public static int Run()
        {
            StringBuilder log = new StringBuilder();
            int fails = 0;
            Action<bool, string, string> check = delegate(bool ok, string name, string detail)
            {
                log.AppendLine((ok ? "PASS  " : "FAIL  ") + name + (string.IsNullOrEmpty(detail) ? "" : "  ::  " + detail));
                if (!ok) fails++;
            };

            try
            {
                ParseResult parsed = ChatParser.Parse(DemoData.SampleChat);
                check(parsed.Messages.Count >= 60, "parse sample count", parsed.Messages.Count.ToString());
                check(parsed.Names.Count == 2, "parse names", string.Join(",", parsed.Names.ToArray()));
                check(string.IsNullOrEmpty(parsed.Warning), "parse warning", parsed.Warning);
                check(parsed.Messages[0].Timestamp > 0, "first timestamp", Fmt.FullDate(parsed.Messages[0].Timestamp));
                check(parsed.Messages[parsed.Messages.Count - 1].Timestamp > 0, "last timestamp", Fmt.FullDate(parsed.Messages[parsed.Messages.Count - 1].Timestamp));

                ChatSession session = DemoData.CreateSession();
                check(session.Stats != null, "stats exists", "");
                check(session.Stats.Mine > 10 && session.Stats.Crush > 10, "both participants", session.Stats.Mine + " / " + session.Stats.Crush);
                check(session.Stats.ActiveDays > 3, "active days", session.Stats.ActiveDays.ToString());
                check(session.Stats.MineAvgChars > 2, "avg chars", session.Stats.MineAvgChars.ToString("0.0"));
                check(session.Report != null && session.Report.Score == 82, "demo report", session.Report != null ? session.Report.Score.ToString() : "null");
                System.Collections.Generic.Dictionary<string, int> dims = new System.Collections.Generic.Dictionary<string, int>();
                dims["initiative"] = 78;
                dims["engagement"] = 70;
                dims["care"] = 68;
                dims["openness"] = 55;
                dims["intimacy"] = 75;
                dims["action"] = 40;
                check(Scoring.FromDimensions(dims, 72) == 65, "score calibration", Scoring.FromDimensions(dims, 72).ToString());

                string json = Json.Serialize(session);
                ChatSession back = Json.Deserialize<ChatSession>(json);
                check(back != null && back.Messages.Count == session.Messages.Count, "session roundtrip", json.Length + " bytes");
                check(back.Report != null && back.Report.MessageTags.Count == 14, "report roundtrip", "");

                string html = ReportExporter.BuildHtml(session);
                check(html.Contains("<!DOCTYPE html>") && html.Contains(session.CrushName), "html export", html.Length + " chars");
                check(html.Contains("好感度") && html.Contains("六个行为维度"), "html sections", "");

                string cipher = Storage.Encrypt("sk-selftest-value");
                string plain = Storage.Decrypt(cipher);
                check(cipher.Length > 20 && plain == "sk-selftest-value", "DPAPI key storage", "");

                string[] variants = new string[]
                {
                    "林晚\n2026年9月20日 21:14\n在吗\n我\n2026年9月20日 21:15\n在的",
                    "林晚: 09-17 19:26:53\n晚上好\n我: 09-17 19:27:00\n晚上好呀",
                    "[9/17/26, 7:26:53 PM] Alex: Dinner tonight?\n[9/17/26, 7:27:00 PM] Me: Sounds good",
                    "17/09/2026, 19:26 - Alex: Dinner tonight?\n17/09/2026, 19:27 - Me: Sounds good"
                };
                for (int i = 0; i < variants.Length; i++)
                {
                    ParseResult p = ChatParser.Parse(variants[i]);
                    check(p.Messages.Count == 2, "parser variant " + (i + 1), p.Format + " / " + p.Messages.Count);
                }
            }
            catch (Exception ex)
            {
                fails++;
                log.AppendLine("FAIL  exception :: " + ex);
            }

            log.AppendLine(fails == 0 ? "ALL PASS" : ("FAILS=" + fails));
            try
            {
                File.WriteAllText(Path.Combine(AppPaths.DataDir, "selftest.log"), log.ToString(), new UTF8Encoding(false));
            }
            catch
            {
            }
            return fails == 0 ? 0 : 1;
        }
    }
}
