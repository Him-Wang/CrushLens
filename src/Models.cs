using System;
using System.Collections.Generic;
using System.Web.Script.Serialization;

namespace CrushLens
{
    public class ChatMessage
    {
        public int Id;
        public string Sender = "";
        public string Content = "";
        public long Timestamp;          // Unix milliseconds, 0 when unknown
        public string TimeText = "";    // original timestamp text

        [ScriptIgnore]
        public bool IsMine;
    }

    public class ChatMedia
    {
        public string FileName = "";
        public string OriginalName = "";
        public string MimeType = "image/jpeg";
        public int Width;
        public int Height;
        public long Size;

        [ScriptIgnore]
        public byte[] Data;
    }

    public class MediaNote
    {
        public int I;
        public string Description = "";
        public string Signal = "";
    }

    public class MessageTag
    {
        public int I;
        public string Emotion = "";
        public string Intent = "";
        public string Note = "";
    }

    public class SignalItem
    {
        public string Title = "";
        public string Detail = "";
        public string Quote = "";
    }

    public class AdviceItem
    {
        public string Title = "";
        public string Detail = "";
    }

    public class AiReport
    {
        public string Mode = "crush";
        public int Score;
        public int ModelScore;
        public string Label = "";
        public string Trend = "";
        public string Headline = "";
        public string Summary = "";
        public Dictionary<string, int> Dimensions = new Dictionary<string, int>();
        public List<SignalItem> Signals = new List<SignalItem>();
        public List<string> Cautions = new List<string>();
        public List<AdviceItem> Advice = new List<AdviceItem>();
        public string ReplyGrade = "";
        public string ReplyGradeReason = "";
        public string NextMessage = "";
        public List<MediaNote> MediaNotes = new List<MediaNote>();
        public List<MessageTag> MessageTags = new List<MessageTag>();
        public string Disclaimer = "";
        public long AnalyzedAt;

        public MessageTag FindTag(int messageId)
        {
            for (int i = 0; i < MessageTags.Count; i++)
            {
                if (MessageTags[i].I == messageId) return MessageTags[i];
            }
            return null;
        }
    }

    public class DayStat
    {
        public string Key = "";
        public string Label = "";
        public int Mine;
        public int Crush;
    }

    public class KeywordStat
    {
        public string Word = "";
        public int Mine;
        public int Crush;
        public int Total { get { return Mine + Crush; } }
    }

    public class LocalStats
    {
        public string MeName = "";
        public string CrushName = "";
        public int Total;
        public int Mine;
        public int Crush;
        public int Skipped;
        public int Timestamped;
        public long FirstTs;
        public long LastTs;
        public int SpanDays;
        public int ActiveDays;
        public double MessagesPerDay;
        public int MineInitiations;
        public int CrushInitiations;
        public int MineReplies;
        public int CrushReplies;
        public double MineMedianReplySec;
        public double CrushMedianReplySec;
        public double MineAvgChars;
        public double CrushAvgChars;
        public int MineQuestions;
        public int CrushQuestions;
        public int MineDoubleTexts;
        public int CrushDoubleTexts;
        public int LateNight;
        public int LateNightMine;
        public int LateNightCrush;
        public int CurrentStreak;
        public int LongestStreak;
        public int LongestGapHours;
        public List<DayStat> Days = new List<DayStat>();
        public int[] Hourly = new int[24];
        public int[] HourlyMine = new int[24];
        public int[] HourlyCrush = new int[24];
        public List<KeywordStat> Keywords = new List<KeywordStat>();
        public List<string> Observations = new List<string>();

        public double MineShare
        {
            get { return Total <= 0 ? 0.5 : (double)Mine / Total; }
        }

        public double CrushShare
        {
            get { return Total <= 0 ? 0.5 : (double)Crush / Total; }
        }
    }

    public class ChatSession
    {
        public string Id = "";
        public string Title = "";
        public string MeName = "";
        public string CrushName = "";
        public string Mode = "crush";
        public string Stage = "暧昧中";
        public string RawText = "";
        public string Provider = "";
        public string Model = "";
        public int AnalysisLimit = 120;
        public long CreatedAt;
        public long UpdatedAt;
        public List<ChatMessage> Messages = new List<ChatMessage>();
        public List<ChatMedia> Media = new List<ChatMedia>();
        public AiReport Report;

        [ScriptIgnore]
        public LocalStats Stats;

        [ScriptIgnore]
        public bool IsDemo;

        public ChatMessage FindMessage(int id)
        {
            for (int i = 0; i < Messages.Count; i++)
            {
                if (Messages[i].Id == id) return Messages[i];
            }
            return null;
        }

        public string DisplayTitle()
        {
            if (!string.IsNullOrEmpty(CrushName) && !string.IsNullOrEmpty(MeName))
                return MeName + "  ×  " + CrushName;
            return Title;
        }
    }

    public class AppSettings
    {
        public string Provider = "DeepSeek";
        public string BaseUrl = "https://api.deepseek.com/v1";
        public string Model = "deepseek-chat";
        public string ApiKeyEncrypted = "";
        public bool JsonMode = true;
        public bool RememberKey = true;
        public int AnalysisLimit = 120;

        [ScriptIgnore]
        public string ApiKey = "";

        [ScriptIgnore]
        public bool HasKey
        {
            get { return !string.IsNullOrEmpty(ApiKey); }
        }

        public AppSettings Copy()
        {
            AppSettings c = new AppSettings();
            c.Provider = Provider;
            c.BaseUrl = BaseUrl;
            c.Model = Model;
            c.ApiKeyEncrypted = ApiKeyEncrypted;
            c.ApiKey = ApiKey;
            c.JsonMode = JsonMode;
            c.RememberKey = RememberKey;
            c.AnalysisLimit = AnalysisLimit;
            return c;
        }
    }

    public class ProviderPreset
    {
        public string Name;
        public string BaseUrl;
        public string Model;
        public string KeyPage;
        public string Hint;

        public ProviderPreset(string name, string baseUrl, string model, string keyPage, string hint)
        {
            Name = name;
            BaseUrl = baseUrl;
            Model = model;
            KeyPage = keyPage;
            Hint = hint;
        }

        public override string ToString()
        {
            return Name;
        }
    }

    public class ApiOutcome
    {
        public bool Ok;
        public string Message = "";
        public int LatencyMs;
        public string Raw = "";
        public List<string> Models = new List<string>();
    }

    public class AnalysisInput
    {
        public ChatSession Session;
        public LocalStats Stats;
        public AppSettings Settings;
        public List<ChatMessage> Sample = new List<ChatMessage>();
        public List<ChatMedia> Media = new List<ChatMedia>();
        public int Limit;
        public bool SampleTruncated;
        public int TotalSelected;
        public bool ImageOnly;
    }
}
