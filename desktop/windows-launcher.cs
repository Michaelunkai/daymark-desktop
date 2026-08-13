using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

[assembly: System.Reflection.AssemblyTitle("Daymark")]
[assembly: System.Reflection.AssemblyDescription("Daymark Windows launcher")]
[assembly: System.Reflection.AssemblyCompany("Michael Fedorovsky")]
[assembly: System.Reflection.AssemblyProduct("Daymark")]
[assembly: System.Reflection.AssemblyVersion("1.4.35.0")]
[assembly: System.Reflection.AssemblyFileVersion("1.4.35.0")]

internal static class DaymarkLauncher
{
    private const uint CreateNewProcessGroup = 0x00000200;
    private const uint CreateUnicodeEnvironment = 0x00000400;
    private const uint DetachedProcess = 0x00000008;
    private const uint ErrorIcon = 0x00000010;
    private const string RuntimeName = "Daymark Runtime.exe";
    private const string DetachedChildArgument = "--daymark-detached-child";

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessW(
        string applicationName,
        StringBuilder commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref StartupInfo startupInfo,
        out ProcessInformation processInformation);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBoxW(
        IntPtr owner,
        string text,
        string caption,
        uint type);

    [STAThread]
    private static int Main(string[] args)
    {
        string applicationDirectory = AppDomain.CurrentDomain.BaseDirectory;
        string runtimePath = Path.Combine(applicationDirectory, RuntimeName);
        if (!File.Exists(runtimePath))
        {
            MessageBoxW(
                IntPtr.Zero,
                "Daymark Runtime.exe is missing. Reinstall Daymark and try again.",
                "Daymark",
                ErrorIcon);
            return 2;
        }

        IntPtr environment = IntPtr.Zero;
        try
        {
            environment = Marshal.StringToHGlobalUni(BuildEnvironmentBlock());
            var startupInfo = new StartupInfo
            {
                cb = Marshal.SizeOf(typeof(StartupInfo)),
            };
            ProcessInformation processInformation;
            var commandLine = new StringBuilder(BuildCommandLine(runtimePath, args));
            bool started = CreateProcessW(
                runtimePath,
                commandLine,
                IntPtr.Zero,
                IntPtr.Zero,
                false,
                DetachedProcess | CreateNewProcessGroup | CreateUnicodeEnvironment,
                environment,
                applicationDirectory,
                ref startupInfo,
                out processInformation);

            if (!started)
            {
                int error = Marshal.GetLastWin32Error();
                MessageBoxW(
                    IntPtr.Zero,
                    "Daymark could not start. Windows error " + error + ".",
                    "Daymark",
                    ErrorIcon);
                return error == 0 ? 1 : error;
            }

            CloseHandle(processInformation.hThread);
            CloseHandle(processInformation.hProcess);
            return 0;
        }
        finally
        {
            if (environment != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(environment);
            }
        }
    }

    private static string BuildCommandLine(string runtimePath, string[] args)
    {
        var command = new StringBuilder();
        command.Append(QuoteArgument(runtimePath));
        command.Append(' ');
        command.Append(DetachedChildArgument);
        foreach (string argument in args)
        {
            command.Append(' ');
            command.Append(QuoteArgument(argument));
        }
        return command.ToString();
    }

    private static string BuildEnvironmentBlock()
    {
        var entries = new List<string>();
        foreach (DictionaryEntry entry in Environment.GetEnvironmentVariables())
        {
            string key = Convert.ToString(entry.Key) ?? string.Empty;
            if (key.Equals("NODE_OPTIONS", StringComparison.OrdinalIgnoreCase)
                || key.Equals("ELECTRON_RUN_AS_NODE", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }
            entries.Add(key + "=" + (Convert.ToString(entry.Value) ?? string.Empty));
        }
        entries.Sort(StringComparer.OrdinalIgnoreCase);
        return string.Join("\0", entries.ToArray()) + "\0\0";
    }

    private static string QuoteArgument(string value)
    {
        if (value.Length > 0 && value.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0)
        {
            return value;
        }

        var result = new StringBuilder();
        result.Append('"');
        int backslashes = 0;
        foreach (char character in value)
        {
            if (character == '\\')
            {
                backslashes++;
                continue;
            }
            if (character == '"')
            {
                result.Append('\\', (backslashes * 2) + 1);
                result.Append('"');
                backslashes = 0;
                continue;
            }
            result.Append('\\', backslashes);
            backslashes = 0;
            result.Append(character);
        }
        result.Append('\\', backslashes * 2);
        result.Append('"');
        return result.ToString();
    }
}
