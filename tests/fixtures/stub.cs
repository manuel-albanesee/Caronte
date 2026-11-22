// Test fixture: a native Windows executable that runs "<this exe>.js" with Node and forwards the arguments and exit code.
// __NODE__ is replaced by the test with the path of the Node binary running the suite.
using System;
using System.Diagnostics;
using System.Text;

class Stub
{
    const char Backslash = (char)92;
    const char Quote = (char)34;

    // Quotes one argument following the CommandLineToArgvW rules.
    static string QuoteArg(string arg)
    {
        if (arg.Length > 0 && arg.IndexOfAny(new[] { (char)32, (char)9, Quote }) < 0) return arg;
        var sb = new StringBuilder();
        sb.Append(Quote);
        int slashes = 0;
        foreach (char c in arg)
        {
            if (c == Backslash) { slashes++; continue; }
            if (c == Quote) sb.Append(Backslash, slashes * 2 + 1).Append(Quote);
            else sb.Append(Backslash, slashes).Append(c);
            slashes = 0;
        }
        return sb.Append(Backslash, slashes * 2).Append(Quote).ToString();
    }

    static int Main(string[] args)
    {
        string self = System.Reflection.Assembly.GetExecutingAssembly().Location;
        var line = new StringBuilder(QuoteArg(self + ".js"));
        foreach (string arg in args) line.Append((char)32).Append(QuoteArg(arg));
        var info = new ProcessStartInfo(__NODE__, line.ToString()) { UseShellExecute = false };
        var process = Process.Start(info);
        process.WaitForExit();
        return process.ExitCode;
    }
}
