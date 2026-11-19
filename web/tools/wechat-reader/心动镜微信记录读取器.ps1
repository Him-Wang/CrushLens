<#
.SYNOPSIS
    心动镜微信记录读取器：从本机微信电脑版只读提取聊天记录，导出为心动镜可解析的文本。

.DESCRIPTION
    本工具全程只读：不向微信进程写入任何内存、不注入代码、不需要管理员权限、不监听任何端口。
    工作流程：识别微信版本 -> 只读扫描进程内存定位数据库密钥 -> 用 SQLCipher 参数校验密钥
    -> 将解密后的数据库临时文件写入导出目录 -> 列出会话 -> 选择范围 -> 导出 UTF-8 文本。

    导出的每一行格式为：yyyy-MM-dd HH:mm:ss 昵称：消息内容
    该格式可被 web/assets/engine.js 的 parseChat 直接识别。

.PARAMETER SelfTest
    运行离线自检。不依赖微信进程，全部使用内存中的合成数据。

.PARAMETER ExportDir
    可选。自定义导出目录，默认为 %USERPROFILE%\Documents\心动镜导入\。

.EXAMPLE
    powershell -File "心动镜微信记录读取器.ps1" -SelfTest

.EXAMPLE
    powershell -File "心动镜微信记录读取器.ps1"
