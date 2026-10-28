using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace CrushLens
{
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            bool demo = false;
            bool openSettings = false;
            string dataDir = "";
            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i] ?? "";
                if (string.Equals(a, "--demo", StringComparison.OrdinalIgnoreCase)) demo = true;
                else if (string.Equals(a, "--settings", StringComparison.OrdinalIgnoreCase)) openSettings = true;
                else if (a.StartsWith("--data-dir=", StringComparison.OrdinalIgnoreCase)) dataDir = a.Substring("--data-dir=".Length).Trim('"');
            }
            if (!string.IsNullOrEmpty(dataDir)) AppPaths.SetDataDir(dataDir);

            try
            {
                Native.SetCurrentProcessExplicitAppUserModelID("CrushLens.Portable.1");
            }
            catch
            {
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException += delegate(object sender, ThreadExceptionEventArgs e)
            {
                Log.Error("UI 线程异常", e.Exception);
                MessageBox.Show("程序遇到一个异常：\n" + e.Exception.Message + "\n\n详细信息已写入 CrushLens_Data/app.log。",
                    "CrushLens", MessageBoxButtons.OK, MessageBoxIcon.Error);
            };
            AppDomain.CurrentDomain.UnhandledException += delegate(object sender, UnhandledExceptionEventArgs e)
            {
                Exception ex = e.ExceptionObject as Exception;
                Log.Error("未处理异常", ex);
            };

            try
            {
                AppPaths.EnsureWritable();
            }
            catch (Exception ex)
            {
                Log.Error("数据目录不可写", ex);
                MessageBox.Show("无法在程序所在目录创建 CrushLens_Data。\n\n请把 CrushLens.exe 移到你有写入权限的普通文件夹（例如 D 盘的一个便携目录或 U 盘），再启动。\n\n本程序不会退回到 AppData 或注册表写数据。",
                    "CrushLens · 需要可写目录", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            if (args != null)
            {
                for (int i = 0; i < args.Length; i++)
                {
                    if (string.Equals(args[i], "--selftest", StringComparison.OrdinalIgnoreCase))
                    {
                        Environment.ExitCode = SelfTest.Run();
                        return;
                    }
                }
            }

            AppSettings settings;
            try
            {
                settings = Storage.LoadSettings();
            }
            catch (Exception ex)
            {
                Log.Error("加载设置失败", ex);
                settings = new AppSettings();
            }
            Application.Run(new MainForm(settings, demo, openSettings));
        }
    }
}
