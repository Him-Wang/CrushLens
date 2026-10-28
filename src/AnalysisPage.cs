using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using WinTimer = System.Windows.Forms.Timer;

namespace CrushLens
{
    public class AnalysisPage : UserControl
    {
        public AppSettings Settings;
        public Func<bool> OpenSettings;
        public Action<string> Toast;
        public event EventHandler DataChanged;

        private readonly Label _title;
        private readonly Label _subtitle;
        private readonly PillButton _editButton;
        private readonly PillButton _exportButton;
        private readonly PillButton _newButton;
        private readonly Panel _body;
        private readonly CardPanel _inputCard;
        private readonly CardPanel _chatCard;
        private readonly ReportCanvas _reportCanvas;
        private readonly PlaceholderTextBox _inputBox;
        private readonly MediaPicker _mediaPicker;
        private readonly Label _parseStatus;
        private readonly LinkLabel _sampleLink;
        private readonly ComboBox _meCombo;
        private readonly ComboBox _crushCombo;
        private readonly ComboBox _stageCombo;
        private readonly ComboBox _modeCombo;
        private readonly ComboBox _limitCombo;
        private readonly Label _meLabel;
        private readonly Label _crushLabel;
        private readonly Label _stageLabel;
        private readonly Label _limitLabel;
        private readonly NoteBox _privacyNote;
        private readonly PillButton _analyzeButton;
        private readonly PillButton _importButton;
        private readonly Label _chatTitle;
        private readonly Label _chatMeta;
        private readonly ChatCanvas _chatCanvas;
        private readonly WinTimer _parseTimer;
        private readonly WinTimer _phaseTimer;
        private readonly string[] _phases = new string[]
        {
            "正在拆解互动信号…",
            "正在对照六个行为维度…",
            "正在寻找可执行的下一步…"
        };

        private ChatSession _session;
        private ParseResult _parsed;
        private CancellationTokenSource _cts;
        private bool _analyzing;
        private int _phaseIndex;
        private string _mode = Scoring.CrushMode;
        private bool _suppressMode;

        public void CancelWork()
        {
            try
            {
                if (_cts != null) _cts.Cancel();
                _parseTimer.Stop();
                _phaseTimer.Stop();
            }
            catch
            {
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                CancelWork();
                if (_parseTimer != null) _parseTimer.Dispose();
                if (_phaseTimer != null) _phaseTimer.Dispose();
            }
            base.Dispose(disposing);
        }