#>
param(
    [switch]$SelfTest,
    [string]$ExportDir = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# ============================================================================
# 第一段：内嵌 C# 代码。全部使用 .NET Framework 4.8 及以下可用的 API。
# 包含三部分：SQLCipher 加解密、只读进程内存、最小 SQLite 读取器。
# ============================================================================
$csharpSource = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

// ----------------------------------------------------------------------------
// 1) SQLCipher 页面加解密。
//    约定（与工具内部的校验流程一致）：
//      文件布局 = 16 字节盐 + N 个 4096 字节加密页
//      页内布局 = 16 字节 IV + 密文 + HMAC + 保留字节
//      保留区大小 = Align16(HMAC长度 + 16)，SHA512 与 SHA1 均为 48 字节
//      明文页头部仍保留 SQLite 的 "SQLite format 3\0" 魔数
// ----------------------------------------------------------------------------
public static class XinDongCrypto
{
    public const int PageSize = 4096;
    public const int SaltSize = 16;
    public const int IvSize = 16;

    // 手写 PBKDF2，避免依赖高版本 .NET 的 Rfc2898DeriveBytes 重载
    private static byte[] Pbkdf2(byte[] password, byte[] salt, int iterations, int dkLen, bool sha512)
    {
        int hLen = sha512 ? 64 : 20;
        int blocks = (dkLen + hLen - 1) / hLen;
        byte[] result = new byte[blocks * hLen];
        byte[] input = new byte[salt.Length + 4];
        Array.Copy(salt, 0, input, 0, salt.Length);
        HMAC hmac = sha512 ? (HMAC)new HMACSHA512(password) : new HMACSHA1(password);
        try
        {
            for (int b = 1; b <= blocks; b++)
            {
                input[salt.Length] = (byte)(b >> 24);
                input[salt.Length + 1] = (byte)(b >> 16);
                input[salt.Length + 2] = (byte)(b >> 8);
                input[salt.Length + 3] = (byte)b;
                byte[] u = hmac.ComputeHash(input);
                byte[] t = (byte[])u.Clone();
                for (int i = 1; i < iterations; i++)
                {
                    u = hmac.ComputeHash(u);
                    for (int k = 0; k < hLen; k++) { t[k] ^= u[k]; }
                }
                Array.Copy(t, 0, result, (b - 1) * hLen, hLen);
            }
        }
        finally { hmac.Dispose(); }
        byte[] outBytes = new byte[dkLen];
        Array.Copy(result, 0, outBytes, 0, dkLen);
        return outBytes;
    }

    // fastKdf=false：按任务约定单次 PBKDF2 派生 32 字节 AES 密钥 + HMAC 密钥
    // fastKdf=true ：真实 SQLCipher 4 的做法，主密钥派生后再用 2 次迭代派生 HMAC 密钥
    private static void DeriveKeys(byte[] password, byte[] salt, int iterations, bool sha512,
        bool fastKdf, out byte[] aesKey, out byte[] hmacKey)
    {
        int hmacLen = sha512 ? 32 : 20;
        if (!fastKdf)
        {
            byte[] dk = Pbkdf2(password, salt, iterations, 32 + hmacLen, sha512);
            aesKey = new byte[32];
            hmacKey = new byte[hmacLen];
            Array.Copy(dk, 0, aesKey, 0, 32);
            Array.Copy(dk, 32, hmacKey, 0, hmacLen);
        }
        else
        {
            aesKey = Pbkdf2(password, salt, iterations, 32, sha512);
            hmacKey = Pbkdf2(aesKey, salt, 2, hmacLen, sha512);
        }
    }

    public static int GetReserve(bool sha512)
    {
        int raw = (sha512 ? 32 : 20) + IvSize;
        return (raw + 15) & ~15;
    }

    private static byte[] AesTransform(byte[] data, byte[] key, byte[] iv, bool encrypt)
    {
        using (AesManaged aes = new AesManaged())
        {
            aes.Key = key;
            aes.IV = iv;
            aes.Mode = CipherMode.CBC;
            aes.Padding = PaddingMode.None;
            using (ICryptoTransform t = encrypt ? aes.CreateEncryptor() : aes.CreateDecryptor())
            {
                return t.TransformFinalBlock(data, 0, data.Length);
            }
        }
    }

    // 加密一整页：明文页前 (4096 - reserve) 字节作为密文，IV/HMAC 写入保留区
    private static byte[] EncryptPage(byte[] plainPage, byte[] password, byte[] salt,
        int iterations, bool sha512, bool fastKdf)
    {
        byte[] aesKey, hmacKey;
        DeriveKeys(password, salt, iterations, sha512, fastKdf, out aesKey, out hmacKey);
        int cipherLen = PageSize - GetReserve(sha512);
        int hmacLen = sha512 ? 32 : 20;

        byte[] iv = new byte[IvSize];
        byte[] seed = new byte[password.Length + salt.Length];
        Array.Copy(password, 0, seed, 0, password.Length);
        Array.Copy(salt, 0, seed, password.Length, salt.Length);
        using (MD5 md5 = MD5.Create())
        {
            byte[] h = md5.ComputeHash(seed);
            Array.Copy(h, 0, iv, 0, IvSize);
        }

        byte[] cipher = AesTransform(SubArray(plainPage, 0, cipherLen), aesKey, iv, true);
        byte[] macInput = new byte[IvSize + cipherLen];
        Array.Copy(iv, 0, macInput, 0, IvSize);
        Array.Copy(cipher, 0, macInput, IvSize, cipherLen);
        byte[] mac;
        using (HMAC h = sha512 ? (HMAC)new HMACSHA512(hmacKey) : new HMACSHA1(hmacKey))
        {
            mac = h.ComputeHash(macInput);
        }

        byte[] page = new byte[PageSize];
        Array.Copy(iv, 0, page, 0, IvSize);
        Array.Copy(cipher, 0, page, IvSize, cipherLen);
        Array.Copy(mac, 0, page, IvSize + cipherLen, hmacLen);
        return page;
    }

    private static byte[] SubArray(byte[] src, int off, int len)
    {
        byte[] r = new byte[len];
        Array.Copy(src, off, r, 0, len);
        return r;
    }

    // 解密并校验第一页。只有明文头部出现 SQLite 魔数才返回 true。
    public static bool TryDecryptFirstPage(byte[] fileBytes, byte[] password, int iterations,
        bool sha512, bool fastKdf, out byte[] plaintextPage)
    {
        plaintextPage = null;
        if (fileBytes == null || fileBytes.Length < SaltSize + PageSize) { return false; }
        int reserve = GetReserve(sha512);
        int cipherLen = PageSize - reserve;
        byte[] salt = SubArray(fileBytes, 0, SaltSize);
        byte[] iv = SubArray(fileBytes, SaltSize, IvSize);
        byte[] cipher = SubArray(fileBytes, SaltSize + IvSize, cipherLen);

        byte[] plain;
        try
        {
            byte[] aesKey, hmacKey;
            DeriveKeys(password, salt, iterations, sha512, fastKdf, out aesKey, out hmacKey);
            plain = AesTransform(cipher, aesKey, iv, false);
        }
        catch (Exception) { return false; }

        byte[] magic = Encoding.ASCII.GetBytes("SQLite format 3\0");
        for (int i = 0; i < magic.Length; i++)
        {
            if (plain[i] != magic[i]) { return false; }
        }

        byte[] full = new byte[PageSize];
        Array.Copy(plain, 0, full, 0, cipherLen);
        full[20] = (byte)reserve;
        plaintextPage = full;
        return true;
    }

    public static bool ValidateFile(byte[] fileBytes, byte[] password, int iterations,
        bool sha512, bool fastKdf)
    {
        byte[] dummy;
        return TryDecryptFirstPage(fileBytes, password, iterations, sha512, fastKdf, out dummy);
    }

    // 解密整个数据库（每一页独立 IV）。只在内存中完成，写盘由 PowerShell 负责。
    public static bool TryDecryptDatabase(byte[] fileBytes, byte[] password, int iterations,
        bool sha512, bool fastKdf, out byte[] decrypted)
    {
        decrypted = null;
        byte[] first;
        if (!TryDecryptFirstPage(fileBytes, password, iterations, sha512, fastKdf, out first)) { return false; }
        int reserve = GetReserve(sha512);
        int cipherLen = PageSize - reserve;
        int pages = (fileBytes.Length - SaltSize) / PageSize;
        if (pages < 1) { return false; }

        byte[] salt = SubArray(fileBytes, 0, SaltSize);
        byte[] aesKey, hmacKey;
        DeriveKeys(password, salt, iterations, sha512, fastKdf, out aesKey, out hmacKey);
        byte[] outDb = new byte[pages * PageSize];
        Array.Copy(first, 0, outDb, 0, PageSize);

        try
        {
            for (int p = 2; p <= pages; p++)
            {
                int off = SaltSize + (p - 1) * PageSize;
                byte[] iv = SubArray(fileBytes, off, IvSize);
                byte[] cipher = SubArray(fileBytes, off + IvSize, cipherLen);
                byte[] plain = AesTransform(cipher, aesKey, iv, false);
                Array.Copy(plain, 0, outDb, (p - 1) * PageSize, cipherLen);
                outDb[(p - 1) * PageSize + 20] = (byte)reserve;
            }
        }
        catch (Exception) { return false; }

        decrypted = outDb;
        return true;
    }

    // 构造一个带 SQLite 魔数的合成数据库文件，供自检使用
    public static byte[] BuildSyntheticFile(byte[] password, int iterations, bool sha512, bool fastKdf)
    {
        byte[] salt = new byte[SaltSize];
        for (int i = 0; i < SaltSize; i++) { salt[i] = (byte)(i * 17 + 3); }
        byte[] plain = new byte[PageSize];
        byte[] magic = Encoding.ASCII.GetBytes("SQLite format 3\0");
        Array.Copy(magic, 0, plain, 0, magic.Length);
        plain[16] = 0x10; plain[17] = 0x00;
        plain[18] = 1; plain[19] = 1;
        plain[20] = (byte)GetReserve(sha512);
        plain[21] = 64; plain[23] = 32; plain[25] = 32;
        byte[] page = EncryptPage(plain, password, salt, iterations, sha512, fastKdf);
        byte[] file = new byte[SaltSize + PageSize];
        Array.Copy(salt, 0, file, 0, SaltSize);
        Array.Copy(page, 0, file, SaltSize, PageSize);
        return file;
    }

    // 加密一份明文 SQLite 数据库（自检中用于验证“整条链”）
    public static byte[] EncryptDatabase(byte[] plainDb, byte[] password, int iterations,
        bool sha512, bool fastKdf)
    {
        int pages = plainDb.Length / PageSize;
        byte[] salt = new byte[SaltSize];
        for (int i = 0; i < SaltSize; i++) { salt[i] = (byte)(i * 31 + 7); }
        byte[] file = new byte[SaltSize + pages * PageSize];
        Array.Copy(salt, 0, file, 0, SaltSize);
        for (int p = 1; p <= pages; p++)
        {
            byte[] plainPage = SubArray(plainDb, (p - 1) * PageSize, PageSize);
            byte[] page = EncryptPage(plainPage, password, salt, iterations, sha512, fastKdf);
            Array.Copy(page, 0, file, SaltSize + (p - 1) * PageSize, PageSize);
        }
        return file;
    }
}

// ----------------------------------------------------------------------------
// 2) 只读进程内存：OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION)
//    + ReadProcessMemory + VirtualQueryEx（枚举 MEM_PRIVATE 提交区，即“堆”）。
//    全程不调用 WriteProcessMemory，不注入，不提权。
// ----------------------------------------------------------------------------
public static class XinDongMem
{
    [StructLayout(LayoutKind.Sequential)]
    public class Region
    {
        public long Base;
        public long Size;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MEMORY_BASIC_INFORMATION
    {
        public IntPtr BaseAddress;
        public IntPtr AllocationBase;
        public uint AllocationProtect;
        public IntPtr RegionSize;
        public uint State;
        public uint Protect;
        public uint Type;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool ReadProcessMemory(IntPtr process, IntPtr address, byte[] buffer,
        UIntPtr size, out UIntPtr bytesRead);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr VirtualQueryEx(IntPtr process, IntPtr address,
        out MEMORY_BASIC_INFORMATION info, uint length);

    public static IntPtr Open(int pid)
    {
        // 0x0010 = PROCESS_VM_READ，0x0400 = PROCESS_QUERY_INFORMATION
        return OpenProcess(0x0010 | 0x0400, false, pid);
    }

    public static void Close(IntPtr handle)
    {
        if (handle != IntPtr.Zero) { CloseHandle(handle); }
    }

    public static byte[] ReadChunk(IntPtr process, long address, int size)
    {
        byte[] buffer = new byte[size];
        UIntPtr read;
        bool ok = ReadProcessMemory(process, new IntPtr(address), buffer, (UIntPtr)size, out read);
        if (!ok) { return null; }
        long n = (long)read.ToUInt64();
        if (n == size) { return buffer; }
        if (n <= 0) { return null; }
        byte[] trimmed = new byte[n];
        Array.Copy(buffer, 0, trimmed, 0, (int)n);
        return trimmed;
    }

    // 枚举已提交的私有内存区（堆通常位于此处）
    public static List<Region> EnumPrivateRegions(IntPtr process)
    {
        List<Region> result = new List<Region>();
        long maxAddr = IntPtr.Size == 8 ? 0x7FFFFFFFFFFFL : 0x7FFFFFFFL;
        long addr = 0;
        int steps = 0;
        int infoSize = Marshal.SizeOf(typeof(MEMORY_BASIC_INFORMATION));
        while (addr >= 0 && addr < maxAddr && steps < 200000)
        {
            steps++;
            MEMORY_BASIC_INFORMATION info;
            IntPtr r = VirtualQueryEx(process, new IntPtr(addr), out info, (uint)infoSize);
            if (r == IntPtr.Zero) { break; }
            long size = info.RegionSize.ToInt64();
            if (size <= 0) { break; }
            // 0x1000 = MEM_COMMIT，0x20000 = MEM_PRIVATE，0x01 = PAGE_NOACCESS，0x100 = PAGE_GUARD
            if (info.State == 0x1000 && info.Type == 0x20000 && size >= 4096 && size <= 268435456L)
            {
                uint protect = info.Protect;
                if (protect != 0x01 && (protect & 0x100) == 0)
                {
                    Region region = new Region();
                    region.Base = info.BaseAddress.ToInt64();
                    region.Size = size;
                    result.Add(region);
                }
            }
            long next = addr + size;
            if (next <= addr) { break; }
            addr = next;
        }
        return result;
    }

    private static bool IsHex(byte b)
    {
        return (b >= 48 && b <= 57) || (b >= 65 && b <= 70) || (b >= 97 && b <= 102);
    }

    // 识别 64 位十六进制 ASCII / UTF-16LE 字符串
    public static List<string> FindHexStrings(byte[] buf, int max)
    {
        List<string> found = new List<string>();
        if (buf == null) { return found; }
        int n = buf.Length;
        for (int i = 0; i < n; )
        {
            if (!IsHex(buf[i])) { i++; continue; }
            int start = i;
            while (i < n && IsHex(buf[i])) { i++; }
            if (i - start == 64 && (i == n || !IsHex(buf[i])))
            {
                string s = Encoding.ASCII.GetString(buf, start, 64);
                if (!found.Contains(s)) { found.Add(s); }
                if (found.Count >= max) { return found; }
            }
        }
        for (int i = 0; i + 127 < n; i += 2)
        {
            if (buf[i + 1] != 0) { continue; }
            int k = i;
            bool ok = true;
            for (int j = 0; j < 64; j++, k += 2)
            {
                if (k + 1 >= n || buf[k + 1] != 0 || !IsHex(buf[k])) { ok = false; break; }
            }
            if (!ok) { continue; }
            if (k + 1 < n && buf[k + 1] == 0 && IsHex(buf[k])) { continue; }
            byte[] ascii = new byte[64];
            for (int j = 0; j < 64; j++) { ascii[j] = buf[i + j * 2]; }
            string s = Encoding.ASCII.GetString(ascii);
            if (!found.Contains(s)) { found.Add(s); }
            if (found.Count >= max) { break; }
        }
        return found;
    }

    // 二进制 32 字节候选：按熵（不同字节数）打分，邻近数据库特征字符串则加权
    public static List<byte[]> FindBinaryCandidates(byte[] buf, int max)
    {
        List<byte[]> result = new List<byte[]>();
        if (buf == null || buf.Length < 32) { return result; }
        string[] markers = { ".db", "Msg", "msg", "WeChat", "wechat", "sqlite", "talker", "message" };
        List<object[]> scored = new List<object[]>();
        int n = buf.Length;
        for (int i = 0; i + 32 <= n; i += 16)
        {
            bool[] seen = new bool[256];
            int distinct = 0;
            for (int k = 0; k < 32; k++)
            {
                byte b = buf[i + k];
                if (!seen[b]) { seen[b] = true; distinct++; }
            }
            if (distinct < 22) { continue; }
            int bonus = 0;
            int lo = Math.Max(0, i - 96);
            int hi = Math.Min(n, i + 128);
            for (int p = lo; p < hi && bonus == 0; p++)
            {
                byte c = buf[p];
                if (c < 32 || c > 126) { continue; }
                for (int m = 0; m < markers.Length; m++)
                {
                    string mk = markers[m];
                    if (p + mk.Length > hi) { continue; }
                    bool match = true;
                    for (int q = 0; q < mk.Length; q++)
                    {
                        if (buf[p + q] != mk[q]) { match = false; break; }
                    }
                    if (match) { bonus = 40; break; }
                }
            }
            byte[] candidate = new byte[32];
            Array.Copy(buf, i, candidate, 0, 32);
            scored.Add(new object[] { distinct + bonus, candidate });
            if (scored.Count > 20000) { break; }
        }
        scored.Sort(delegate(object[] a, object[] b) { return ((int)b[0]).CompareTo((int)a[0]); });
        for (int i = 0; i < scored.Count && result.Count < max; i++)
        {
            result.Add((byte[])scored[i][1]);
        }
        return result;
    }
}

// ----------------------------------------------------------------------------
// 3) 最小 SQLite 读取器：直接解析 B 树页与记录格式，无需 System.Data.SQLite.dll。
//    支持 table b-tree（叶子 0x0D / 内部 0x05）、varint、记录序列号、溢出页。
// ----------------------------------------------------------------------------
public static class XinDongSqlite
{
    private static int Be16(byte[] b, int o) { return (b[o] << 8) | b[o + 1]; }

    private static long Be32(byte[] b, int o)
    {
        return ((long)b[o] << 24) | ((long)b[o + 1] << 16) | ((long)b[o + 2] << 8) | (long)b[o + 3];
    }

    private static int ReadVarint(byte[] b, int o, out int value)
    {
        long v = 0;
        for (int i = 0; i < 8; i++)
        {
            if (o + i >= b.Length) { value = 0; return i; }
            v = (v << 7) + (long)(b[o + i] & 0x7F);
            if ((b[o + i] & 0x80) == 0) { value = (int)v; return i + 1; }
        }
        if (o + 8 < b.Length) { v = (v << 8) + (long)b[o + 8]; }
        value = (int)v;
        return 9;
    }

    // SQLite varint 采用大端 7 位分组，最高位为继续标志
    private static byte[] EncodeVarint(long v)
    {
        if (v < 0) { v = 0; }
        byte[] tmp = new byte[9];
        int n = 8;
        tmp[n] = (byte)(v & 0x7F);
        v >>= 7;
        while (v > 0)
        {
            n--;
            tmp[n] = (byte)((v & 0x7F) | 0x80);
            v >>= 7;
        }
        byte[] r = new byte[9 - n];
        Array.Copy(tmp, n, r, 0, r.Length);
        return r;
    }

    private static void Put16(byte[] b, int o, int v)
    {
        b[o] = (byte)(v >> 8);
        b[o + 1] = (byte)v;
    }

    private static byte[] SubArray(byte[] src, int off, int len)
    {
        byte[] r = new byte[len];
        Array.Copy(src, off, r, 0, len);
        return r;
    }

    private static byte[] GetPayload(byte[] db, int pageSize, int usable, int pos, int len)
    {
        int maxLocal = usable - 35;
        int local = len;
        int overflowPg = 0;
        if (len > maxLocal)
        {
            int minLocal = ((usable - 12) * 32 / 255) - 23;
            local = minLocal + ((len - minLocal) % (usable - 4));
            if (local > maxLocal) { local = minLocal; }
            overflowPg = (int)Be32(db, pos + local);
        }
        if (overflowPg == 0) { return SubArray(db, pos, Math.Min(local, len)); }
        using (MemoryStream ms = new MemoryStream())
        {
            ms.Write(db, pos, local);
            int pg = overflowPg;
            int guard = 0;
            while (pg > 0 && guard++ < 100000 && ms.Length < len)
            {
                int off = (pg - 1) * pageSize;
                if (off + 4 > db.Length) { break; }
                int next = (int)Be32(db, off);
                int take = Math.Min(usable - 4, (int)(len - ms.Length));
                if (take <= 0) { break; }
                ms.Write(db, off + 4, take);
                pg = next;
            }
            return ms.ToArray();
        }
    }

    private static void CollectCells(byte[] db, int pageSize, int usable, int pgno,
        List<byte[]> payloads, int depth)
    {
        if (pgno <= 0 || depth > 64) { return; }
        int pageOff = (pgno - 1) * pageSize;
        if (pageOff + 1 >= db.Length) { return; }
        int h = pageOff + (pgno == 1 ? 100 : 0);
        if (h + 8 > db.Length) { return; }
        byte type = db[h];
        int cells = Be16(db, h + 3);
        if (cells < 0 || cells > 65535) { return; }
        for (int i = 0; i < cells; i++)
        {
            int ptrPos = h + 8 + i * 2;
            if (ptrPos + 2 > db.Length) { break; }
            int cell = pageOff + Be16(db, ptrPos);
            if (type == 0x0D)
            {
                int used;
                // ReadVarint 返回“占用的字节数”，out 参数返回“数值本身”
                int lenBytes = ReadVarint(db, cell, out used);
                int payloadLen = used;
                int pos = cell + lenBytes;
                int rowidBytes = ReadVarint(db, pos, out used);
                pos += rowidBytes;
                payloads.Add(GetPayload(db, pageSize, usable, pos, payloadLen));
            }
            else if (type == 0x05)
            {
                if (cell + 4 > db.Length) { break; }
                CollectCells(db, pageSize, usable, (int)Be32(db, cell), payloads, depth + 1);
            }
        }
        if (type == 0x05 && h + 12 <= db.Length)
        {
            CollectCells(db, pageSize, usable, (int)Be32(db, h + 8), payloads, depth + 1);
        }
    }

    public static List<object> DecodeRecord(byte[] payload)
    {
        List<object> values = new List<object>();
        if (payload == null || payload.Length < 1) { return values; }
        int used;
        // ReadVarint 返回字节数，out 参数返回数值
        int headerBytes = ReadVarint(payload, 0, out used);
        int headerSize = used;
        List<int> serials = new List<int>();
        int p = headerBytes;
        while (p < headerSize && p < payload.Length)
        {
            int v;
            int n = ReadVarint(payload, p, out v);
            if (n <= 0) { break; }
            serials.Add(v);
            p += n;
        }
        int d = headerSize;
        foreach (int s in serials)
        {
            object value = null;
            if (s == 0)
            {
                value = null;
            }
            else if (s >= 1 && s <= 6)
            {
                int len = (s == 1) ? 1 : (s == 2) ? 2 : (s == 3) ? 3 : (s == 4) ? 4 : (s == 5) ? 6 : 8;
                if (d + len <= payload.Length)
                {
                    long v = 0;
                    for (int i = 0; i < len; i++) { v = (v << 8) | payload[d + i]; }
                    if (len < 8 && (payload[d] & 0x80) != 0) { v -= (1L << (len * 8)); }
                    value = v;
                }
                d += len;
            }
            else if (s == 7)
            {
                if (d + 8 <= payload.Length) { value = BitConverter.ToDouble(payload, d); }
                d += 8;
            }
            else if (s == 8) { value = 0L; }
            else if (s == 9) { value = 1L; }
            else if (s >= 12)
            {
                int len = (s - 12) / 2;
                if (d + len <= payload.Length)
                {
                    if ((s & 1) == 0) { value = SubArray(payload, d, len); }
                    else { value = Encoding.UTF8.GetString(payload, d, len); }
                }
                d += len;
            }
            values.Add(value);
        }
        return values;
    }

    private static void FlushColumn(StringBuilder sb, List<string> cols)
    {
        string s = sb.ToString().Trim();
        if (s.Length == 0) { return; }
        string upper = s.ToUpperInvariant();
        if (upper.StartsWith("PRIMARY") || upper.StartsWith("CONSTRAINT") || upper.StartsWith("UNIQUE") ||
            upper.StartsWith("CHECK") || upper.StartsWith("FOREIGN")) { return; }
        int j = 0;
        while (j < s.Length && s[j] != ' ' && s[j] != '\t') { j++; }
        string name = s.Substring(0, j).Trim('"', '`', '[', ']');
        if (name.Length > 0) { cols.Add(name); }
    }

    private static List<string> ParseColumns(string sql)
    {
        List<string> cols = new List<string>();
        if (sql == null) { return cols; }
        int open = sql.IndexOf('(');
        if (open < 0) { return cols; }
        int depth = 0;
        char quote = '\0';
        StringBuilder cur = new StringBuilder();
        for (int i = open + 1; i < sql.Length; i++)
        {
            char c = sql[i];
            if (quote != '\0')
            {
                if (c == quote) { quote = '\0'; }
                else { cur.Append(c); }
                continue;
            }
            if (c == '\'' || c == '"' || c == '`') { quote = c; continue; }
            if (c == '(') { depth++; continue; }
            if (c == ')')
            {
                if (depth == 0) { FlushColumn(cur, cols); break; }
                depth--;
                continue;
            }
            if (c == ',' && depth == 0) { FlushColumn(cur, cols); cur.Length = 0; continue; }
            cur.Append(c);
        }
        return cols;
    }

    public static List<string> ListTables(byte[] db)
    {
        List<string> names = new List<string>();
        if (db == null || db.Length < 100) { return names; }
        int pageSize = (db[16] << 8) | db[17];
        if (pageSize == 1) { pageSize = 65536; }
        int usable = pageSize - db[20];
        List<byte[]> master = new List<byte[]>();
        CollectCells(db, pageSize, usable, 1, master, 0);
        foreach (byte[] payload in master)
        {
            List<object> row = DecodeRecord(payload);
            if (row.Count >= 2 && Convert.ToString(row[0]) == "table")
            {
                names.Add(Convert.ToString(row[1]));
            }
        }
        return names;
    }

    // 返回表内容；第 0 行为列名，后续行为数据（均为字符串，NULL 用空串表示）
    public static List<string[]> ReadTable(byte[] db, string table)
    {
        List<string[]> result = new List<string[]>();
        if (db == null || db.Length < 100) { return result; }
        int pageSize = (db[16] << 8) | db[17];
        if (pageSize == 1) { pageSize = 65536; }
        int usable = pageSize - db[20];
        List<byte[]> master = new List<byte[]>();
        CollectCells(db, pageSize, usable, 1, master, 0);
        int root = 0;
        string sql = "";
        foreach (byte[] payload in master)
        {
            List<object> row = DecodeRecord(payload);
            if (row.Count >= 5 && Convert.ToString(row[0]) == "table" && Convert.ToString(row[1]) == table)
            {
                root = Convert.ToInt32(row[3]);
                sql = Convert.ToString(row[4]);
                break;
            }
        }
        if (root == 0) { return result; }
        List<string> cols = ParseColumns(sql);
        result.Add(cols.ToArray());
        List<byte[]> cells = new List<byte[]>();
        CollectCells(db, pageSize, usable, root, cells, 0);
        foreach (byte[] payload in cells)
        {
            List<object> row = DecodeRecord(payload);
            string[] arr = new string[cols.Count];
            for (int i = 0; i < arr.Length && i < row.Count; i++)
            {
                object v = row[i];
                if (v == null) { arr[i] = ""; }
                else if (v is byte[]) { arr[i] = "<二进制>"; }
                else { arr[i] = Convert.ToString(v); }
            }
            result.Add(arr);
        }
        return result;
    }

    private static byte[] BuildRecord(object[] values)
    {
        List<byte> header = new List<byte>();
        List<byte> body = new List<byte>();
        foreach (object v in values)
        {
            if (v is string)
            {
                byte[] s = Encoding.UTF8.GetBytes((string)v);
                header.AddRange(EncodeVarint(13 + 2L * s.Length));
                body.AddRange(s);
            }
            else
            {
                long num = Convert.ToInt64(v);
                header.AddRange(EncodeVarint(6L));
                for (int i = 7; i >= 0; i--) { body.Add((byte)(num >> (i * 8))); }
            }
        }
        byte[] hb = header.ToArray();
        byte[] probe = EncodeVarint(hb.Length);
        int total = hb.Length + probe.Length;
        byte[] hlen = EncodeVarint(total);
        if (hlen.Length != probe.Length)
        {
            total = hb.Length + hlen.Length;
            hlen = EncodeVarint(total);
        }
        byte[] rec = new byte[hlen.Length + hb.Length + body.Count];
        Array.Copy(hlen, 0, rec, 0, hlen.Length);
        Array.Copy(hb, 0, rec, hlen.Length, hb.Length);
        Array.Copy(body.ToArray(), 0, rec, hlen.Length + hb.Length, body.Count);
        return rec;
    }

    private static void WriteLeafPage(byte[] db, int pgno, int headerOffset, byte[][] records)
    {
        int pageSize = 4096;
        int reserve = XinDongCrypto.GetReserve(true);
        int start = (pgno - 1) * pageSize;
        int h = start + headerOffset;
        db[h] = 0x0D;
        Put16(db, h + 3, records.Length);
        int cursor = start + pageSize - reserve;
        for (int i = 0; i < records.Length; i++)
        {
            byte[] payload = records[i];
            byte[] lenVar = EncodeVarint(payload.Length);
            byte[] rowVar = EncodeVarint(i + 1);
            int cellLen = lenVar.Length + rowVar.Length + payload.Length;
            cursor -= cellLen;
            Array.Copy(lenVar, 0, db, cursor, lenVar.Length);
            Array.Copy(rowVar, 0, db, cursor + lenVar.Length, rowVar.Length);
            Array.Copy(payload, 0, db, cursor + lenVar.Length + rowVar.Length, payload.Length);
            Put16(db, h + 8 + i * 2, cursor - start);
        }
        Put16(db, h + 5, cursor - start);
    }

    // 构造一个两页的、合法的 SQLite 数据库（含 Session 表和两行数据）
    public static byte[] BuildTestDatabase()
    {
        int pageSize = 4096;
        byte[] db = new byte[2 * pageSize];
        byte[] magic = Encoding.ASCII.GetBytes("SQLite format 3\0");
        Array.Copy(magic, 0, db, 0, magic.Length);
        db[16] = 0x10; db[17] = 0x00;
        db[18] = 1; db[19] = 1;
        db[20] = (byte)XinDongCrypto.GetReserve(true);
        db[21] = 64; db[23] = 32; db[25] = 32;
        db[28] = 1;
        db[32] = 0; db[33] = 0; db[34] = 0; db[35] = 2;
        db[44] = 1;
        db[46] = 4;
        db[56] = 0; db[57] = 0; db[58] = 0; db[59] = 1;
        db[64] = 1;

        string sql = "CREATE TABLE Session(talker TEXT, nickname TEXT, last_time INTEGER, cnt INTEGER)";
        byte[] master = BuildRecord(new object[] { "table", "Session", "Session", 2, sql });
        WriteLeafPage(db, 1, 100, new byte[][] { master });

        byte[] row1 = BuildRecord(new object[] { "wxid_abc", "张三", 1700000000L, 12L });
        byte[] row2 = BuildRecord(new object[] { "12345@chatroom", "群聊", 1699990000L, 3L });
        WriteLeafPage(db, 2, 0, new byte[][] { row1, row2 });
        return db;
    }
}
'@
# ============================================================================

try {
    Add-Type -TypeDefinition $csharpSource -ErrorAction Stop
}
catch {
    Write-Host "[错误] 内部组件加载失败：$($_.Exception.Message)"
    exit 1
}

# ============================================================================
# 第二段：PowerShell 辅助函数
# ============================================================================

# 从文件版本字符串中提取主版本号。解析失败返回 0。
function Get-VersionMajor([string]$versionText) {
    if ([string]::IsNullOrWhiteSpace($versionText)) { return 0 }
    $match = [regex]::Match($versionText, '^(\d+)')
    if (-not $match.Success) { return 0 }
    return [int]$match.Groups[1].Value
}

# 根据主版本号返回 SQLCipher 参数
function Get-CipherProfile([int]$major) {
    if ($major -eq 3) {
        return @{ Iterations = 64000; Sha512 = $false; Label = '微信 3.x' }
    }
    if ($major -ge 4) {
        return @{ Iterations = 256000; Sha512 = $true; Label = '微信 4.x' }
    }
    return $null
}

# 十六进制字符串转字节数组（.NET Framework 4.8 没有 Convert.FromHexString）
function ConvertFrom-HexString([string]$text) {
    $length = $text.Length / 2
    $bytes = New-Object byte[] $length
    for ($i = 0; $i -lt $length; $i++) {
        $bytes[$i] = [Convert]::ToByte($text.Substring($i * 2, 2), 16)
    }
    return $bytes
}

# 生成导出文件名：名字-微信-YYYYMMDD.txt，并清理非法文件名字符
function Get-ExportFileName([string]$name, [datetime]$date) {
    $safe = $name
    foreach ($bad in [System.IO.Path]::GetInvalidFileNameChars()) {
        $safe = $safe.Replace([string]$bad, '_')
    }
    if ([string]::IsNullOrWhiteSpace($safe)) { $safe = '未命名会话' }
    return ('{0}-微信-{1:yyyyMMdd}.txt' -f $safe, $date)
}

# Unix 秒 -> 本地时间字符串
function ConvertFrom-UnixSecond([string]$seconds) {
    $value = 0
    if (-not [int64]::TryParse($seconds, [ref]$value)) { return '' }
    if ($value -le 0) { return '' }
    try {
        $dt = [DateTimeOffset]::FromUnixTimeSeconds($value).LocalDateTime
        return $dt.ToString('yyyy-MM-dd HH:mm:ss')
    }
    catch { return '' }
}

function Write-Check([bool]$passed, [string]$name, [string]$detail) {
    if ($passed) {
        if ([string]::IsNullOrEmpty($detail)) {
            Write-Host ('[PASS] ' + $name)
        }
        else {
            Write-Host ('[PASS] ' + $name + ' - ' + $detail)
        }
    }
    else {
        if ([string]::IsNullOrEmpty($detail)) {
            Write-Host ('[FAIL] ' + $name)
        }
        else {
            Write-Host ('[FAIL] ' + $name + ' - ' + $detail)
        }
        $script:SelfTestFailed = $true
    }
}

# ============================================================================
# 第三段：离线自检。完全不依赖微信进程与网络。
# ============================================================================
function Invoke-SelfTest {
    $script:SelfTestFailed = $false
    Write-Host '=== 心动镜微信记录读取器 - 离线自检 ==='

    # 1) 版本主版本号解析
    $v3 = Get-VersionMajor '3.9.5.81'
    $v4 = Get-VersionMajor '4.0.5.0'
    $bad = Get-VersionMajor '未知版本'
    Write-Check (($v3 -eq 3) -and ($v4 -eq 4) -and ($bad -eq 0)) '版本主版本号解析' "3.x=>$v3, 4.x=>$v4, 非法=>$bad"

    # 2) 64 位十六进制候选识别（含负例：63 位不应命中）
    try {
        $keyText = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
        $buf = New-Object byte[] 200
        $keyBytes = [System.Text.Encoding]::ASCII.GetBytes($keyText)
        [Array]::Copy($keyBytes, 0, $buf, 20, 64)
        $shortBytes = [System.Text.Encoding]::ASCII.GetBytes($keyText.Substring(0, 63))
        [Array]::Copy($shortBytes, 0, $buf, 100, 63)
        $found = [XinDongMem]::FindHexStrings($buf, 16)
        $hit = $found -contains $keyText
        $noShort = -not ($found | Where-Object { $_.Length -ne 64 })
        Write-Check ($hit -and $noShort) '十六进制候选识别' "命中=$hit, 候选数=$($found.Count)"
    }
    catch {
        Write-Check $false '十六进制候选识别' $_.Exception.Message
    }

    # 3) 合成数据库：正确密钥可以通过校验（两种派生模式都测）
    try {
        $password = [System.Text.Encoding]::ASCII.GetBytes('0123456789abcdef0123456789abcdef')
        $synthetic = [XinDongCrypto]::BuildSyntheticFile($password, 256000, $true, $false)
        $okA = [XinDongCrypto]::ValidateFile($synthetic, $password, 256000, $true, $false)
        $okB = [XinDongCrypto]::ValidateFile($synthetic, $password, 256000, $true, $true)
        $plain = $null
        $okDecrypt = [XinDongCrypto]::TryDecryptDatabase($synthetic, $password, 256000, $true, $false, [ref]$plain)
        $magicOk = $false
        if ($okDecrypt) {
            $head = [System.Text.Encoding]::ASCII.GetString($plain, 0, 15)
            $magicOk = ($head -eq 'SQLite format 3')
        }
        Write-Check ($okA -and $okB -and $okDecrypt -and $magicOk) '合成数据库解密与头部校验' "校验A=$okA, 校验B=$okB, 全库=$okDecrypt, 魔数=$magicOk"
    }
    catch {
        Write-Check $false '合成数据库解密与头部校验' $_.Exception.Message
    }

    # 4) 错误密钥必须被拒绝
    try {
        $password = [System.Text.Encoding]::ASCII.GetBytes('0123456789abcdef0123456789abcdef')
        $wrong = [System.Text.Encoding]::ASCII.GetBytes('ffffffffffffffffffffffffffffffff')
        $synthetic = [XinDongCrypto]::BuildSyntheticFile($password, 64000, $false, $false)
        $wrongA = [XinDongCrypto]::ValidateFile($synthetic, $wrong, 64000, $false, $false)
        $wrongB = [XinDongCrypto]::ValidateFile($synthetic, $wrong, 64000, $false, $true)
        $right = [XinDongCrypto]::ValidateFile($synthetic, $password, 64000, $false, $false)
        Write-Check ((-not $wrongA) -and (-not $wrongB) -and $right) '错误密钥被拒绝' "错误A=$wrongA, 错误B=$wrongB, 正确=$right"
    }
    catch {
        Write-Check $false '错误密钥被拒绝' $_.Exception.Message
    }

    # 5) 最小 SQLite 读取器
    try {
        $testDb = [XinDongSqlite]::BuildTestDatabase()
        $tables = [XinDongSqlite]::ListTables($testDb)
        $rows = [XinDongSqlite]::ReadTable($testDb, 'Session')
        $headerOk = ($rows.Count -gt 0) -and ($rows[0] -contains 'nickname') -and ($rows[0] -contains 'talker')
        $dataOk = ($rows.Count -eq 3) -and ($rows[1][1] -eq '张三') -and ($rows[2][0] -eq '12345@chatroom')
        Write-Check (($tables -contains 'Session') -and $headerOk -and $dataOk) '最小 SQLite 读取器' "表数=$($tables.Count), 行数=$($rows.Count), 表头=$headerOk, 数据=$dataOk"
    }
    catch {
        Write-Check $false '最小 SQLite 读取器' $_.Exception.Message
    }

    # 6) 整条链：明文 SQLite -> 加密 -> 解密 -> 读取会话
    try {
        $password = [System.Text.Encoding]::ASCII.GetBytes('abcdef0123456789abcdef0123456789')
        $plainDb = [XinDongSqlite]::BuildTestDatabase()
        $encrypted = [XinDongCrypto]::EncryptDatabase($plainDb, $password, 256000, $true, $false)
        $decrypted = $null
        $ok = [XinDongCrypto]::TryDecryptDatabase($encrypted, $password, 256000, $true, $false, [ref]$decrypted)
        $rows = $null
        if ($ok) { $rows = [XinDongSqlite]::ReadTable($decrypted, 'Session') }
        $chainOk = $ok -and ($rows.Count -eq 3) -and ($rows[1][1] -eq '张三')
        Write-Check $chainOk '加密-解密-读取整条链' "解密=$ok, 行数=$(if ($rows) { $rows.Count } else { 0 })"
    }
    catch {
        Write-Check $false '加密-解密-读取整条链' $_.Exception.Message
    }

    # 7) 导出文件名格式
    try {
        $fileName = Get-ExportFileName '张三' ([datetime]'2026-01-02')
        $ok = ($fileName -eq '张三-微信-20260102.txt')
        $badName = Get-ExportFileName 'a/b:c' ([datetime]'2026-01-02')
        $okBad = ($badName -notmatch '[/:]')
        Write-Check ($ok -and $okBad) '导出文件名格式' "$fileName"
    }
    catch {
        Write-Check $false '导出文件名格式' $_.Exception.Message
    }

    if ($script:SelfTestFailed) {
        Write-Host 'selftest=failed'
        return 1
    }
    Write-Host 'selftest=ok'
    return 0
}

# ============================================================================
# 第四段：正式流程
# ============================================================================

# 检测微信进程与版本
function Get-WeChatProcess {
    $proc = Get-Process -Name 'WeChat' -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $proc) {
        $proc = Get-Process -Name 'Weixin' -ErrorAction SilentlyContinue | Select-Object -First 1
    }
    return $proc
}

function Get-ProcessVersionText($proc) {
    $text = ''
    try { $text = [string]$proc.MainModule.FileVersionInfo.FileVersion } catch { }
    if ([string]::IsNullOrWhiteSpace($text)) {
        try { $text = [string]$proc.FileVersion } catch { }
    }
    return $text
}

# 找到需要扫描的内存区域：模块区 + 堆区
function Get-ScanRegions($proc, [int]$major) {
    $regions = New-Object 'System.Collections.Generic.List[object]'
    try {
        $modules = Get-Process -Id $proc.Id -Module -ErrorAction Stop
    }
    catch {
        Write-Host '[警告] 无法枚举微信模块，将仅扫描堆内存。'
        $modules = @()
    }
    $preferred = if ($major -eq 3) { 'WeChatWin.dll' } else { '' }
    if (-not [string]::IsNullOrEmpty($preferred)) {
        $target = $modules | Where-Object { $_.ModuleName -ieq $preferred } | Select-Object -First 1
        if ($target) {
            $regions.Add([pscustomobject]@{ Base = [long]$target.BaseAddress.ToInt64(); Size = [long]$target.ModuleMemorySize }) | Out-Null
        }
    }
    else {
        try {
            $main = $proc.MainModule
            if ($main) {
                $regions.Add([pscustomobject]@{ Base = [long]$main.BaseAddress.ToInt64(); Size = [long]$main.ModuleMemorySize }) | Out-Null
            }
        }
        catch { }
    }
    foreach ($m in $modules) {
        if ($m.ModuleMemorySize -le 0 -or $m.ModuleMemorySize -gt 268435456) { continue }
        $regions.Add([pscustomobject]@{ Base = [long]$m.BaseAddress.ToInt64(); Size = [long]$m.ModuleMemorySize }) | Out-Null
    }
    return $regions
}

# 只读扫描内存，收集候选密钥
function Find-KeyCandidates($handle, $regions) {
    $hex = New-Object 'System.Collections.Generic.List[string]'
    $binary = New-Object 'System.Collections.Generic.List[byte[]]'
    $chunkSize = 4 * 1024 * 1024
    $scanned = 0
    foreach ($region in $regions) {
        $offset = [long]0
        while ($offset -lt $region.Size) {
            $size = [int][Math]::Min($chunkSize, $region.Size - $offset)
            $bytes = [XinDongMem]::ReadChunk($handle, $region.Base + $offset, $size)
            if ($bytes -and $bytes.Length -gt 0) {
                $scanned += $bytes.Length
                $foundHex = [XinDongMem]::FindHexStrings($bytes, 64)
                foreach ($h in $foundHex) {
                    if (-not $hex.Contains($h)) { $hex.Add($h) | Out-Null }
                }
                if ($binary.Count -lt 512) {
                    $foundBin = [XinDongMem]::FindBinaryCandidates($bytes, 128)
                    foreach ($b in $foundBin) { $binary.Add($b) | Out-Null }
                }
            }
            $offset += $size
        }
    }
    return [pscustomobject]@{ Hex = $hex; Binary = $binary; Scanned = $scanned }
}

# 发现微信数据库文件
function Find-WeChatDatabases {
    $roots = @(
        (Join-Path $env:USERPROFILE 'Documents\WeChat Files'),
        (Join-Path $env:USERPROFILE 'Documents\xwechat_files')
    )
    $patterns = @('MSG.db', 'MicroMsg.db', 'message_*.db', 'contact.db', 'chatroom.db')
    $files = New-Object 'System.Collections.Generic.List[object]'
    $seen = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($root in $roots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        foreach ($pattern in $patterns) {
            try {
                $found = Get-ChildItem -LiteralPath $root -Recurse -File -Filter $pattern -ErrorAction SilentlyContinue
                foreach ($f in $found) {
                    if ($seen.Add($f.FullName)) { $files.Add($f) | Out-Null }
                }
            }
            catch { }
        }
    }
    return $files
}

function Invoke-Main {
    param([string]$targetExportDir)

    if ([string]::IsNullOrWhiteSpace($targetExportDir)) {
        $exportDir = Join-Path $env:USERPROFILE 'Documents\心动镜导入'
    }
    else {
        $exportDir = $targetExportDir
    }
    if (-not (Test-Path -LiteralPath $exportDir)) {
        New-Item -ItemType Directory -Path $exportDir -Force | Out-Null
    }
    Write-Host ('导出目录：' + $exportDir)

    # 1. 进程与版本
    $proc = Get-WeChatProcess
    if (-not $proc) {
        Write-Host '[错误] 未检测到微信进程。请先启动并登录微信电脑版，再运行本工具。'
        return 1
    }
    $versionText = Get-ProcessVersionText $proc
    $major = Get-VersionMajor $versionText
    $profile = Get-CipherProfile $major
    if (-not $profile) {
        Write-Host ("[错误] 无法识别微信版本（版本号：$versionText）。本工具仅支持微信 3.x 与 4.x。")
        return 1
    }
    Write-Host ("检测到微信进程：PID=$($proc.Id)，版本 $versionText（$($profile.Label)）")

    # 2. 内存扫描
    $handle = [IntPtr]::Zero
    try {
        $handle = [XinDongMem]::Open($proc.Id)
        if ($handle -eq [IntPtr]::Zero) {
            Write-Host '[错误] 读取微信进程内存被拒绝（OpenProcess 失败）。可能受安全软件保护，请关闭内存防护后重试。'
            return 1
        }
        $regions = Get-ScanRegions $proc $major
        if ($regions.Count -eq 0) {
            Write-Host '[错误] 未找到可扫描的微信内存区域，无法确定密钥。'
            return 1
        }
        Write-Host ('开始只读扫描内存，区域数：' + $regions.Count)
        $candidates = Find-KeyCandidates $handle $regions
        if ($candidates.Scanned -eq 0) {
            Write-Host '[错误] 内存读取全部失败（ReadProcessMemory 被拒绝）。请以同一用户身份运行，并关闭安全软件的内存防护。'
            return 1
        }
        Write-Host ("内存扫描完成，共读取 $([math]::Round($candidates.Scanned / 1MB, 1)) MB，十六进制候选 $($candidates.Hex.Count) 个，二进制候选 $($candidates.Binary.Count) 个。")
    }
    finally {
        if ($handle -ne [IntPtr]::Zero) { [XinDongMem]::Close($handle) }
    }

    # 3. 数据库文件
    $dbFiles = Find-WeChatDatabases
    if ($dbFiles.Count -eq 0) {
        Write-Host '[错误] 未找到微信数据库文件。请确认微信已登录并产生聊天记录，或检查数据库存放路径。'
        return 1
    }
    Write-Host ('发现数据库文件：' + $dbFiles.Count + ' 个。正在校验密钥…')

    $sampleBytes = $null
    $lastReadError = ''
    foreach ($f in $dbFiles) {
        try {
            $sampleBytes = [System.IO.File]::ReadAllBytes($f.FullName)
            break
        }
        catch {
            $lastReadError = $_.Exception.Message
        }
    }
    if (-not $sampleBytes) {
        Write-Host "[错误] 数据库文件被占用或无法读取（可能被微信锁定）。请完全退出微信后重试。详情：$lastReadError"
        return 1
    }

    # 4. 校验密钥：十六进制候选优先，其次二进制候选
    $keyBytes = $null
    $fastKdfMode = $false
    $testQueue = New-Object 'System.Collections.Generic.List[object]'
    foreach ($h in $candidates.Hex) {
        try { $testQueue.Add([pscustomobject]@{ Bytes = (ConvertFrom-HexString $h); Label = '十六进制字符串' }) | Out-Null } catch { }
    }
    foreach ($b in $candidates.Binary) {
        $testQueue.Add([pscustomobject]@{ Bytes = $b; Label = '二进制候选' }) | Out-Null
    }
    if ($testQueue.Count -eq 0) {
        Write-Host '[错误] 未在内存中定位到数据库密钥候选。请重启微信并产生新聊天记录后重试。'
        return 1
    }

    $checked = 0
    foreach ($item in $testQueue) {
        $checked++
        if ($checked -gt 1500) { break }
        foreach ($fast in @($false, $true)) {
            if ([XinDongCrypto]::ValidateFile($sampleBytes, $item.Bytes, $profile.Iterations, $profile.Sha512, $fast)) {
                $keyBytes = $item.Bytes
                $fastKdfMode = $fast
                break
            }
        }
        if ($keyBytes) { break }
        if ($checked % 25 -eq 0) {
            Write-Host ("已校验 $checked 个候选…")
        }
    }
    if (-not $keyBytes) {
        Write-Host "[错误] 数据库解密失败：已尝试 $checked 个候选密钥，均无法通过头部校验。可能微信版本或 SQLCipher 参数不匹配。"
        return 1
    }
    Write-Host '密钥校验通过。'

    # 5. 解密数据库到导出目录（临时文件），退出前清理
    $tempDbs = New-Object 'System.Collections.Generic.List[string]'
    try {
        foreach ($f in $dbFiles) {
            try {
                $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
            }
            catch {
                Write-Host ('[警告] 跳过被占用文件：' + $f.Name)
                continue
            }
            $plain = $null
            if ([XinDongCrypto]::TryDecryptDatabase($bytes, $keyBytes, $profile.Iterations, $profile.Sha512, $fastKdfMode, [ref]$plain)) {
                $tmpName = 'tmp_' + [guid]::NewGuid().ToString('N') + '.db'
                $tmpPath = Join-Path $exportDir $tmpName
                [System.IO.File]::WriteAllBytes($tmpPath, $plain)
                $tempDbs.Add($tmpPath) | Out-Null
            }
        }
        if ($tempDbs.Count -eq 0) {
            Write-Host '[错误] 没有任何数据库可以解密。请确认微信版本与数据库参数匹配。'
            return 1
        }

        # 6. 收集会话（Session / Contact）
        $contacts = New-Object 'System.Collections.Generic.List[object]'
        $nickMap = @{}
        $messageTables = New-Object 'System.Collections.Generic.List[object]'
        foreach ($tmp in $tempDbs) {
            $dbBytes = [System.IO.File]::ReadAllBytes($tmp)
            $tables = [XinDongSqlite]::ListTables($dbBytes)
            foreach ($table in $tables) {
                if ($table -ieq 'Contact' -or $table -ieq 'Contacts' -or $table -ieq 'chat_info') {
                    try {
                        $rows = [XinDongSqlite]::ReadTable($dbBytes, $table)
                        if ($rows.Count -gt 0) {
                            $h = $rows[0]
                            $userIdx = 0; $nickIdx = -1
                            for ($i = 0; $i -lt $h.Length; $i++) {
                                if ($h[$i] -ieq 'userName' -or $h[$i] -ieq 'user_name' -or $h[$i] -ieq 'talker') { $userIdx = $i }
                                if ($h[$i] -ieq 'nickName' -or $h[$i] -ieq 'nickname' -or $h[$i] -ieq 'name') { $nickIdx = $i }
                            }
                            if ($nickIdx -ge 0) {
                                for ($i = 1; $i -lt $rows.Count; $i++) {
                                    $u = $rows[$i][$userIdx]
                                    $n = $rows[$i][$nickIdx]
                                    if (-not [string]::IsNullOrWhiteSpace($u)) { $nickMap[$u] = $n }
                                }
                            }
                        }
                    }
                    catch { }
                }
            }
            foreach ($table in $tables) {
                if ($table -ieq 'Session' -or $table -ieq 'RecentChat' -or $table -ieq 'chat_info') {
                    try {
                        $rows = [XinDongSqlite]::ReadTable($dbBytes, $table)
                        if ($rows.Count -eq 0) { continue }
                        $h = $rows[0]
                        $talkerIdx = -1; $nickIdx = -1; $timeIdx = -1; $countIdx = -1
                        for ($i = 0; $i -lt $h.Length; $i++) {
                            switch -Regex ($h[$i]) {
                                '^(talker|username|user_name|stranger)$' { $talkerIdx = $i }
                                '^(nickname|nickName|name|displayName)$' { $nickIdx = $i }
                                '^(last_time|lastTime|sortTime|createTime)$' { $timeIdx = $i }
                                '^(count|unreadCount|msgCount|cnt)$' { $countIdx = $i }
                            }
                        }
                        if ($talkerIdx -lt 0) { continue }
                        for ($i = 1; $i -lt $rows.Count; $i++) {
                            $r = $rows[$i]
                            $talker = $r[$talkerIdx]
                            if ([string]::IsNullOrWhiteSpace($talker)) { continue }
                            $nick = ''
                            if ($nickIdx -ge 0) { $nick = $r[$nickIdx] }
                            if ([string]::IsNullOrWhiteSpace($nick) -and $nickMap.ContainsKey($talker)) { $nick = $nickMap[$talker] }
                            if ([string]::IsNullOrWhiteSpace($nick)) { $nick = $talker }
                            $last = 0
                            if ($timeIdx -ge 0) { [void][int64]::TryParse($r[$timeIdx], [ref]$last) }
                            $cnt = 0
                            if ($countIdx -ge 0) { [void][int64]::TryParse($r[$countIdx], [ref]$cnt) }
                            $contacts.Add([pscustomobject]@{
                                Talker = $talker
                                Nickname = $nick
                                Last = $last
                                Count = $cnt
                                Db = $tmp
                            }) | Out-Null
                        }
                    }
                    catch { }
                }
                if ($table -ieq 'MSG' -or $table -like 'Msg_*' -or $table -like 'message_*') {
                    $messageTables.Add([pscustomobject]@{ Db = $tmp; Table = $table }) | Out-Null
                }
            }
        }

        # 去重并按最近活跃排序
        $unique = @{}
        foreach ($c in $contacts) {
            if (-not $unique.ContainsKey($c.Talker)) { $unique[$c.Talker] = $c }
            elseif ($unique[$c.Talker].Last -lt $c.Last) { $unique[$c.Talker] = $c }
        }
        $allContacts = @($unique.Values | Sort-Object -Property Last -Descending)
        $groups = @($allContacts | Where-Object { $_.Talker -like '*@chatroom' })
        $showGroups = $false
        $visible = @($allContacts | Where-Object { $showGroups -or $_.Talker -notlike '*@chatroom' })

        if ($visible.Count -eq 0) {
            Write-Host '[错误] 未解析到任何联系人会话。当前微信数据库结构可能无法识别，详见 README.md。'
            return 1
        }

        # 7. 交互菜单
        while ($true) {
            Write-Host ''
            Write-Host '=== 请选择会话 ==='
            for ($i = 0; $i -lt $visible.Count; $i++) {
                $c = $visible[$i]
                $when = if ($c.Last -gt 0) { ConvertFrom-UnixSecond ([string]$c.Last) } else { '未知时间' }
                Write-Host (' [{0}] {1}（最后活跃：{2}）' -f ($i + 1), $c.Nickname, $when)
            }
            $groupSwitch = if ($showGroups) { '隐藏群聊' } else { '显示群聊' }
            Write-Host (' [G] ' + $groupSwitch + '（已隐藏 ' + $groups.Count + ' 个群聊）')
            Write-Host ' [0] 退出'
            $choice = Read-Host '请输入编号'
            if ($choice -eq '0') { return 0 }
            if ($choice -ieq 'G') { $showGroups = -not $showGroups; $visible = @($allContacts | Where-Object { $showGroups -or $_.Talker -notlike '*@chatroom' }); continue }
            $index = 0
            if (-not [int]::TryParse($choice, [ref]$index)) { Write-Host '[提示] 输入无效，请输入编号。'; continue }
            if ($index -lt 1 -or $index -gt $visible.Count) { Write-Host '[提示] 编号超出范围。'; continue }
            $selected = $visible[$index - 1]
            break
        }

        Write-Host ''
        Write-Host '=== 请选择导出范围 ==='
        Write-Host ' [1] 全部记录'
        Write-Host ' [2] 最近 90 天'
        $range = Read-Host '请输入编号'
        if ($range -ne '1' -and $range -ne '2') { Write-Host '[提示] 无效选择，按“全部记录”处理。'; $range = '1' }
        $cutoff = 0
        if ($range -eq '2') {
            $cutoff = [DateTimeOffset]::UtcNow.AddDays(-90).ToUnixTimeSeconds()
        }

        # 8. 读取消息并导出
        $lines = New-Object 'System.Collections.Generic.List[string]'
        foreach ($mt in $messageTables) {
            $dbBytes = [System.IO.File]::ReadAllBytes($mt.Db)
            try { $rows = [XinDongSqlite]::ReadTable($dbBytes, $mt.Table) } catch { continue }
            if ($rows.Count -eq 0) { continue }
            $h = $rows[0]
            $talkerIdx = -1; $timeIdx = -1; $senderIdx = -1; $contentIdx = -1; $isSendIdx = -1
            for ($i = 0; $i -lt $h.Length; $i++) {
                switch -Regex ($h[$i]) {
                    '^(talker|username|user_name)$' { $talkerIdx = $i }
                    '^(time|create_time|createTime|msgTime|timestamp)$' { $timeIdx = $i }
                    '^(sender|senderName|from|from_user|sender_username)$' { $senderIdx = $i }
                    '^(content|message_content|msgContent|strContent)$' { $contentIdx = $i }
                    '^(isSend|is_send|des)$' { $isSendIdx = $i }
                }
            }
            if ($contentIdx -lt 0 -or $timeIdx -lt 0) { continue }
            for ($i = 1; $i -lt $rows.Count; $i++) {
                $r = $rows[$i]
                # v3 统一 MSG 表按 talker 过滤；v4 分表通过表名/字段判断
                if ($talkerIdx -ge 0) {
                    if ($r[$talkerIdx] -ne $selected.Talker) { continue }
                }
                elseif ($mt.Table -notlike ('*' + $selected.Talker + '*')) {
                    # 无法确认归属时跳过，避免串会话
                    continue
                }
                $sec = 0
                [void][int64]::TryParse($r[$timeIdx], [ref]$sec)
                if ($cutoff -gt 0 -and $sec -lt $cutoff) { continue }
                $stamp = ConvertFrom-UnixSecond ([string]$sec)
                if ([string]::IsNullOrWhiteSpace($stamp)) { continue }
                $speaker = ''
                if ($senderIdx -ge 0) { $speaker = $r[$senderIdx] }
                if ([string]::IsNullOrWhiteSpace($speaker) -and $isSendIdx -ge 0 -and $r[$isSendIdx] -eq '1') { $speaker = '我' }
                if ([string]::IsNullOrWhiteSpace($speaker) -and $nickMap.ContainsKey($selected.Talker)) { $speaker = $nickMap[$selected.Talker] }
                if ([string]::IsNullOrWhiteSpace($speaker)) { $speaker = $selected.Nickname }
                if ($nickMap.ContainsKey($speaker)) { $speaker = $nickMap[$speaker] }
                $content = $r[$contentIdx]
                $content = ($content -replace '\s*\r?\n\s*', ' ') -replace '\t', ' '
                if ([string]::IsNullOrWhiteSpace($content)) { continue }
                $lines.Add(($stamp + ' ' + $speaker + '：' + $content)) | Out-Null
            }
        }

        if ($lines.Count -eq 0) {
            Write-Host '[错误] 未读取到该会话的消息。可能消息表结构无法识别，详见 README.md。'
            return 1
        }

        $linesSorted = @($lines | Sort-Object)
        $fileName = Get-ExportFileName $selected.Nickname (Get-Date)
        $finalPath = Join-Path $exportDir $fileName
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllLines($finalPath, $linesSorted, $utf8NoBom)
        Write-Host ''
        Write-Host ('导出完成：共 ' + $linesSorted.Count + ' 条消息')
        Write-Host ('文件路径：' + $finalPath)
        return 0
    }
    finally {
        foreach ($tmp in $tempDbs) {
            try { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue } catch { }
        }
    }
}

# ============================================================================
# 入口
# ============================================================================
if ($SelfTest) {
    $code = Invoke-SelfTest
    exit $code
}

try {
    $code = Invoke-Main -targetExportDir $ExportDir
    exit $code
}
catch {
    Write-Host ('[错误] 发生未处理的异常：' + $_.Exception.Message)
    exit 1
}
