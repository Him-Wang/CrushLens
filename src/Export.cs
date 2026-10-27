using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace CrushLens
{
    public static class ReportExporter
    {
        public static string BuildHtml(ChatSession s)
        {
            if (s == null || s.Report == null) throw new InvalidOperationException("没有可导出的报告。");
            AiReport r = s.Report;
            LocalStats st = s.Stats ?? StatsEngine.Compute(s.Messages, s.MeName, s.CrushName);
            int finalScore = Scoring.GetScore(r);
            string scoreColor = finalScore >= 75 ? "#d9546d" : (finalScore >= 55 ? "#b78038" : "#5c7f9f");
            StringBuilder b = new StringBuilder();
            b.AppendLine("<!DOCTYPE html>");
            b.AppendLine("<html lang=\"zh-CN\"><head><meta charset=\"utf-8\"/>");
            b.AppendLine("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/>");
            b.AppendLine("<title>CrushLens · " + TextKit.Html(s.CrushName) + " 的好感度报告</title>");
            b.AppendLine("<style>");
            b.AppendLine(":root{--rose:#e05b72;--rose-deep:#b94156;--peach:#f4b89b;--ink:#2b2328;--soft:#8b7e84;--line:#eadfd9;--paper:#f7f3ef;--card:#fffdfc;--green:#4c9476;--amber:#c2853e}");
            b.AppendLine("*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:'Microsoft YaHei UI','Microsoft YaHei','PingFang SC',sans-serif;line-height:1.75}");
            b.AppendLine(".wrap{max-width:900px;margin:0 auto;padding:34px 24px 64px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;color:var(--soft);font-size:12px;letter-spacing:.06em}");
            b.AppendLine(".brand{display:flex;align-items:center;gap:10px;color:var(--ink);font-weight:700;letter-spacing:.02em}.mark{width:26px;height:26px;border-radius:8px;background:#211920;display:flex;align-items:center;justify-content:center;color:#ffb6b0;font-size:16px}");
            b.AppendLine(".card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:28px;margin-bottom:16px;box-shadow:0 8px 30px rgba(55,35,42,.035)}");
            b.AppendLine(".hero{display:grid;grid-template-columns:190px 1fr;gap:24px;align-items:center}.score{text-align:center}.ring{position:relative;width:168px;height:168px;margin:0 auto}.ring svg{transform:rotate(-90deg)}.ring .num{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}.num strong{font-size:52px;line-height:1;color:" + scoreColor + ";letter-spacing:-.04em}.num span{font-size:11px;color:var(--soft);margin-top:8px;letter-spacing:.1em}");
            b.AppendLine(".eyebrow{font-size:10px;letter-spacing:.16em;color:var(--soft);text-transform:uppercase;font-weight:700}.label{font-size:26px;font-weight:700;margin:6px 0 4px}.headline{font-size:18px;font-weight:700;color:#4b3c43;margin:14px 0 10px}.summary{font-size:14px;color:#5b4c53;margin:0}.pill{display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;background:#fbeaee;color:var(--rose-deep);margin-right:6px}.muted{color:var(--soft);font-size:12px}");
            b.AppendLine("h2{font-size:13px;letter-spacing:.08em;color:var(--soft);font-weight:700;margin:0 0 18px}.dims{display:grid;grid-template-columns:1fr 1fr;gap:14px 34px}.dim{display:grid;grid-template-columns:70px 1fr 34px;align-items:center;gap:9px;font-size:12px}.bar{height:7px;border-radius:9px;background:#f0e7e2;overflow:hidden}.bar i{display:block;height:100%;border-radius:9px;background:linear-gradient(90deg,#e78691,#e05b72)}.dim b{font-weight:600;color:var(--soft);text-align:right;font-size:11px}");
            b.AppendLine(".signal{padding:15px 0;border-bottom:1px dashed var(--line)}.signal:last-child{border-bottom:0;padding-bottom:0}.signal h3{font-size:15px;margin:0 0 5px}.signal p{font-size:13px;color:#5b4c53;margin:0}.quote{font-size:12px;color:var(--green);background:#edf7f1;border-radius:8px;padding:7px 10px;margin-top:8px}");
            b.AppendLine(".warn{background:#fcf6ec;border:1px solid #f0dfc7;border-radius:14px;padding:20px}.warn li{font-size:13px;color:#625044;margin:8px 0}.advice{display:grid;grid-template-columns:1fr 1fr;gap:12px}.advice div{background:#fbf6f3;border-radius:12px;padding:15px}.advice h3{font-size:14px;margin:0 0 5px}.advice p{font-size:12px;color:#5b4c53;margin:0}");
            b.AppendLine(".grade{display:flex;gap:16px;align-items:flex-start}.gradebox{width:58px;height:58px;border-radius:14px;background:#fbeaee;color:var(--rose-deep);display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800;flex:none}.next{background:#fdf3ec;border-left:3px solid var(--peach);border-radius:10px;padding:16px 18px;font-size:14px;margin-top:16px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.stat{background:#fbf7f4;border-radius:12px;padding:13px}.stat b{display:block;font-size:20px;color:var(--ink)}.stat span{font-size:11px;color:var(--soft)}.footer{text-align:center;font-size:11px;color:#a29299;padding-top:18px;line-height:1.9}.disclaimer{font-size:11px;color:var(--soft);border-top:1px solid var(--line);margin-top:18px;padding-top:14px}");
            b.AppendLine("@media print{body{background:#fff}.wrap{max-width:none;padding:0}.card{box-shadow:none;break-inside:avoid;page-break-inside:avoid}.top{padding:0 4px}.footer{padding-bottom:0}}");
            b.AppendLine("@media(max-width:640px){.hero{grid-template-columns:1fr}.dims,.advice,.stats{grid-template-columns:1fr 1fr}.stats{grid-template-columns:1fr 1fr}}");
            b.AppendLine("</style></head><body><div class=\"wrap\">");
            b.AppendLine("<div class=\"top\"><div class=\"brand\"><span class=\"mark\">♥</span> CrushLens 心动镜</div><div>LOCAL REPORT · " + DateTime.Now.ToString("yyyy.MM.dd", CultureInfo.InvariantCulture) + "</div></div>");

            double circumference = 2 * Math.PI * 73;
            double dash = circumference * finalScore / 100.0;
            b.AppendLine("<div class=\"card hero\"><div class=\"score\"><div class=\"ring\"><svg width=\"168\" height=\"168\" viewBox=\"0 0 168 168\"><circle cx=\"84\" cy=\"84\" r=\"73\" fill=\"none\" stroke=\"#f1e7e2\" stroke-width=\"10\"/><circle cx=\"84\" cy=\"84\" r=\"73\" fill=\"none\" stroke=\"" + scoreColor + "\" stroke-width=\"10\" stroke-linecap=\"round\" stroke-dasharray=\"" + dash.ToString("0.##", CultureInfo.InvariantCulture) + " " + circumference.ToString("0.##", CultureInfo.InvariantCulture) + "\" transform=\"rotate(-90 84 84)\"/></svg><div class=\"num\"><strong>" + finalScore + "</strong><span>/ 100 好感信号</span></div></div></div>");
            b.AppendLine("<div><div><span class=\"pill\">" + TextKit.Html(r.Trend) + "</span><span class=\"pill\">" + TextKit.Html(s.Stage) + "</span></div><div class=\"label\">" + TextKit.Html(r.Label) + "</div><div class=\"muted\">" + TextKit.Html(s.MeName) + "  ×  " + TextKit.Html(s.CrushName) + " · " + TextKit.Html(s.Model) + " · " + TextKit.Html(Scoring.Explain(r)) + "</div><div class=\"headline\">" + TextKit.Html(r.Headline) + "</div><p class=\"summary\">" + TextKit.Html(r.Summary) + "</p></div></div>");

            b.AppendLine("<div class=\"card\"><h2>六个行为维度</h2><div class=\"dims\">");
            string[] keys = new string[] { "initiative", "engagement", "care", "openness", "intimacy", "action" };
            string[] labels = new string[] { "主动延续", "回应投入", "关心体贴", "自我开放", "亲密表达", "实际行动" };
            for (int i = 0; i < keys.Length; i++)
            {
                int val = 0;
                if (!r.Dimensions.TryGetValue(keys[i], out val)) val = finalScore;
                b.AppendLine("<div class=\"dim\"><span>" + labels[i] + "</span><div class=\"bar\"><i style=\"width:" + val + "%\"></i></div><b>" + val + "</b></div>");
            }
            b.AppendLine("</div></div>");

            b.AppendLine("<div class=\"card\"><h2>心动信号 / GREEN FLAGS</h2>");
            if (r.Signals.Count == 0) b.AppendLine("<p class=\"muted\">这次样本里没有足够明确的信号。</p>");
            for (int i = 0; i < r.Signals.Count; i++)
            {
                SignalItem sig = r.Signals[i];
                b.AppendLine("<div class=\"signal\"><h3>" + TextKit.Html(sig.Title) + "</h3><p>" + TextKit.Html(sig.Detail) + "</p>");
                if (!string.IsNullOrEmpty(sig.Quote)) b.AppendLine("<div class=\"quote\">“" + TextKit.Html(sig.Quote) + "”</div>");
                b.AppendLine("</div>");
            }
            b.AppendLine("</div>");

            if (r.MediaNotes.Count > 0)
            {
                b.AppendLine("<div class=\"card\"><h2>图片 / 表情包解读</h2>");
                for (int i = 0; i < r.MediaNotes.Count; i++)
                {
                    MediaNote n = r.MediaNotes[i];
                    b.AppendLine("<div class=\"signal\"><h3>图片 " + n.I + "</h3><p>" + TextKit.Html(n.Description) + "</p>");
                    if (!string.IsNullOrEmpty(n.Signal)) b.AppendLine("<div class=\"quote\">" + TextKit.Html(n.Signal) + "</div>");
                    b.AppendLine("</div>");
                }
                b.AppendLine("<div class=\"muted\" style=\"margin-top:12px\">图片文件只保存在本地，不嵌入本报告。</div></div>");
            }

            b.AppendLine("<div class=\"card\"><h2>需要留心 / WATCH OUT</h2><div class=\"warn\"><ul>");
            if (r.Cautions.Count == 0) b.AppendLine("<li>暂未发现明显风险信号，但仍请尊重真实边界。</li>");
            for (int i = 0; i < r.Cautions.Count; i++) b.AppendLine("<li>" + TextKit.Html(r.Cautions[i]) + "</li>");
            b.AppendLine("</ul></div></div>");

            b.AppendLine("<div class=\"card\"><h2>怎么回 / NEXT MOVE</h2><div class=\"grade\"><div class=\"gradebox\">" + TextKit.Html(r.ReplyGrade) + "</div><div><b>回复表现</b><p class=\"summary\">" + TextKit.Html(r.ReplyGradeReason) + "</p></div></div>");
            if (!string.IsNullOrEmpty(r.NextMessage)) b.AppendLine("<div class=\"next\">“" + TextKit.Html(r.NextMessage) + "”</div>");
            b.AppendLine("<div class=\"advice\" style=\"margin-top:16px\">");
            for (int i = 0; i < r.Advice.Count; i++)
            {
                b.AppendLine("<div><h3>" + TextKit.Html(r.Advice[i].Title) + "</h3><p>" + TextKit.Html(r.Advice[i].Detail) + "</p></div>");
            }
            b.AppendLine("</div></div>");

            b.AppendLine("<div class=\"card\"><h2>本地互动统计</h2><div class=\"stats\">");
            AddStat(b, Fmt.Number(st.Total), "有效消息");
            AddStat(b, st.ActiveDays.ToString(), "活跃天数");
            AddStat(b, st.Mine + " / " + st.Crush, "我 / " + s.CrushName);
            AddStat(b, st.MineInitiations + " / " + st.CrushInitiations, "主动开启");
            AddStat(b, st.MineMedianReplySec > 0 ? Fmt.Duration(st.MineMedianReplySec) : "—", "我的中位回复");
            AddStat(b, st.CrushMedianReplySec > 0 ? Fmt.Duration(st.CrushMedianReplySec) : "—", "TA 的中位回复");
            AddStat(b, st.LateNight.ToString(), "深夜消息");
            AddStat(b, st.CurrentStreak + " 天", "末段连续");
            if (s.Media != null && s.Media.Count > 0) AddStat(b, s.Media.Count.ToString(), "图片附件");
            b.AppendLine("</div><div class=\"disclaimer\">" + TextKit.Html(r.Disclaimer) + "</div></div>");

            b.AppendLine("<div class=\"footer\">CrushLens 心动镜 · 本地生成 · 不构成心理诊断或关系承诺<br/>AI 分析仅基于本次聊天节选；真实感受与边界，永远以面对面沟通为准。</div>");
            b.AppendLine("</div></body></html>");
            return b.ToString();
        }

        private static void AddStat(StringBuilder b, string value, string label)
        {
            b.AppendLine("<div class=\"stat\"><b>" + TextKit.Html(value) + "</b><span>" + TextKit.Html(label) + "</span></div>");
        }
    }
}
