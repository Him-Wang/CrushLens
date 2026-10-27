using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace CrushLens
{
    public static class AppPaths
    {
        private static string _dataDir = "";

        public static string BaseDir
        {
            get { return AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar); }
        }

        public static string DataDir
        {
            get
            {
                if (string.IsNullOrEmpty(_dataDir))
                    _dataDir = Path.Combine(BaseDir, "CrushLens_Data");
                return _dataDir;
            }
        }

        public static string SessionsDir
        {
            get { return Path.Combine(DataDir, "sessions"); }
        }

        public static string ExportsDir
        {
            get { return Path.Combine(DataDir, "exports"); }
        }

        public static string SettingsFile
        {
            get { return Path.Combine(DataDir, "settings.json"); }
        }

        public static void SetDataDir(string path)
        {
            if (!string.IsNullOrEmpty(path)) _dataDir = Path.GetFullPath(path);
        }

        public static void EnsureData()
        {
            if (!Directory.Exists(DataDir)) Directory.CreateDirectory(DataDir);
            if (!Directory.Exists(SessionsDir)) Directory.CreateDirectory(SessionsDir);
            if (!Directory.Exists(ExportsDir)) Directory.CreateDirectory(ExportsDir);
        }

        public static void EnsureWritable()
        {
            EnsureData();
            string probe = Path.Combine(DataDir, ".write-test");
            File.WriteAllText(probe, "ok", Encoding.UTF8);
            File.Delete(probe);
        }

        public static string RelativeToBase(string path)
        {
            try
            {
                if (path.StartsWith(BaseDir, StringComparison.OrdinalIgnoreCase))
                    return path.Substring(BaseDir.Length).TrimStart(Path.DirectorySeparatorChar);
            }
            catch
            {
            }
            return path;
        }
    }

    public static class Storage
    {
        private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("CrushLens::v1::local-only");

        public static AppSettings LoadSettings()
        {
            AppSettings s = new AppSettings();
            try
            {
                AppPaths.EnsureData();
                if (File.Exists(AppPaths.SettingsFile))
                {
                    string json = File.ReadAllText(AppPaths.SettingsFile, Encoding.UTF8);
                    AppSettings loaded = Json.Deserialize<AppSettings>(json);
                    if (loaded != null) s = loaded;
                }
            }
            catch (Exception ex)
            {
                Log.Error("读取设置失败", ex);
            }

            if (string.IsNullOrEmpty(s.Provider)) s.Provider = "DeepSeek";
            if (string.IsNullOrEmpty(s.BaseUrl)) s.BaseUrl = "https://api.deepseek.com/v1";
            if (string.IsNullOrEmpty(s.Model)) s.Model = "deepseek-chat";
            if (s.AnalysisLimit != 80 && s.AnalysisLimit != 120 && s.AnalysisLimit != 200)
                s.AnalysisLimit = 120;

            if (!string.IsNullOrEmpty(s.ApiKeyEncrypted))
            {
                try
                {
                    s.ApiKey = Decrypt(s.ApiKeyEncrypted);
                }
                catch (Exception ex)
                {
                    Log.Error("API Key 解密失败（可能需要重新填写）", ex);
                    s.ApiKey = "";
                }
            }
            return s;
        }

        public static void SaveSettings(AppSettings s)
        {
            AppPaths.EnsureData();
            s.ApiKeyEncrypted = (s.RememberKey && !string.IsNullOrEmpty(s.ApiKey)) ? Encrypt(s.ApiKey) : "";
            string json = Json.Serialize(s);
            AtomicWrite(AppPaths.SettingsFile, json);
        }

        public static string Encrypt(string plain)
        {
            if (string.IsNullOrEmpty(plain)) return "";
            byte[] data = Encoding.UTF8.GetBytes(plain);
            byte[] cipher = ProtectedData.Protect(data, Entropy, DataProtectionScope.CurrentUser);
            return Convert.ToBase64String(cipher);
        }

        public static string Decrypt(string cipherText)
        {
            if (string.IsNullOrEmpty(cipherText)) return "";
            byte[] cipher = Convert.FromBase64String(cipherText);
            byte[] data = ProtectedData.Unprotect(cipher, Entropy, DataProtectionScope.CurrentUser);
            return Encoding.UTF8.GetString(data);
        }

        public static void SaveSession(ChatSession session)
        {
            if (session == null || string.IsNullOrEmpty(session.Id)) throw new ArgumentException("会话为空");
            if (session.IsDemo) return;
            AppPaths.EnsureData();
            session.UpdatedAt = TimeUtil.NowMs();
            string path = Path.Combine(AppPaths.SessionsDir, session.Id + ".json");
            AtomicWrite(path, Json.Serialize(session));
        }

        public static List<ChatSession> LoadSessions()
        {
            List<ChatSession> sessions = new List<ChatSession>();
            try
            {
                AppPaths.EnsureData();
                string[] files = Directory.GetFiles(AppPaths.SessionsDir, "*.json");
                for (int i = 0; i < files.Length; i++)
                {
                    try
                    {
                        string json = File.ReadAllText(files[i], Encoding.UTF8);
                        ChatSession s = Json.Deserialize<ChatSession>(json);
                        if (s == null || s.Messages == null || s.Messages.Count == 0) continue;
                        if (string.IsNullOrEmpty(s.Id)) s.Id = Path.GetFileNameWithoutExtension(files[i]);
                        s.Stats = StatsEngine.Compute(s.Messages, s.MeName, s.CrushName);
                        s.IsDemo = false;
                        sessions.Add(s);
                    }
                    catch (Exception ex)
                    {
                        Log.Error("读取会话失败: " + Path.GetFileName(files[i]), ex);
                    }
                }
            }
            catch (Exception ex)
            {
                Log.Error("扫描会话目录失败", ex);
            }
            sessions.Sort(delegate(ChatSession a, ChatSession b) { return b.UpdatedAt.CompareTo(a.UpdatedAt); });
            return sessions;
        }

        public static void DeleteSession(string id)
        {
            if (string.IsNullOrEmpty(id)) return;
            string path = Path.Combine(AppPaths.SessionsDir, id + ".json");
            if (File.Exists(path)) File.Delete(path);
        }

        public static void AtomicWrite(string path, string content)
        {
            string tmp = path + ".tmp";
            File.WriteAllText(tmp, content, new UTF8Encoding(false));
            if (File.Exists(path))
            {
                try
                {
                    File.Replace(tmp, path, null);
                }
                catch
                {
                    File.Copy(tmp, path, true);
                    File.Delete(tmp);
                }
            }
            else
            {
                File.Move(tmp, path);
            }
        }

        public static string SaveExport(string suggestedName, string content)
        {
            AppPaths.EnsureData();
            string clean = TextKit.SafeFileName(suggestedName);
            string path = Path.Combine(AppPaths.ExportsDir, clean + ".html");
            int n = 2;
            while (File.Exists(path))
            {
                path = Path.Combine(AppPaths.ExportsDir, clean + "_" + n + ".html");
                n++;
            }
            File.WriteAllText(path, content, new UTF8Encoding(false));
            return path;
        }
    }
}
