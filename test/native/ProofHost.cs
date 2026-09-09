using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

namespace RecapPageProof
{
    public sealed class FixtureJob : IDisposable
    {
        [StructLayout(LayoutKind.Sequential)]
        private struct BasicLimits
        {
            public long ProcessTime, JobTime;
            public uint Flags;
            public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass, SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IoCounters
        {
            public ulong ReadOperations, WriteOperations, OtherOperations;
            public ulong ReadBytes, WriteBytes, OtherBytes;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct ExtendedLimits
        {
            public BasicLimits Basic;
            public IoCounters Io;
            public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct Accounting
        {
            public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime;
            public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateJobObjectW(IntPtr security, string name);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits value, uint length);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool QueryInformationJobObject(IntPtr job, int kind, out Accounting value, uint length, IntPtr returned);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool TerminateJobObject(IntPtr job, uint code);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);

        private IntPtr handle;

        public FixtureJob()
        {
            handle = CreateJobObjectW(IntPtr.Zero, null);
            if (handle == IntPtr.Zero) throw Failure("create-fixture-job");
            var limits = new ExtendedLimits();
            limits.Basic.Flags = 0x2000;
            if (!SetInformationJobObject(handle, 9, ref limits, (uint)Marshal.SizeOf(limits)))
            {
                var error = Failure("configure-fixture-job");
                CloseHandle(handle);
                handle = IntPtr.Zero;
                throw error;
            }
        }

        private static Exception Failure(string stage)
        {
            return new Win32Exception(Marshal.GetLastWin32Error(), stage + " failed");
        }

        public void Assign(IntPtr process)
        {
            if (!AssignProcessToJobObject(handle, process)) throw Failure("assign-fixture-job");
        }

        public uint ActiveProcesses
        {
            get
            {
                Accounting accounting;
                if (!QueryInformationJobObject(handle, 1, out accounting, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero))
                    throw Failure("query-fixture-job");
                return accounting.ActiveProcesses;
            }
        }

        public void Terminate()
        {
            if (!TerminateJobObject(handle, 2)) throw Failure("terminate-fixture-job");
        }

        public void Dispose()
        {
            if (handle == IntPtr.Zero) return;
            var owned = handle;
            handle = IntPtr.Zero;
            if (!CloseHandle(owned)) throw Failure("close-fixture-job");
        }
    }

    public static class HostSettings
    {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct HighContrast
        {
            public uint Size, Flags;
            public IntPtr Scheme;
        }

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool SystemParametersInfoW(uint action, uint size, ref HighContrast value, uint flags);

        public static uint CaptureContrast()
        {
            var state = new HighContrast();
            state.Size = (uint)Marshal.SizeOf(state);
            if (!SystemParametersInfoW(0x0042, state.Size, ref state, 0))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "capture-host-contrast failed");
            return state.Flags;
        }

        public static void RestoreContrast(uint flags)
        {
            var state = new HighContrast();
            state.Size = (uint)Marshal.SizeOf(state);
            state.Flags = flags;
            if (!SystemParametersInfoW(0x0043, state.Size, ref state, 0))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "restore-host-contrast failed");
            if (CaptureContrast() != flags) throw new InvalidOperationException("host-contrast rollback differs");
        }
    }
}
