using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace CrushLens
{
    public class SettingsForm : Form
    {
        private readonly AppSettings _original;
        private readonly Panel _header;
        private readonly Label _title;
        private readonly Label _subtitle;
        private readonly PillButton _close;
        private readonly CardPanel _card;
        private readonly ComboBox _provider;
        private readonly TextBox _baseUrl;
        private readonly TextBox _apiKey;
        private readonly CheckBox _showKey;
        private readonly ComboBox _model;
        private readonly Label _keyLink;
        private readonly CheckBox _jsonMode;
        private readonly CheckBox _remember;
        private readonly Label _testStatus;
        private readonly PillButton _testButton;
        private readonly PillButton _fetchButton;
        private readonly PillButton _saveButton;
        private readonly PillButton _cancelButton;
        private readonly PillButton _openData;
        private readonly Label _dataPath;
        private CancellationTokenSource _cts;
        private bool _presetLoading;
        private string _lastBaseUrl = "";

        private readonly ProviderPreset[] _presets = new ProviderPreset[]
        {
            new ProviderPreset("DeepSeek", "https://api.deepseek.com/v1", "deepseek-chat", "https://platform.deepseek.com/api_keys", "DeepSeek 官方，OpenAI 兼容"),
            new ProviderPreset("通义千问 · 百炼", "https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-plus", "https://bailian.console.aliyun.com/", "阿里云百炼兼容模式"),
            new ProviderPreset("Kimi · Moonshot", "https://api.moonshot.cn/v1", "moonshot-v1-8k", "https://platform.moonshot.cn/console/api-keys", "Moonshot 官方"),
            new ProviderPreset("智谱 GLM", "https://open.bigmodel.cn/api/paas/v4", "glm-4-flash", "https://bigmodel.cn/usercenter/proj-mgmt/apikeys", "智谱开放平台"),
            new ProviderPreset("硅基流动", "https://api.siliconflow.cn/v1", "deepseek-ai/DeepSeek-V3", "https://cloud.siliconflow.cn/account/ak", "SiliconFlow 兼容接口"),
            new ProviderPreset("OpenAI", "https://api.openai.com/v1", "gpt-4o-mini", "https://platform.openai.com/api-keys", "OpenAI 官方"),
            new ProviderPreset("OpenRouter", "https://openrouter.ai/api/v1", "deepseek/deepseek-chat", "https://openrouter.ai/settings/keys", "多模型聚合"),
            new ProviderPreset("自定义 / 本机接口", "", "", "", "任意 OpenAI 兼容 /chat/completions 接口")
        };

        public AppSettings Result;

        public SettingsForm(AppSettings settings, IWin32Window owner)
        {
            _original = settings != null ? settings.Copy() : new AppSettings();
            Result = settings != null ? settings.Copy() : new AppSettings();

            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterParent;
            ShowInTaskbar = false;
            Width = 760;
            Height = 704;
            BackColor = Palette.Bg;
            DoubleBuffered = true;
            KeyPreview = true;

            _header = new Panel();
            _header.BackColor = Palette.Bg;
            _header.SetBounds(0, 0, Width, 64);
            _header.MouseDown += HeaderDrag;
            _header.Paint += HeaderPaint;
            Controls.Add(_header);

            _title = new Label();
            _title.Text = "模型与 API";
            _title.Font = Theme.H2;
            _title.ForeColor = Palette.Ink;
            _title.BackColor = Color.Transparent;
            _title.AutoSize = false;
            _title.SetBounds(28, 17, 280, 28);
            _header.Controls.Add(_title);

            _subtitle = new Label();
            _subtitle.Text = "使用你自己的 Key · 只连接你填写的接口";
            _subtitle.Font = Theme.Tiny;
            _subtitle.ForeColor = Palette.Muted;
            _subtitle.BackColor = Color.Transparent;
            _subtitle.AutoSize = false;
            _subtitle.SetBounds(28, 42, 400, 16);
            _header.Controls.Add(_subtitle);

            _close = new PillButton();
            _close.Text = "✕";
            _close.Kind = ButtonKind.Ghost;
            _close.Font = Theme.Medium;
            _close.SetBounds(Width - 56, 15, 34, 32);
            _close.Click += delegate { DialogResult = DialogResult.Cancel; Close(); };
            _header.Controls.Add(_close);

            _card = new CardPanel();
            _card.FillColor = Palette.Card;
            _card.SetBounds(28, 76, Width - 56, 528);
            Controls.Add(_card);

            int x = 24;
            int cw = _card.Width - 48;

            Label intro = MakeLabel("填入 Base URL、模型 ID 和 API Key。附加图片需要模型支持视觉输入；普通文本模型只能处理文字。", Theme.Small, Palette.InkSoft);
            intro.SetBounds(x, 20, cw, 36);
            _card.Controls.Add(intro);

            Label providerLabel = FieldLabel("服务商预设");
            providerLabel.SetBounds(x, 66, cw, 18);
            _card.Controls.Add(providerLabel);

            _provider = MakeCombo();
            _provider.SetBounds(x, 86, 270, 30);
            for (int i = 0; i < _presets.Length; i++) _provider.Items.Add(_presets[i]);
            _card.Controls.Add(_provider);

            _keyLink = MakeLabel("去申请 Key  →", Theme.Small, Palette.RoseDark);
            _keyLink.Cursor = Cursors.Hand;
            _keyLink.TextAlign = ContentAlignment.MiddleRight;
            _keyLink.SetBounds(_card.Width - 214, 86, 190, 30);
            _keyLink.Click += delegate { OpenKeyPage(); };
            _card.Controls.Add(_keyLink);

            Label baseLabel = FieldLabel("Base URL");
            baseLabel.SetBounds(x, 128, cw, 18);
            _card.Controls.Add(baseLabel);
            _baseUrl = MakeTextBox();
            _baseUrl.SetBounds(x, 148, cw, 30);
            _card.Controls.Add(_baseUrl);
            Label baseHint = MakeLabel("必须包含 API 版本路径，例如 https://api.deepseek.com/v1；程序会追加 /chat/completions。", Theme.Tiny, Palette.Muted);
            baseHint.SetBounds(x, 181, cw, 18);
            _card.Controls.Add(baseHint);

            Label keyLabel = FieldLabel("API Key");
            keyLabel.SetBounds(x, 210, 180, 18);
            _card.Controls.Add(keyLabel);
            _apiKey = MakeTextBox();
            _apiKey.UseSystemPasswordChar = true;
            _apiKey.SetBounds(x, 230, cw - 86, 30);
            _card.Controls.Add(_apiKey);
            _showKey = new CheckBox();
            _showKey.Text = "显示";
            _showKey.Font = Theme.Small;
            _showKey.ForeColor = Palette.Muted;
            _showKey.FlatStyle = FlatStyle.Flat;
            _showKey.SetBounds(x + cw - 78, 232, 70, 24);
            _showKey.CheckedChanged += delegate { _apiKey.UseSystemPasswordChar = !_showKey.Checked; };
            _card.Controls.Add(_showKey);
            Label keyHint = MakeLabel("Key 以 Windows DPAPI 加密保存在 CrushLens_Data；切换接口会清空旧 Key，避免发错平台。", Theme.Tiny, Palette.Muted);
            keyHint.SetBounds(x, 263, cw, 18);
            _card.Controls.Add(keyHint);

            Label modelLabel = FieldLabel("模型 ID");
            modelLabel.SetBounds(x, 292, 180, 18);
            _card.Controls.Add(modelLabel);
            _model = MakeCombo();
            _model.DropDownStyle = ComboBoxStyle.DropDown;
            _model.SetBounds(x, 312, cw - 130, 30);
            _card.Controls.Add(_model);
            _fetchButton = new PillButton();
            _fetchButton.Text = "获取模型列表";
            _fetchButton.Kind = ButtonKind.Secondary;
            _fetchButton.SetBounds(x + cw - 120, 309, 120, 34);
            _fetchButton.Click += FetchClicked;
            _card.Controls.Add(_fetchButton);

            _jsonMode = new CheckBox();
            _jsonMode.Text = "启用 JSON 模式（推荐；不兼容时自动重试）";
            _jsonMode.Font = Theme.Small;
            _jsonMode.ForeColor = Palette.InkSoft;
            _jsonMode.FlatStyle = FlatStyle.Flat;
            _jsonMode.SetBounds(x, 360, 360, 24);
            _card.Controls.Add(_jsonMode);

            _remember = new CheckBox();
            _remember.Text = "记住 Key（本机加密）";
            _remember.Font = Theme.Small;
            _remember.ForeColor = Palette.InkSoft;
            _remember.FlatStyle = FlatStyle.Flat;
            _remember.SetBounds(x + 370, 360, 240, 24);
            _card.Controls.Add(_remember);

            Label note = MakeLabel("主界面不会显示完整 Key。若不想保存，可取消勾选；取消后 Key 只留在本次运行的内存中。", Theme.Tiny, Palette.Muted);
            note.SetBounds(x, 388, cw, 18);
            _card.Controls.Add(note);

            Panel divider = new Panel();
            divider.BackColor = Palette.Line;
            divider.SetBounds(x, 416, cw, 1);
            _card.Controls.Add(divider);

            _testStatus = MakeLabel("还没有检测过连接。", Theme.Small, Palette.Muted);
            _testStatus.SetBounds(x, 432, cw - 140, 36);
            _card.Controls.Add(_testStatus);

            _testButton = new PillButton();
            _testButton.Text = "检测连接";
            _testButton.Kind = ButtonKind.Soft;
            _testButton.SetBounds(x + cw - 118, 429, 118, 34);
            _testButton.Click += TestClicked;
            _card.Controls.Add(_testButton);

            Label path = FieldLabel("本地数据目录");
            path.SetBounds(x, 480, 120, 18);
            _card.Controls.Add(path);
            _dataPath = MakeLabel(AppPaths.DataDir, Theme.Tiny, Palette.Muted);
            _dataPath.SetBounds(x, 499, cw - 116, 18);
            _card.Controls.Add(_dataPath);
            _openData = new PillButton();
            _openData.Text = "打开目录";
            _openData.Kind = ButtonKind.Ghost;
            _openData.SetBounds(x + cw - 104, 490, 104, 30);
            _openData.Click += delegate
            {
                try
                {
                    AppPaths.EnsureData();
                    System.Diagnostics.Process.Start("explorer.exe", "\"" + AppPaths.DataDir + "\"");
                }
                catch (Exception ex) { UiDialog.Error(this, "无法打开目录", ex.Message); }
            };
            _card.Controls.Add(_openData);

            _cancelButton = new PillButton();
            _cancelButton.Text = "取消";
            _cancelButton.Kind = ButtonKind.Secondary;
            _cancelButton.SetBounds(Width - 28 - 92, Height - 62, 92, 36);
            _cancelButton.Click += delegate { DialogResult = DialogResult.Cancel; Close(); };
            Controls.Add(_cancelButton);

            _saveButton = new PillButton();
            _saveButton.Text = "保存设置";
            _saveButton.Kind = ButtonKind.Primary;
            _saveButton.SetBounds(Width - 28 - 92 - 108, Height - 62, 100, 36);
            _saveButton.Click += SaveClicked;
            Controls.Add(_saveButton);

            Label footerNote = MakeLabel("不会上传聊天、Key 或使用记录到 CrushLens 服务器。", Theme.Tiny, Palette.Muted);
            footerNote.SetBounds(28, Height - 58, 430, 28);
            Controls.Add(footerNote);

            _provider.SelectedIndexChanged += ProviderChanged;
            LoadSettings(settings);
            Paint += FormPaint;
            MouseDown += HeaderDrag;
            KeyDown += FormKeyDown;
            FormClosing += FormClosingHandler;
            Shown += delegate
            {
                Native.EnableRoundedCorners(Handle);
                _apiKey.Focus();
            };
        }

        private Label MakeLabel(string text, Font font, Color color)
        {
            Label l = new Label();
            l.Text = text;
            l.Font = font;
            l.ForeColor = color;
            l.BackColor = Color.Transparent;
            l.AutoSize = false;
            return l;
        }

        private Label FieldLabel(string text)
        {
            Label l = MakeLabel(text, Theme.SmallBold, Palette.Ink);
            l.AutoSize = false;
            return l;
        }

        private TextBox MakeTextBox()
        {
            TextBox t = new TextBox();
            t.Font = Theme.Body;
            t.BorderStyle = BorderStyle.FixedSingle;
            t.BackColor = Palette.CardSoft;
            t.ForeColor = Palette.Ink;
            t.Height = 30;
            return t;
        }

        private ComboBox MakeCombo()
        {
            ComboBox c = new ComboBox();
            c.Font = Theme.Small;
            c.FlatStyle = FlatStyle.Flat;
            c.BackColor = Palette.CardSoft;
            c.ForeColor = Palette.Ink;
            c.Height = 30;
            return c;
        }

        private void LoadSettings(AppSettings s)
        {
            _presetLoading = true;
            ProviderPreset match = null;
            for (int i = 0; i < _presets.Length; i++)
            {
                if (string.Equals(_presets[i].Name, s.Provider, StringComparison.OrdinalIgnoreCase)) match = _presets[i];
            }
            if (match == null)
            {
                for (int i = 0; i < _presets.Length; i++)
                {
                    if (string.Equals(_presets[i].BaseUrl, s.BaseUrl, StringComparison.OrdinalIgnoreCase)) match = _presets[i];
                }
            }
            _provider.SelectedItem = match != null ? (object)match : _presets[_presets.Length - 1];
            _baseUrl.Text = s.BaseUrl;
            _apiKey.Text = s.ApiKey;
            _model.Text = s.Model;
            _lastBaseUrl = _baseUrl.Text;
            _jsonMode.Checked = s.JsonMode;
            _remember.Checked = s.RememberKey;
            _presetLoading = false;
            UpdateKeyLink();
        }

        private void ProviderChanged(object sender, EventArgs e)
        {
            if (_presetLoading) return;
            ProviderPreset p = _provider.SelectedItem as ProviderPreset;
            if (p == null) return;
            if (!string.IsNullOrEmpty(p.BaseUrl))
            {
                _baseUrl.Text = p.BaseUrl;
                _model.Text = p.Model;
            }
            if (!string.IsNullOrEmpty(_lastBaseUrl) &&
                !string.Equals(_lastBaseUrl, _baseUrl.Text, StringComparison.OrdinalIgnoreCase) &&
                !string.IsNullOrEmpty(_apiKey.Text))
            {
                _apiKey.Text = "";
                _testStatus.ForeColor = Palette.Amber;
                _testStatus.Text = "已切换接口，请重新填写该平台的 API Key。";
            }
            _lastBaseUrl = _baseUrl.Text;
            UpdateKeyLink();
        }

        private void UpdateKeyLink()
        {
            ProviderPreset p = _provider.SelectedItem as ProviderPreset;
            _keyLink.Visible = p != null && !string.IsNullOrEmpty(p.KeyPage);
            if (_keyLink.Visible) _keyLink.Text = "去申请 Key  →";
        }

        private void OpenKeyPage()
        {
            ProviderPreset p = _provider.SelectedItem as ProviderPreset;
            if (p == null || string.IsNullOrEmpty(p.KeyPage)) return;
            try { System.Diagnostics.Process.Start(p.KeyPage); }
            catch (Exception ex) { UiDialog.Error(this, "无法打开网页", ex.Message); }
        }

        private AppSettings Collect()
        {
            AppSettings s = new AppSettings();
            ProviderPreset p = _provider.SelectedItem as ProviderPreset;
            s.Provider = p != null ? p.Name : "自定义";
            s.BaseUrl = _baseUrl.Text.Trim();
            s.Model = _model.Text.Trim();
            s.ApiKey = _apiKey.Text.Trim();
            s.JsonMode = _jsonMode.Checked;
            s.RememberKey = _remember.Checked;
            s.AnalysisLimit = _original.AnalysisLimit;
            return s;
        }

        private bool Validate(AppSettings s, bool requireKey)
        {
            Uri uri;
            if (string.IsNullOrEmpty(s.BaseUrl) || !Uri.TryCreate(s.BaseUrl, UriKind.Absolute, out uri) ||
                (uri.Scheme != "http" && uri.Scheme != "https"))
            {
                UiDialog.Warn(this, "Base URL 不正确", "请填写完整的 http:// 或 https:// 地址。");
                _baseUrl.Focus();
                return false;
            }
            if (string.IsNullOrEmpty(s.Model))
            {
                UiDialog.Warn(this, "缺少模型 ID", "请填写模型 ID，例如 deepseek-chat。");
                _model.Focus();
                return false;
            }
            if (requireKey && string.IsNullOrEmpty(s.ApiKey) && !TextKit.IsLocalEndpoint(s.BaseUrl))
            {
                if (!UiDialog.Confirm(this, "没有填写 API Key", "当前地址看起来不是本机接口。没有 Key 通常无法调用；仍要保存吗？"))
                    return false;
            }
            return true;
        }

        private void SaveClicked(object sender, EventArgs e)
        {
            AppSettings s = Collect();
            if (!Validate(s, true)) return;
            try
            {
                Storage.SaveSettings(s);
                Result = s;
                DialogResult = DialogResult.OK;
                Close();
            }
            catch (Exception ex)
            {
                Log.Error("保存设置失败", ex);
                UiDialog.Error(this, "保存失败", ex.Message);
            }
        }

        private async void TestClicked(object sender, EventArgs e)
        {
            AppSettings s = Collect();
            if (!Validate(s, false)) return;
            SetBusy(true);
            _testStatus.ForeColor = Palette.Muted;
            _testStatus.Text = "正在检测连接（会消耗少量 API 额度）…";
            _cts = new CancellationTokenSource();
            try
            {
                ApiOutcome outcome = await LlmClient.TestAsync(s, _cts.Token);
                if (IsDisposed) return;
                _testStatus.ForeColor = outcome.Ok ? Palette.Green : Palette.RoseDark;
                _testStatus.Text = outcome.Message;
            }
            catch (Exception ex)
            {
                if (!IsDisposed)
                {
                    _testStatus.ForeColor = Palette.RoseDark;
                    _testStatus.Text = "检测失败：" + ex.Message;
                }
            }
            finally
            {
                if (_cts != null) { _cts.Dispose(); _cts = null; }
                if (!IsDisposed) SetBusy(false);
            }
        }

        private async void FetchClicked(object sender, EventArgs e)
        {
            AppSettings s = Collect();
            if (!Validate(s, false)) return;
            SetBusy(true);
            _testStatus.ForeColor = Palette.Muted;
            _testStatus.Text = "正在获取模型列表…";
            _cts = new CancellationTokenSource();
            try
            {
                ApiOutcome outcome = await LlmClient.ListModelsAsync(s, _cts.Token);
                if (IsDisposed) return;
                if (outcome.Ok)
                {
                    string selected = _model.Text.Trim();
                    _model.Items.Clear();
                    for (int i = 0; i < outcome.Models.Count; i++) _model.Items.Add(outcome.Models[i]);
                    if (!string.IsNullOrEmpty(selected) && !_model.Items.Contains(selected)) _model.Items.Insert(0, selected);
                    _model.Text = selected;
                    _testStatus.ForeColor = Palette.Green;
                    _testStatus.Text = "找到 " + outcome.Models.Count + " 个模型，点击下拉选择或保留当前值。";
                }
                else
                {
                    _testStatus.ForeColor = Palette.Amber;
                    _testStatus.Text = outcome.Message;
                }
            }
            catch (Exception ex)
            {
                if (!IsDisposed)
                {
                    _testStatus.ForeColor = Palette.RoseDark;
                    _testStatus.Text = "获取模型失败：" + ex.Message;
                }
            }
            finally
            {
                if (_cts != null) { _cts.Dispose(); _cts = null; }
                if (!IsDisposed) SetBusy(false);
            }
        }

        private void SetBusy(bool busy)
        {
            _testButton.Enabled = !busy;
            _fetchButton.Enabled = !busy;
            _saveButton.Enabled = !busy;
            _cancelButton.Enabled = !busy;
            _testButton.Text = busy ? "检测中…" : "检测连接";
        }

        private void HeaderPaint(object sender, PaintEventArgs e)
        {
            using (Pen p = new Pen(Palette.Line)) e.Graphics.DrawLine(p, 0, _header.Height - 1, _header.Width, _header.Height - 1);
        }

        private void FormPaint(object sender, PaintEventArgs e)
        {
            using (Pen p = new Pen(Palette.LineStrong)) e.Graphics.DrawRectangle(p, 0, 0, Width - 1, Height - 1);
        }

        private void HeaderDrag(object sender, MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left && e.Y < 70) Native.DragWindow(Handle);
        }

        private void FormKeyDown(object sender, KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Escape && _testButton.Enabled)
            {
                DialogResult = DialogResult.Cancel;
                Close();
            }
        }

        private void FormClosingHandler(object sender, FormClosingEventArgs e)
        {
            if (_cts != null)
            {
                _cts.Cancel();
                _cts.Dispose();
                _cts = null;
            }
        }
    }
}
