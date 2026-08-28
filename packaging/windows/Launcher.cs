using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;

internal static class Launcher
{
    private static int Main()
    {
        Console.Title = "Recap Page";

        string root = AppDomain.CurrentDomain.BaseDirectory;
        string runtime = Path.Combine(root, "runtime", "node.exe");
        string server = Path.Combine(root, "server.mjs");

        if (!File.Exists(runtime) || !File.Exists(server))
        {
            Console.Error.WriteLine("Recap Page could not find its packaged runtime or server.");
            Console.Error.WriteLine("Reinstall the app, then start it again.");
            Pause();
            return 1;
        }

        Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs eventArgs)
        {
            eventArgs.Cancel = true;
        };

        ProcessStartInfo startInfo = new ProcessStartInfo
        {
            FileName = runtime,
            Arguments = Quote(server),
            WorkingDirectory = root,
            UseShellExecute = false,
            CreateNoWindow = false
        };
        startInfo.EnvironmentVariables.Remove("MRT_PORT");
        startInfo.EnvironmentVariables.Remove("MRT_NO_OPEN");

        Process child;
        try
        {
            child = Process.Start(startInfo);
        }
        catch (Win32Exception error)
        {
            return StartFailed(error);
        }
        catch (InvalidOperationException error)
        {
            return StartFailed(error);
        }

        int exitCode;
        using (child)
        {
            if (child == null)
            {
                return StartFailed(null);
            }

            child.WaitForExit();
            exitCode = child.ExitCode;
        }

        Console.WriteLine();
        Console.WriteLine("The tracker has stopped. Your reading progress is saved in your browser and is not lost.");
        Pause();
        return exitCode;
    }

    private static int StartFailed(Exception error)
    {
        Console.Error.WriteLine("Recap Page could not start its packaged server.");
        if (error != null)
        {
            Console.Error.WriteLine(error.Message);
        }
        Console.Error.WriteLine("Reinstall the app, then start it again.");
        Pause();
        return 1;
    }

    private static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }

    private static void Pause()
    {
        Console.Write("Press any key to close.");
        Console.ReadKey(true);
        Console.WriteLine();
    }
}
