using System;

namespace CrushLens
{
    public static class Scoring
    {
        // The model supplies evidence and six behavioural dimensions. The headline
        // score is calculated locally so two reports with different dimensions do
        // not collapse onto the same model anchor.
        private static readonly string[] Keys = new string[]
        {
            "initiative", "engagement", "care", "openness", "intimacy", "action"
        };

        private static readonly double[] Weights = new double[]
        {
            0.17, 0.22, 0.18, 0.14, 0.15, 0.14
        };

        public static int GetScore(AiReport report)
        {
            if (report == null) return 0;
            if (report.ModelScore > 0) return Clamp(report.Score);
            return FromDimensions(report.Dimensions, report.Score);
        }

        public static int FromDimensions(System.Collections.Generic.Dictionary<string, int> dims, int fallback)
        {
            if (dims == null || dims.Count == 0) return Clamp(fallback);
            double total = 0;
            for (int i = 0; i < Keys.Length; i++)
            {
                int value;
                if (!dims.TryGetValue(Keys[i], out value)) return Clamp(fallback);
                total += Clamp(value) * Weights[i];
            }
            return Clamp((int)Math.Round(total));
        }

        public static int Clamp(int value)
        {
            if (value < 0) return 0;
            if (value > 100) return 100;
            return value;
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
