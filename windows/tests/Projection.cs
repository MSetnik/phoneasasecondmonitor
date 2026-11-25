using System;
using System.Runtime.InteropServices;
using System.Threading;

internal static class ProjectionTest {
    [DllImport("user32")]
    static extern int SetDisplayConfig(int paths, IntPtr pathData, int modes, IntPtr modeData, uint flags);

    static void Put(byte[] data, int offset, int value) {
        Buffer.BlockCopy(BitConverter.GetBytes(value), 0, data, offset, 4);
    }
    static void Target(byte[] data, int row, int adapter, int target, bool connected, bool active) {
        int p = row * 72;
        Put(data, p + 20, adapter);
        Put(data, p + 28, target);
        Put(data, p + 60, connected ? 1 : 0);
        Put(data, p + 68, active ? 1 : 0);
    }
    static void Expect(bool actual, bool expected, string scenario) {
        if (actual != expected) throw new Exception(scenario);
    }
    static void CheckLayouts() {
        var paths = new byte[117 * 72];
        // Most paths refer to alternative sources for one physical output.
        for (int i = 0; i < 116; i++) Target(paths, i, 1, 0, true, false);
        Target(paths, 89, 1, 0, true, true);
        Target(paths, 116, 2, 0, true, true);
        Func<int,bool> owned = row => BitConverter.ToInt32(paths, row + 20) == 2;
        Expect(Adapter.CanUseSystemExtend(paths, 117, owned), true, "Recognize the two targets among 117 paths.");
        Target(paths, 12, 1, 3, false, false);
        Expect(Adapter.CanUseSystemExtend(paths, 117, owned), true, "Ignore an unplugged output.");
        Target(paths, 12, 1, 3, true, false);
        Expect(Adapter.CanUseSystemExtend(paths, 117, owned), false, "Preserve a connected, disabled third monitor.");
        Target(paths, 12, 1, 3, false, true);
        Expect(Adapter.CanUseSystemExtend(paths, 117, owned), false, "Preserve an active third monitor.");
        Target(paths, 12, 1, 3, false, false);
        Target(paths, 116, 2, 0, false, false);
        Expect(Adapter.CanUseSystemExtend(paths, 117, owned), false, "Do not project to a missing app monitor.");
        Target(paths, 116, 2, 0, true, true);
        Expect(Adapter.CanUseSystemExtend(paths, 117, row => false), false, "Require positive ownership.");
    }
    static int Main(string[] args) {
        var wheel = new SwipeWheel();
        int x, y, vertical = 0;
        for (int i = 0; i < 120; i++) {
            wheel.Move(0,-1,out x,out y);
            vertical+=y;
        }
        Expect(vertical == -5, true, "Short updates must produce five notches over a 120-pixel swipe.");
        // Use exactly representable sub-pixel fractions for the axis and batching assertions.
        wheel.Reset();
        wheel.Move(30,60,out x,out y);
        Expect(x==-1 && y==2,true,"Natural scrolling on both axes.");
        wheel.Move(-30,-60,out x,out y);
        Expect(x==1 && y==-2,true,"Reversing direction returns to the initial position.");
        wheel.Move(0,12,out x,out y);
        wheel.Reset();
        wheel.Move(0,12,out x,out y);
        Expect(y==0,true,"A new gesture must not inherit an old fraction.");
        CheckLayouts();
        Console.WriteLine("Projection policy passed for two, disconnected and multiple targets.");
        if (args.Length == 0) return 0;
        if (args.Length != 1 || args[0] != "prepare-desktop" ||
            Environment.GetEnvironmentVariable("GITHUB_ACTIONS") != "true" ||
            Environment.GetEnvironmentVariable("PASM_RUNNER_KIND") != "github-hosted") return 2;
        Adapter.CheckDevice();
        foreach (uint topology in new uint[] { 2, 1 }) {
            int status = SetDisplayConfig(0, IntPtr.Zero, 0, IntPtr.Zero, 0x80 | topology);
            if (status != 0) continue;
            int singleDesktopSamples=0;
            for (int i = 0; i < 18; i++) {
                singleDesktopSamples=Adapter.Current()==null?singleDesktopSamples+1:0;
                if (singleDesktopSamples>=3) {
                    Console.WriteLine("Starting the app without an independent desktop in " +
                        (topology == 2 ? "Duplicate" : "PC screen only") + " mode. " + Adapter.Diagnostics());
                    return 0;
                }
                Thread.Sleep(250);
            }
        }
        throw new Exception("The Windows runner could not stage a single-desktop projection for the reconnect test.");
    }
}