        public AnalysisPage()
        {
            BackColor = Palette.Bg;
            DoubleBuffered = true;
            AllowDrop = true;

            _title = MakeLabel("分析台", Theme.H1, Palette.Ink);
            _subtitle = MakeLabel("把一段聊天，变成一份看得懂、不过度解读的心动报告。", Theme.Small, Palette.Muted);
            Controls.Add(_title);
            Controls.Add(_subtitle);

            _newButton = new PillButton();
            _newButton.Text = "新建分析";
            _newButton.Kind = ButtonKind.Primary;
            _newButton.Click += delegate { NewAnalysis(); };
            Controls.Add(_newButton);

            _exportButton = new PillButton();
            _exportButton.Text = "导出报告";
            _exportButton.Kind = ButtonKind.Secondary;
            _exportButton.Enabled = false;
            _exportButton.Click += delegate { ExportReport(); };
            Controls.Add(_exportButton);

            _editButton = new PillButton();
            _editButton.Text = "编辑记录";
            _editButton.Kind = ButtonKind.Ghost;
            _editButton.Visible = false;
            _editButton.Click += delegate { EditCurrent(); };
            Controls.Add(_editButton);

            _body = new Panel();
            _body.BackColor = Palette.Bg;
            Controls.Add(_body);

            _inputCard = new CardPanel();
            _inputCard.FillColor = Palette.Card;
            _body.Controls.Add(_inputCard);

            _chatCard = new CardPanel();
            _chatCard.FillColor = Palette.Card;
            _chatCard.Visible = false;
            _body.Controls.Add(_chatCard);

            _reportCanvas = new ReportCanvas();
            _reportCanvas.CopyRequested += delegate(string msg) { if (Toast != null) Toast(msg); };
            _body.Controls.Add(_reportCanvas);

            Label inputTitle = MakeLabel("导入聊天记录", Theme.H3, Palette.Ink);
            inputTitle.Location = new Point(20, 18);
            inputTitle.AutoSize = true;
            _inputCard.Controls.Add(inputTitle);
            Label inputSub = MakeLabel("支持微信 / QQ / WhatsApp / 通用文本 · 可附加截图与表情包", Theme.Tiny, Palette.Muted);
            inputSub.Location = new Point(20, 42);
            inputSub.AutoSize = true;
            _inputCard.Controls.Add(inputSub);

            _sampleLink = new LinkLabel();
            _sampleLink.Text = "载入示例";
            _sampleLink.Font = Theme.Small;
            _sampleLink.LinkColor = Palette.RoseDark;
            _sampleLink.ActiveLinkColor = Palette.RoseDeep;
            _sampleLink.VisitedLinkColor = Palette.RoseDark;
            _sampleLink.LinkBehavior = LinkBehavior.HoverUnderline;
            _sampleLink.BackColor = Color.Transparent;
            _sampleLink.Cursor = Cursors.Hand;
            _sampleLink.Click += delegate
            {
                _inputBox.Text = DemoData.SampleChat;
                ParseNow();
                if (Toast != null) Toast("已载入示例聊天，可先看本地统计，再配置 API。");
            };
            _inputCard.Controls.Add(_sampleLink);

            _inputBox = new PlaceholderTextBox();
            _inputBox.PlaceholderText = "把聊天记录粘贴到这里…\n\n支持微信、QQ、WhatsApp 与「昵称: 内容」通用文本，\n也可以直接拖入 .txt / .json，并在下方添加截图或表情包。";
            _inputBox.TextChanged += InputTextChanged;
            _inputBox.AllowDrop = true;
            _inputBox.InnerTextBox.AllowDrop = true;
            _inputBox.InnerTextBox.KeyDown += InputKeyDown;
            _inputBox.InnerTextBox.DragEnter += DragEnterFile;
            _inputBox.InnerTextBox.DragDrop += DragDropFile;
            _inputCard.Controls.Add(_inputBox);

            _mediaPicker = new MediaPicker();
            _mediaPicker.Notify = delegate(string msg) { if (Toast != null) Toast(msg); };
            _mediaPicker.Changed += MediaChanged;
            _mediaPicker.AllowDrop = true;
            _inputCard.Controls.Add(_mediaPicker);

            _parseStatus = MakeLabel("尚未导入聊天。", Theme.Tiny, Palette.Muted);
            _parseStatus.AutoSize = false;
            _inputCard.Controls.Add(_parseStatus);

            _meLabel = MakeFieldLabel("我是");
            _crushLabel = MakeFieldLabel("对方是");
            _stageLabel = MakeFieldLabel("关系阶段");
            _limitLabel = MakeFieldLabel("分析范围");
            _inputCard.Controls.Add(_meLabel);
            _inputCard.Controls.Add(_crushLabel);
            _inputCard.Controls.Add(_stageLabel);
            _inputCard.Controls.Add(_limitLabel);

            _meCombo = MakeCombo();
            _crushCombo = MakeCombo();
            _stageCombo = MakeCombo();
            _limitCombo = MakeCombo();
            _modeCombo = MakeCombo();
            _meCombo.SelectedIndexChanged += ParticipantChanged;
            _crushCombo.SelectedIndexChanged += ParticipantChanged;
            _modeCombo.Items.AddRange(new object[] { "Crush 心动", "情侣关系" });
            _modeCombo.SelectedIndex = 0;
            _modeCombo.SelectedIndexChanged += ModeChanged;
            _stageCombo.Items.AddRange(Scoring.Stages(Scoring.CrushMode));
            _stageCombo.SelectedIndex = 1;
            _limitCombo.Items.AddRange(new object[] { "最近 80 条", "最近 120 条", "最近 200 条" });
            _limitCombo.SelectedIndex = 1;
            _inputCard.Controls.Add(_meCombo);
            _inputCard.Controls.Add(_crushCombo);
            _inputCard.Controls.Add(_stageCombo);
            _inputCard.Controls.Add(_limitCombo);
            _inputCard.Controls.Add(_modeCombo);

            _privacyNote = new NoteBox();
            _privacyNote.Title = "关于隐私";
            _privacyNote.Body = "尚未配置 API。点击分析会先打开设置；密钥只保存在本机。";
            _inputCard.Controls.Add(_privacyNote);

            _importButton = new PillButton();
            _importButton.Text = "导入文件";
            _importButton.Kind = ButtonKind.Secondary;
            _importButton.Click += delegate { ImportFile(); };
            _inputCard.Controls.Add(_importButton);

            _analyzeButton = new PillButton();
            _analyzeButton.Text = "开始分析";
            _analyzeButton.Kind = ButtonKind.Primary;
            _analyzeButton.Enabled = false;
            _analyzeButton.Click += AnalyzeClicked;
            _inputCard.Controls.Add(_analyzeButton);

            _chatTitle = MakeLabel("聊天逐句", Theme.H3, Palette.Ink);
            _chatTitle.AutoSize = true;
            _chatCard.Controls.Add(_chatTitle);
            _chatMeta = MakeLabel("", Theme.Tiny, Palette.Muted);
            _chatMeta.AutoSize = true;
            _chatCard.Controls.Add(_chatMeta);
            _chatCanvas = new ChatCanvas();
            _chatCard.Controls.Add(_chatCanvas);

            _parseTimer = new WinTimer();
            _parseTimer.Interval = 420;
            _parseTimer.Tick += delegate
            {
                _parseTimer.Stop();
                ParseNow();
            };
            _phaseTimer = new WinTimer();
            _phaseTimer.Interval = 3600;
            _phaseTimer.Tick += delegate
            {
                if (!_analyzing) return;
                _phaseIndex = (_phaseIndex + 1) % _phases.Length;
                _reportCanvas.UpdatePhase(_phases[_phaseIndex]);
            };

            Resize += PageResize;
            DragEnter += DragEnterFile;
            DragDrop += DragDropFile;
            _reportCanvas.SetEmpty(_mode);
            PageResize(null, EventArgs.Empty);
            UpdatePrivacyNote();
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

        private Label MakeFieldLabel(string text)
        {
            Label l = MakeLabel(text, Theme.Tiny, Palette.Muted);
            l.AutoSize = true;
            return l;
        }

        private ComboBox MakeCombo()
        {
            ComboBox c = new ComboBox();
            c.DropDownStyle = ComboBoxStyle.DropDownList;
            c.FlatStyle = FlatStyle.Flat;
            c.Font = Theme.Small;
            c.BackColor = Palette.CardSoft;
            c.ForeColor = Palette.Ink;
            c.Height = 30;
            return c;
        }

        private void PageResize(object sender, EventArgs e)
        {
            int pad = 26;
            int top = 14;
            _title.SetBounds(pad, top, 300, 36);
            _subtitle.SetBounds(pad + 2, top + 40, Math.Max(300, Width - pad * 2 - 360), 22);

            int buttonY = top + 12;
            _newButton.SetBounds(Width - pad - 112, buttonY, 112, 36);
            _exportButton.SetBounds(Width - pad - 112 - 108, buttonY, 100, 36);
            _editButton.SetBounds(Width - pad - 112 - 108 - 92, buttonY, 84, 36);

            int bodyTop = 78;
            int bodyBottom = 20;
            _body.SetBounds(pad, bodyTop, Math.Max(400, Width - pad * 2), Math.Max(300, Height - bodyTop - bodyBottom));
            int gap = 18;
            int w = _body.ClientSize.Width;
            int h = _body.ClientSize.Height;
            int lw = (int)Math.Round((w - gap) * 0.59);
            int rw = w - gap - lw;
            _inputCard.SetBounds(0, 0, lw, h);
            _chatCard.SetBounds(0, 0, lw, h);
            _reportCanvas.SetBounds(lw + gap, 0, rw, h);

            LayoutInputCard();
            _chatTitle.Location = new Point(20, 18);
            _chatMeta.Location = new Point(20, 42);
            _chatCanvas.SetBounds(0, 64, _chatCard.Width, Math.Max(50, _chatCard.Height - 64));
        }

        private void LayoutInputCard()
        {
            int w = _inputCard.ClientSize.Width;
            int h = _inputCard.ClientSize.Height;
            if (w < 100 || h < 300) return;
            _modeCombo.SetBounds(w - 224, 18, 118, 24);
            _sampleLink.SetBounds(w - 94, 18, 74, 22);
            _inputBox.SetBounds(20, 66, w - 40, Math.Max(96, h - 412));
            _mediaPicker.SetBounds(20, _inputBox.Bottom + 8, w - 40, 82);
            _parseStatus.SetBounds(22, _mediaPicker.Bottom + 4, w - 44, 20);

            int labelY = _parseStatus.Bottom + 8;
            int comboY = labelY + 20;
            int gap = 10;
            int avail = w - 40;
            int cw = (avail - gap * 3) / 4;
            _meLabel.Location = new Point(20, labelY);
            _crushLabel.Location = new Point(20 + cw + gap, labelY);
            _stageLabel.Location = new Point(20 + (cw + gap) * 2, labelY);
            _limitLabel.Location = new Point(20 + (cw + gap) * 3, labelY);
            _meCombo.SetBounds(20, comboY, cw, 30);
            _crushCombo.SetBounds(20 + cw + gap, comboY, cw, 30);
            _stageCombo.SetBounds(20 + (cw + gap) * 2, comboY, cw, 30);
            _limitCombo.SetBounds(20 + (cw + gap) * 3, comboY, cw, 30);

            int buttonY = h - 56;
            _privacyNote.SetBounds(20, buttonY - 84, w - 40, 72);
            _importButton.SetBounds(20, buttonY, 98, 36);
            _analyzeButton.SetBounds(w - 20 - 148, buttonY, 148, 36);
        }

        private void InputTextChanged(object sender, EventArgs e)
        {
            if (_analyzing) return;
            _parseTimer.Stop();
            _parseTimer.Start();
            _parseStatus.Text = "正在识别…";
            _parseStatus.ForeColor = Palette.Muted;
        }

        private void MediaChanged(object sender, EventArgs e)
        {
            if (_analyzing) return;
            EnsureImageParticipants();
            if (!string.IsNullOrWhiteSpace(_inputBox.Text)) ParseNow();
            else
            {
                if (_mediaPicker.Count > 0)
                {
                    _parseStatus.Text = "仅图片分析 · " + _mediaPicker.Count + " 张图片（需视觉模型）";
                    _parseStatus.ForeColor = Palette.Amber;
                }
                else
                {
                    _parseStatus.Text = "尚未导入聊天。";
                    _parseStatus.ForeColor = Palette.Muted;
                }
            }
            UpdatePrivacyNote();
            UpdateAnalyzeEnabled();
        }

        private void EnsureImageParticipants()
        {
            if (_mediaPicker == null || _mediaPicker.Count == 0) return;
            if (_meCombo.Items.Count == 0)
            {
                _meCombo.Items.Add("我");
                _crushCombo.Items.Add(Scoring.OtherDefaultName(_mode));
            }
            if (_meCombo.SelectedIndex < 0 && _meCombo.Items.Count > 0) _meCombo.SelectedIndex = 0;
            if (_crushCombo.SelectedIndex < 0 && _crushCombo.Items.Count > 0)
                _crushCombo.SelectedIndex = Math.Min(1, _crushCombo.Items.Count - 1);
        }

        private void InputKeyDown(object sender, KeyEventArgs e)
        {
            if (e.Control && e.KeyCode == Keys.Enter)
            {
                e.SuppressKeyPress = true;
                if (_analyzeButton.Enabled) AnalyzeClicked(null, EventArgs.Empty);
            }
        }

        private void ParseNow()
        {
            string text = _inputBox.Text;
            if (string.IsNullOrWhiteSpace(text))
            {
                _parsed = null;
                if (_mediaPicker != null && _mediaPicker.Count > 0)
                {
                    EnsureImageParticipants();
                    _parseStatus.Text = "仅图片分析 · " + _mediaPicker.Count + " 张图片（需视觉模型）";
                    _parseStatus.ForeColor = Palette.Amber;
                }
                else
                {
                    _parseStatus.Text = "尚未导入聊天。";
                    _parseStatus.ForeColor = Palette.Muted;
                    _meCombo.Items.Clear();
                    _crushCombo.Items.Clear();
                    _meCombo.Items.Add("我");
                    _crushCombo.Items.Add(Scoring.OtherDefaultName(_mode));
                    _meCombo.SelectedIndex = 0;
                    _crushCombo.SelectedIndex = 0;
                }
                UpdateAnalyzeEnabled();
                return;
            }
            try
            {
                ParseResult parsed = ChatParser.Parse(text);
                _parsed = parsed;
                UpdateNameCombos(parsed);
                if (parsed.Messages.Count == 0)
                {
                    if (_mediaPicker != null && _mediaPicker.Count > 0)
                    {
                        EnsureImageParticipants();
                        _parseStatus.Text = "未识别到文字，将只分析 " + _mediaPicker.Count + " 张图片（需视觉模型）";
                        _parseStatus.ForeColor = Palette.Amber;
                    }
                    else
                    {
                        _parseStatus.Text = string.IsNullOrEmpty(parsed.Warning) ? "没有识别到消息。" : parsed.Warning;
                        _parseStatus.ForeColor = Palette.RoseDark;
                    }
                }
                else
                {
                    string span = "";
                    long first = 0, last = 0;
                    for (int i = 0; i < parsed.Messages.Count; i++)
                    {
                        long ts = parsed.Messages[i].Timestamp;
                        if (ts <= 0) continue;
                        if (first == 0 || ts < first) first = ts;
                        if (last == 0 || ts > last) last = ts;
                    }
                    if (first > 0) span = " · " + Fmt.ShortDate(first) + " – " + Fmt.ShortDate(last);
                    string status = "已识别 " + parsed.Messages.Count + " 条 · " + parsed.Names.Count + " 位发言人" + span;
                    if (!string.IsNullOrEmpty(parsed.Warning))
                    {
                        status += "  ·  " + parsed.Warning;
                        _parseStatus.ForeColor = Palette.Amber;
                    }
                    else
                    {
                        _parseStatus.ForeColor = Palette.Green;
                    }
                    if (parsed.Names.Count > 2)
                        status += "  ·  当前只分析你选择的两个人";
                    if (_mediaPicker != null && _mediaPicker.Count > 0)
                        status += "  ·  附 " + _mediaPicker.Count + " 张图片";
                    _parseStatus.Text = status;
                }
            }
            catch (Exception ex)
            {
                Log.Write("WARN 解析聊天失败： " + ex.GetType().Name + "（聊天原文不写入日志）。");
                _parsed = null;
                _parseStatus.Text = "识别失败：" + ex.Message;
                _parseStatus.ForeColor = Palette.RoseDark;
            }
            UpdateAnalyzeEnabled();
        }

        private void UpdateNameCombos(ParseResult parsed)
        {
            string oldMe = _meCombo.SelectedItem as string;
            string oldCrush = _crushCombo.SelectedItem as string;
            _meCombo.Items.Clear();
            _crushCombo.Items.Clear();
            if (parsed == null) return;
            int n = Math.Min(10, parsed.Names.Count);
            for (int i = 0; i < n; i++)
            {
                _meCombo.Items.Add(parsed.Names[i]);
                _crushCombo.Items.Add(parsed.Names[i]);
            }
            string me = "";
            string crush = "";
            if (!string.IsNullOrEmpty(oldMe) && parsed.Names.Contains(oldMe)) me = oldMe;
            if (!string.IsNullOrEmpty(oldCrush) && parsed.Names.Contains(oldCrush)) crush = oldCrush;
            if (string.IsNullOrEmpty(me))
            {
                for (int i = 0; i < parsed.Names.Count; i++)
                {
                    string name = parsed.Names[i];
                    if (name == "我" || string.Equals(name, "Me", StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(name, "myself", StringComparison.OrdinalIgnoreCase))
                    {
                        me = name;
                        break;
                    }
                }
            }
            if (string.IsNullOrEmpty(me) && n > 0) me = parsed.Names[0];
            if (string.IsNullOrEmpty(crush) || crush == me)
            {
                for (int i = 0; i < parsed.Names.Count; i++)
                {
                    if (!string.Equals(parsed.Names[i], me, StringComparison.OrdinalIgnoreCase))
                    {
                        crush = parsed.Names[i];
                        break;
                    }
                }
            }
            if (!string.IsNullOrEmpty(me)) _meCombo.SelectedItem = me;
            if (!string.IsNullOrEmpty(crush)) _crushCombo.SelectedItem = crush;
        }

        private void ModeChanged(object sender, EventArgs e)
        {
            if (_suppressMode) return;
            _mode = _modeCombo.SelectedIndex == 1 ? Scoring.CoupleMode : Scoring.CrushMode;
            ApplyModeUi(true);
            UpdatePrivacyNote();
            UpdateAnalyzeEnabled();
        }

        private void SetMode(string mode, bool resetStage)
        {
            _suppressMode = true;
            _mode = Scoring.NormalizeMode(mode);
            _modeCombo.SelectedIndex = Scoring.IsCouple(_mode) ? 1 : 0;
            _suppressMode = false;
            ApplyModeUi(resetStage);
        }

        private void ApplyModeUi(bool resetStage)
        {
            bool couple = Scoring.IsCouple(_mode);
            _subtitle.Text = couple
                ? "把一段关系里的聊天，变成一份看得懂、不过度诊断的连接报告。"
                : "把一段聊天，变成一份看得懂、不过度解读的心动报告。";
            _crushLabel.Text = couple ? "伴侣是" : "对方是";
            string current = _stageCombo.SelectedItem as string;
            string[] stages = Scoring.Stages(_mode);
            _stageCombo.Items.Clear();
            _stageCombo.Items.AddRange(stages);
            int existing = Array.IndexOf(stages, current);
            if (!resetStage && existing >= 0) _stageCombo.SelectedIndex = existing;
            else _stageCombo.SelectedItem = Scoring.DefaultStage(_mode);
            _inputBox.PlaceholderText = couple
                ? "把你们的聊天记录粘贴到这里…\n\n也可以直接拖入 .txt / .json，并在下方添加截图或表情包。"
                : "把聊天记录粘贴到这里…\n\n支持微信、QQ、WhatsApp 与「昵称: 内容」通用文本，\n也可以直接拖入 .txt / .json，并在下方添加截图或表情包。";
            if (string.IsNullOrWhiteSpace(_inputBox.Text) && (_mediaPicker == null || _mediaPicker.Count == 0))
            {
                _meCombo.Items.Clear();
                _crushCombo.Items.Clear();
                _meCombo.Items.Add("我");
                _crushCombo.Items.Add(Scoring.OtherDefaultName(_mode));
                _meCombo.SelectedIndex = 0;
                _crushCombo.SelectedIndex = 0;
            }
            if (_inputCard.Visible && _session == null) _reportCanvas.SetEmpty(_mode);
        }

        private void ParticipantChanged(object sender, EventArgs e)
        {
            UpdateAnalyzeEnabled();
        }

        private void UpdateAnalyzeEnabled()
        {
            bool hasText = _parsed != null && _parsed.Messages.Count >= 4;
            bool hasMedia = _mediaPicker != null && _mediaPicker.Count > 0;
            bool ok = !_analyzing && (hasText || hasMedia) &&
                      _meCombo.SelectedItem != null && _crushCombo.SelectedItem != null &&
                      !string.Equals((string)_meCombo.SelectedItem, (string)_crushCombo.SelectedItem, StringComparison.OrdinalIgnoreCase);
            _analyzeButton.Enabled = ok;
        }

        public void ApplySettings(AppSettings settings)
        {
            Settings = settings;
            UpdatePrivacyNote();
        }

        private void UpdatePrivacyNote()
        {
            if (_privacyNote == null) return;
            if (Settings != null && Settings.HasKey)
            {
                string model = string.IsNullOrEmpty(Settings.Model) ? "未设置模型" : Settings.Model;
                _privacyNote.Title = "隐私与发送范围";
                _privacyNote.Body = "已配置 " + Settings.Provider + " · " + model + "。点击分析后，只会把本次聊天节选" +
                    (_mediaPicker != null && _mediaPicker.Count > 0 ? "和 " + _mediaPicker.Count + " 张图片" : "") +
                    "发送到你填写的 API；不经过 CrushLens 服务器。";
            }
            else if (Settings != null && TextKit.IsLocalEndpoint(Settings.BaseUrl))
            {
                _privacyNote.Title = "本地接口";
                _privacyNote.Body = "当前接口看起来在本机，可以不填 Key。聊天节选仍会发送到该接口，请确认它确实由你控制。";
            }
            else
            {
                _privacyNote.Title = "关于隐私";
                _privacyNote.Body = "尚未配置 API。点击分析会先打开设置；密钥只以 Windows 加密形式保存在本机数据目录。";
            }
        }

        private async void AnalyzeClicked(object sender, EventArgs e)
        {
            if (_analyzing)
            {
                if (_cts != null) _cts.Cancel();
                return;
            }
            _parseTimer.Stop();
            ParseNow();
            int mediaCount = _mediaPicker != null ? _mediaPicker.Count : 0;
            if (mediaCount > 0) EnsureImageParticipants();
            if ((_parsed == null || _parsed.Messages.Count == 0) && mediaCount == 0)
            {
                UiDialog.Warn(this, "聊天还不够", "至少需要 4 条双方消息，或附加 1 张聊天截图 / 表情包。请检查格式，或先载入示例。");
                return;
            }
            if (_parsed != null && _parsed.Messages.Count > 0 && _parsed.Messages.Count < 4 && mediaCount == 0)
            {
                UiDialog.Warn(this, "聊天还不够", "至少需要 4 条双方消息。也可以附加聊天截图后用视觉模型一起分析。");
                return;
            }

            string me = _meCombo.SelectedItem as string;
            string crush = _crushCombo.SelectedItem as string;
            if (mediaCount > 0)
            {
                if (string.IsNullOrEmpty(me)) me = "我";
                if (string.IsNullOrEmpty(crush)) crush = "对方";
            }
            if (string.IsNullOrEmpty(me) || string.IsNullOrEmpty(crush) || string.Equals(me, crush, StringComparison.OrdinalIgnoreCase))
            {
                UiDialog.Warn(this, "请选择两个人", "「我是」和「对方是」需要选择不同的发言人。");
                return;
            }

            if (Settings == null || (!Settings.HasKey && !TextKit.IsLocalEndpoint(Settings.BaseUrl)))
            {
                if (OpenSettings != null) OpenSettings();
                else if (Toast != null) Toast("还没有配置 API Key，请先打开设置。");
                if (Settings == null || (!Settings.HasKey && !TextKit.IsLocalEndpoint(Settings.BaseUrl)))
                    return;
            }

            List<ChatMessage> messages = _parsed != null ? _parsed.Messages : new List<ChatMessage>();
            int selectedCount = 0;
            for (int i = 0; i < messages.Count; i++)
            {
                ChatMessage m = messages[i];
                if (StatsEngine.SameName(m.Sender, me) || StatsEngine.SameName(m.Sender, crush)) selectedCount++;
            }
            if (selectedCount < 4 && mediaCount == 0)
            {
                UiDialog.Warn(this, "消息太少", "你选择的两个人之间只有 " + selectedCount + " 条消息，样本不足。");
                return;
            }

            ChatSession session = new ChatSession();
            session.Id = Guid.NewGuid().ToString("N");
            session.Title = me + "  ×  " + crush;
            session.MeName = me;
            session.CrushName = crush;
            session.Mode = _mode;
            session.Stage = _stageCombo.SelectedItem as string;
            session.RawText = _inputBox.Text;
            session.Provider = Settings.Provider;
            session.Model = Settings.Model;
            session.AnalysisLimit = GetLimit();
            session.CreatedAt = TimeUtil.NowMs();
            session.UpdatedAt = session.CreatedAt;
            session.Messages = messages;
            session.Media = _mediaPicker != null ? _mediaPicker.ToChatMedia() : new List<ChatMedia>();
            session.Stats = StatsEngine.Compute(session.Messages, me, crush);
            _session = session;

            AnalysisInput input = LlmClient.BuildInput(session, session.AnalysisLimit);
            input.Settings = Settings;
            input.ImageOnly = messages.Count == 0 && input.Media.Count > 0;
            if (input.ImageOnly == false && input.Sample.Count == 0)
            {
                UiDialog.Warn(this, "没有可分析的内容", "图片附件读取失败，或文字聊天不足。请重新添加图片。");
                return;
            }
            if (input.Sample.Count < 4 && mediaCount == 0)
            {
                UiDialog.Warn(this, "样本不足", "可发送给模型的聊天节选太少，请再补充一些记录。");
                return;
            }

            _analyzing = true;
            _phaseIndex = 0;
            _cts = new CancellationTokenSource();
            _newButton.Enabled = false;
            _editButton.Enabled = false;
            _exportButton.Enabled = false;
            _analyzeButton.Text = "取消分析";
            _analyzeButton.Kind = ButtonKind.Danger;
            _analyzeButton.Enabled = true;
            ShowChat(session);
            _reportCanvas.SetLoading(_phases[0]);
            _phaseTimer.Start();
            if (Toast != null) Toast("正在分析…" + input.Sample.Count + " 条文字" +
                (mediaCount > 0 ? " + " + mediaCount + " 张图片" : "") + "，不会上传到 CrushLens。");

            try
            {
                AiReport report = await LlmClient.AnalyzeAsync(input, _cts.Token);
                if (IsDisposed) return;
                if (_cts.IsCancellationRequested) throw new OperationCanceledException();
                session.Report = report;
                session.UpdatedAt = TimeUtil.NowMs();
                if (!session.IsDemo)
                {
                    try { Storage.SaveSession(session); }
                    catch (Exception ex)
                    {
                        Log.Error("保存会话失败", ex);
                        if (Toast != null) Toast("报告已生成，但保存到本地失败：" + ex.Message);
                    }
                }
                _reportCanvas.SetReport(session);
                ShowChat(session);
                _exportButton.Enabled = true;
                _editButton.Visible = true;
                if (DataChanged != null) DataChanged(this, EventArgs.Empty);
                if (Toast != null) Toast("报告已生成" + (session.IsDemo ? "" : "，并保存在本机。"));
            }
            catch (OperationCanceledException)
            {
                if (IsDisposed) return;
                ChatSession canceled = _session;
                _session = null;
                _reportCanvas.SetEmpty(_mode);
                ShowInput(canceled != null ? canceled.RawText : "", canceled != null ? canceled.Media : null);
                if (Toast != null) Toast("已取消分析。");
            }
            catch (LlmException ex)
            {
                Log.Error("分析失败", ex);
                if (IsDisposed) return;
                _reportCanvas.SetError(ex.Message);
                _exportButton.Enabled = false;
                _editButton.Visible = true;
                if (Toast != null) Toast("分析没有完成，右侧有具体原因。");
            }
            catch (Exception ex)
            {
                Log.Error("分析异常", ex);
                if (IsDisposed) return;
                _reportCanvas.SetError("发生了一个未预期的错误：" + ex.Message);
                _exportButton.Enabled = false;
                _editButton.Visible = true;
                if (Toast != null) Toast("分析没有完成，右侧有具体原因。");
            }
            finally
            {
                if (!IsDisposed)
                {
                    _phaseTimer.Stop();
                    _analyzing = false;
                    _analyzeButton.Text = "开始分析";
                    _analyzeButton.Kind = ButtonKind.Primary;
                    _newButton.Enabled = true;
                    _editButton.Enabled = true;
                    UpdateAnalyzeEnabled();
                }
                if (_cts != null) { _cts.Dispose(); _cts = null; }
            }
        }

        private int GetLimit()
        {
            int idx = _limitCombo.SelectedIndex;
            if (idx == 0) return 80;
            if (idx == 2) return 200;
            return 120;
        }

        private void ShowChat(ChatSession session)
        {
            if (session != null) SetMode(session.Mode, false);
            _inputCard.Visible = false;
            _chatCard.Visible = true;
            _chatCanvas.SetSession(session);
            int selected = _chatCanvas.ShownMessages;
            int mediaCount = session.Media != null ? session.Media.Count : 0;
            _chatTitle.Text = selected == 0 && mediaCount > 0
                ? "图片 / 表情包"
                : (Scoring.IsCouple(session.Mode) ? "关系对话" : "聊天逐句");
            string meta;
            if (selected == 0 && mediaCount > 0)
            {
                meta = "仅图片分析 · " + mediaCount + " 张图片";
            }
            else
            {
                meta = "共 " + selected + " 条双方消息";
                if (mediaCount > 0) meta += " · 含 " + mediaCount + " 张图片";
                if (_chatCanvas.TaggedMessages > 0) meta += " · AI 标注最近 " + _chatCanvas.TaggedMessages + " 条";
                if (_chatCanvas.TotalSelected > selected) meta += " · 仅显示最近 " + selected + " 条";
            }
            _chatMeta.Text = meta;
            _chatMeta.Location = new Point(20, 42);
            _chatCanvas.SetBounds(0, 64, _chatCard.Width, Math.Max(50, _chatCard.Height - 64));
            _editButton.Visible = true;
        }

        private void ShowInput(string raw)
        {
            ShowInput(raw, null);
        }

        private void ShowInput(string raw, List<ChatMedia> media)
        {
            _inputCard.Visible = true;
            _chatCard.Visible = false;
            _chatCanvas.Clear();
            _reportCanvas.SetEmpty(_mode);
            _exportButton.Enabled = false;
            _editButton.Visible = false;
            _session = null;
            _inputBox.Text = raw ?? "";
            if (media != null && media.Count > 0) _mediaPicker.SetFromSession(media);
            else _mediaPicker.Clear();
            ParseNow();
            if (string.IsNullOrEmpty(raw))
            {
                _inputBox.FocusInput();
            }
            UpdateAnalyzeEnabled();
        }

        public void NewAnalysis()
        {
            if (_analyzing)
            {
                if (_cts != null) _cts.Cancel();
                return;
            }
            ShowInput("", null);
            SetMode(_mode, true);
        }

        public void EditCurrent()
        {
            if (_analyzing) return;
            string raw = "";
            List<ChatMedia> media = null;
            string mode = _mode;
            string stage = _stageCombo.SelectedItem as string;
            if (_session != null)
            {
                raw = !string.IsNullOrEmpty(_session.RawText) ? _session.RawText : SessionToRaw(_session);
                media = _session.Media;
                mode = _session.Mode;
                stage = _session.Stage;
            }
            ShowInput(raw, media);
            SetMode(mode, true);
            if (!string.IsNullOrEmpty(stage)) _stageCombo.SelectedItem = stage;
        }

        private string SessionToRaw(ChatSession s)
        {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < s.Messages.Count; i++)
            {
                ChatMessage m = s.Messages[i];
                string time = m.Timestamp > 0 ? TimeUtil.FromMs(m.Timestamp).ToString("yyyy-MM-dd HH:mm") + " " : "";
                sb.AppendLine(m.Sender + ": " + time + (m.Content ?? ""));
            }
            return sb.ToString();
        }

        public void LoadSession(ChatSession session)
        {
            if (session == null) return;
            _session = session;
            if (session.Messages == null) session.Messages = new List<ChatMessage>();
            if (session.Media == null) session.Media = new List<ChatMedia>();
            Storage.LoadMedia(session);
            session.Stats = StatsEngine.Compute(session.Messages, session.MeName, session.CrushName);
            SetMode(session.Mode, true);
            _stageCombo.SelectedItem = session.Stage;
            _meCombo.Items.Clear();
            _crushCombo.Items.Clear();
            string[] names = new string[] { session.MeName, session.CrushName };
            _meCombo.Items.AddRange(names);
            _crushCombo.Items.AddRange(names);
            _meCombo.SelectedItem = session.MeName;
            _crushCombo.SelectedItem = session.CrushName;
            if (session.Report != null)
            {
                ShowChat(session);
                _reportCanvas.SetReport(session);
                _exportButton.Enabled = true;
                _editButton.Visible = true;
            }
            else
            {
                string raw = !string.IsNullOrEmpty(session.RawText) ? session.RawText : SessionToRaw(session);
                ShowInput(raw, session.Media);
            }
        }

        public ChatSession CurrentSession
        {
            get { return _session; }
        }

        private void ExportReport()
        {
            if (_session == null || _session.Report == null)
            {
                UiDialog.Info(this, "还没有报告", "先完成一次分析，再导出。");
                return;
            }
            using (SaveFileDialog dlg = new SaveFileDialog())
            {
                dlg.Title = "导出 CrushLens 报告";
                dlg.Filter = "HTML 报告 (*.html)|*.html";
                dlg.FileName = "CrushLens_" + TextKit.SafeFileName(_session.CrushName) + "_" + Fmt.FileStamp() + ".html";
                dlg.InitialDirectory = AppPaths.ExportsDir;
                if (dlg.ShowDialog(this) != DialogResult.OK) return;
                try
                {
                    string html = ReportExporter.BuildHtml(_session);
                    File.WriteAllText(dlg.FileName, html, new UTF8Encoding(false));
                    if (Toast != null) Toast("报告已导出，可用浏览器打开或打印为 PDF。");
                }
                catch (Exception ex)
                {
                    Log.Error("导出报告失败", ex);
                    UiDialog.Error(this, "导出失败", ex.Message);
                }
            }
        }

        private void ImportFile()
        {
            using (OpenFileDialog dlg = new OpenFileDialog())
            {
                dlg.Title = "导入聊天记录";
                dlg.Filter = "聊天文件 (*.txt;*.json)|*.txt;*.json|文本文件 (*.txt)|*.txt|JSON 文件 (*.json)|*.json|所有文件 (*.*)|*.*";
                if (dlg.ShowDialog(this) != DialogResult.OK) return;
                LoadFile(dlg.FileName);
            }
        }

        private void LoadFile(string path)
        {
            try
            {
                string text = TextKit.ReadAllTextSmart(path);
                if (text.Length > 1200000 && !UiDialog.Confirm(this, "文件很大", "文件约 " + (text.Length / 1024 / 1024 + 1) + " MB，粘贴确认后可能占用较多内存。仍要导入吗？"))
                    return;
                _inputBox.Text = text;
                ParseNow();
                if (Toast != null) Toast("已导入 " + Path.GetFileName(path) + "。");
            }
            catch (Exception ex)
            {
                Log.Error("读取聊天文件失败", ex);
                UiDialog.Error(this, "无法读取文件", ex.Message);
            }
        }

        private void DragEnterFile(object sender, DragEventArgs e)
        {
            if (e.Data != null && e.Data.GetDataPresent(DataFormats.FileDrop))
            {
                string[] files = e.Data.GetData(DataFormats.FileDrop) as string[];
                if (files != null && files.Length > 0)
                {
                    for (int i = 0; i < files.Length; i++)
                    {
                        string ext = Path.GetExtension(files[i]).ToLowerInvariant();
                        if (ext == ".txt" || ext == ".json" || MediaUtil.IsImageFile(files[i]))
                        {
                            e.Effect = DragDropEffects.Copy;
                            break;
                        }
                    }
                }
            }
        }

        private void DragDropFile(object sender, DragEventArgs e)
        {
            if (e.Data == null || !e.Data.GetDataPresent(DataFormats.FileDrop)) return;
            string[] files = e.Data.GetData(DataFormats.FileDrop) as string[];
            if (files == null || files.Length == 0) return;
            List<string> images = new List<string>();
            string textFile = "";
            for (int i = 0; i < files.Length; i++)
            {
                if (MediaUtil.IsImageFile(files[i])) images.Add(files[i]);
                else
                {
                    string ext = Path.GetExtension(files[i]).ToLowerInvariant();
                    if ((ext == ".txt" || ext == ".json") && string.IsNullOrEmpty(textFile)) textFile = files[i];
                }
            }
            if (images.Count > 0) _mediaPicker.AddPaths(this, images.ToArray());
            if (!string.IsNullOrEmpty(textFile)) LoadFile(textFile);
        }
    }
}
