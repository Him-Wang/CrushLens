using System;

namespace CrushLens
{
    public class DimensionDef
    {
        public string Key;
        public string Label;

        public DimensionDef(string key, string label)
        {
            Key = key;
            Label = label;
        }
    }

    public static class Scoring
    {
        public const string CrushMode = "crush";
        public const string CoupleMode = "couple";

        // The model supplies evidence and six behavioural dimensions. The headline
        // score is calculated locally so two reports with different dimensions do
        // not collapse onto the same model anchor.
        private static readonly string[] CrushKeys = new string[]
        {
            "initiative", "engagement", "care", "openness", "intimacy", "action"
        };

        private static readonly string[] CrushLabels = new string[]
        {
            "主动延续", "回应投入", "关心体贴", "自我开放", "亲密表达", "实际行动"
        };

        private static readonly double[] CrushWeights = new double[]
        {
            0.17, 0.22, 0.18, 0.14, 0.15, 0.14
        };

        private static readonly string[] CoupleKeys = new string[]
        {
            "security", "reciprocity", "repair", "boundaries", "intimacy", "future"
        };

        private static readonly string[] CoupleLabels = new string[]
        {
            "安全感", "双向投入", "沟通修复", "边界尊重", "亲密连接", "共同未来"
        };

        private static readonly double[] CoupleWeights = new double[]
        {
            0.20, 0.20, 0.18, 0.15, 0.15, 0.12
        };

        public static string NormalizeMode(string mode)
        {
            return string.Equals(mode, CoupleMode, StringComparison.OrdinalIgnoreCase) ? CoupleMode : CrushMode;
        }

        public static bool IsCouple(string mode)
        {
            return string.Equals(mode, CoupleMode, StringComparison.OrdinalIgnoreCase);
        }

        public static string ModeName(string mode)
        {
            return IsCouple(mode) ? "情侣关系" : "Crush 心动";
        }

        public static DimensionDef[] Dimensions(string mode)
        {
            string[] keys = IsCouple(mode) ? CoupleKeys : CrushKeys;
            string[] labels = IsCouple(mode) ? CoupleLabels : CrushLabels;
            DimensionDef[] result = new DimensionDef[keys.Length];
            for (int i = 0; i < keys.Length; i++) result[i] = new DimensionDef(keys[i], labels[i]);
            return result;
        }

        public static string[] Stages(string mode)
        {
            if (IsCouple(mode))
                return new string[] { "稳定恋爱", "磨合期", "异地恋", "同居", "冷战/修复期", "长期关系" };
            return new string[] { "刚认识", "暧昧中", "恋爱中", "拉扯期", "已表白", "冷淡期" };
        }

        public static string DefaultStage(string mode)
        {
            return IsCouple(mode) ? "稳定恋爱" : "暧昧中";
        }

        public static string OtherDefaultName(string mode)
        {
            return IsCouple(mode) ? "TA" : "对方";
        }

        public static string Caption(string mode)
        {
            return IsCouple(mode) ? "关系连接  /  CONNECTION SCORE" : "好感度  /  AFFECTION SCORE";
        }

        public static int GetScore(AiReport report)
        {
            if (report == null) return 0;
            if (report.ModelScore > 0) return Clamp(report.Score);
            return FromDimensions(report.Dimensions, report.Score, report.Mode);
        }

        public static int FromDimensions(System.Collections.Generic.Dictionary<string, int> dims, int fallback)
        {
            return FromDimensions(dims, fallback, CrushMode);
        }

        public static int FromDimensions(System.Collections.Generic.Dictionary<string, int> dims, int fallback, string mode)
        {
            if (dims == null || dims.Count == 0) return Clamp(fallback);
            string[] keys = IsCouple(mode) ? CoupleKeys : CrushKeys;
            double[] weights = IsCouple(mode) ? CoupleWeights : CrushWeights;
            double total = 0;
            for (int i = 0; i < keys.Length; i++)
            {
                int value;
                if (!dims.TryGetValue(keys[i], out value)) return Clamp(fallback);
                total += Clamp(value) * weights[i];
            }
            return Clamp((int)Math.Round(total));
        }

        public static int Clamp(int value)
        {
            if (value < 0) return 0;
            if (value > 100) return 100;
            return value;
        }

        public static string DefaultLabel(string mode, int score)
        {
            if (IsCouple(mode))
            {
                if (score >= 85) return "连接稳固";
                if (score >= 70) return "关系稳定";
                if (score >= 55) return "需要经营";
                if (score >= 40) return "摩擦偏多";
                return "连接紧张";
            }
            if (score >= 85) return "心动很明显";
            if (score >= 70) return "双向升温";
            if (score >= 55) return "友好观望";
            if (score >= 40) return "信号偏弱";
            return "保持距离";
        }

        public static string Explain(AiReport report)
        {
            if (report == null) return "";
            int final = GetScore(report);
            int raw = report.ModelScore > 0 ? report.ModelScore : report.Score;
            if (raw != final) return "六维加权 · AI 原始 " + raw;
            return "六维加权";
        }
    }
}
