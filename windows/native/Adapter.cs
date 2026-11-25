using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.IO;
using Microsoft.Win32;

internal static class Adapter {
    internal const string Instance = @"ROOT\MCODEPASM\0000";
    static Guid display = new Guid("4d36e968-e325-11ce-bfc1-08002be10318");
    [StructLayout(LayoutKind.Sequential)]
    struct Device { public int size; public Guid cls; public int dev; public IntPtr reserved; }
    [DllImport("setupapi", SetLastError=true)] static extern IntPtr SetupDiCreateDeviceInfoList(ref Guid cls, IntPtr hwnd);
    [DllImport("setupapi", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool SetupDiCreateDeviceInfo(IntPtr list,string name,ref Guid cls,string desc,IntPtr hwnd,uint flags,ref Device device);
    [DllImport("setupapi", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool SetupDiOpenDeviceInfo(IntPtr list,string name,IntPtr hwnd,uint flags,ref Device device);
    [DllImport("setupapi", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool SetupDiSetDeviceRegistryProperty(IntPtr list,ref Device device,uint property,byte[] data,int size);
    [DllImport("setupapi", SetLastError=true)] static extern bool SetupDiCallClassInstaller(int command,IntPtr list,ref Device device);
    [DllImport("setupapi")] static extern bool SetupDiDestroyDeviceInfoList(IntPtr list);
    [DllImport("cfgmgr32",CharSet=CharSet.Unicode)] static extern int CM_Locate_DevNodeW(out uint device,string instance,uint flags);
    [DllImport("cfgmgr32")] static extern int CM_Get_DevNode_Status(out uint status,out uint problem,uint device,uint flags);
    [DllImport("cfgmgr32")] static extern int CM_Get_Parent(out uint parent,uint device,uint flags);
    [DllImport("cfgmgr32")] static extern int CM_Get_Child(out uint child,uint device,uint flags);
    static bool HasChild() {
        uint device, child;
        return CM_Locate_DevNodeW(out device,Instance,0)==0 && CM_Get_Child(out child,device,0)==0;
    }
    internal static bool RestartDriver(bool requestApproval) {
        var command = new ProcessStartInfo(System.IO.Path.Combine(Environment.SystemDirectory,"pnputil.exe"),
            "/restart-device \"" + Instance + "\"");
        command.UseShellExecute=requestApproval;
        command.WindowStyle=ProcessWindowStyle.Hidden;
        if(requestApproval)command.Verb="runas";
        using(var process=Process.Start(command)){
            if(!process.WaitForExit(25000))throw new Exception("The adapter is still restarting. Wait a moment and pair again.");
            if(process.ExitCode==3010)return true;
            if(process.ExitCode!=0)throw new Exception("Windows could not restart the app’s display adapter (code "+process.ExitCode+"). Run the installer again.");
        }
        return false;
    }
    internal static void CheckDevice() {
        uint device,status,problem;
        if(CM_Locate_DevNodeW(out device,Instance,0)!=0)
            throw new Exception("The virtual monitor driver is missing. Run the Windows installer and approve the display driver.");
        if(CM_Get_DevNode_Status(out status,out problem,device,0)!=0 || (status&8)==0 || problem!=0)
            throw new Exception("Windows has not started the monitor driver (device code "+problem+"). Check Device Manager, or repair the installation.");
    }
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
    struct InstallParams {
        public int size,flags,flagsEx;
        public IntPtr hwnd,callback,context,queue,classReserved;
        public int reserved;
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)] public string driverPath;
    }
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
    struct DriverInfo {
        public int size,type;
        public UIntPtr reserved;
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=256)] public string description;
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=256)] public string manufacturer;
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=256)] public string provider;
        public System.Runtime.InteropServices.ComTypes.FILETIME date;
        public ulong version;
    }
    [DllImport("setupapi",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool SetupDiGetDeviceInstallParams(IntPtr list,ref Device device,ref InstallParams parameters);
    [DllImport("setupapi",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool SetupDiSetDeviceInstallParams(IntPtr list,ref Device device,ref InstallParams parameters);
    [DllImport("setupapi",SetLastError=true)] static extern bool SetupDiBuildDriverInfoList(IntPtr list,ref Device device,uint type);
    [DllImport("setupapi",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool SetupDiEnumDriverInfo(IntPtr list,ref Device device,uint type,uint index,ref DriverInfo driver);
    [DllImport("setupapi")] static extern bool SetupDiDestroyDriverInfoList(IntPtr list,ref Device device,uint type);
    [DllImport("newdev",SetLastError=true)] static extern bool DiInstallDevice(IntPtr hwnd,IntPtr list,ref Device device,ref DriverInfo driver,uint flags,out bool reboot);
    static bool BindPackage(IntPtr list,ref Device device) {
        var options=new InstallParams{size=Marshal.SizeOf(typeof(InstallParams))};
        if(!SetupDiGetDeviceInstallParams(list,ref device,ref options))throw new System.ComponentModel.Win32Exception();
        options.flags|=0x10000; // DI_ENUMSINGLEINF: limit selection to the bundled INF.
        options.driverPath=System.IO.Path.GetFullPath(System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory,@"..\driver\MttVDD.inf"));
        if(!SetupDiSetDeviceInstallParams(list,ref device,ref options) || !SetupDiBuildDriverInfoList(list,ref device,2))
            throw new System.ComponentModel.Win32Exception();
        try{
            var driver=new DriverInfo{size=Marshal.SizeOf(typeof(DriverInfo))};
            if(!SetupDiEnumDriverInfo(list,ref device,2,0,ref driver))throw new System.ComponentModel.Win32Exception();
            if(driver.provider!="MikeTheTech")throw new Exception("Unexpected display driver provider.");
            bool reboot;
            if(!DiInstallDevice(IntPtr.Zero,list,ref device,ref driver,0,out reboot))throw new System.ComponentModel.Win32Exception();
            return reboot;
        }finally{SetupDiDestroyDriverInfoList(list,ref device,2);}
    }
    const string SettingsKey=@"SOFTWARE\MikeTheTech\VirtualDisplayDriver";
    static readonly string DriverDir=Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,@"..\driver"));
    static readonly string ServiceSettings=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows),
        @"ServiceProfiles\LocalService\AppData\Local\MCODE-PhoneAsMonitor");
    static bool AppSettings(string path) {
        return String.Equals(path,DriverDir,StringComparison.OrdinalIgnoreCase) ||
            String.Equals(path,ServiceSettings,StringComparison.OrdinalIgnoreCase);
    }
    static bool ConfigureSettings(bool stock) {
        using(var key=Registry.LocalMachine.CreateSubKey(SettingsKey)){
            string current=key.GetValue("VDDPATH") as string;
            if(String.IsNullOrEmpty(current)){
                if(Directory.Exists(@"C:\VirtualDisplayDriver"))return false;
            }else if(!AppSettings(current))return false;
            Directory.CreateDirectory(ServiceSettings);
            File.Copy(Path.Combine(DriverDir,stock?"vdd_defaults.xml":"vdd_settings.xml"),
                Path.Combine(ServiceSettings,"vdd_settings.xml"),true);
            key.SetValue("VDDPATH",ServiceSettings);
            return true;
        }
    }
    static void RemoveSettings() {
        using(var key=Registry.LocalMachine.OpenSubKey(SettingsKey,true)){
            if(key!=null && AppSettings(key.GetValue("VDDPATH") as string))key.DeleteValue("VDDPATH",false);
        }
        var settings=Path.Combine(ServiceSettings,"vdd_settings.xml");
        if(File.Exists(settings))File.Delete(settings);
        if(Directory.Exists(ServiceSettings) && Directory.GetFileSystemEntries(ServiceSettings).Length==0)
            Directory.Delete(ServiceSettings);
    }
    static bool WaitForMonitor() {
        for(int i=0;i<20;i++){
            if(HasChild())return true;
            Thread.Sleep(250);
        }
        return HasChild();
    }
    internal static bool Install(bool remove) {
        IntPtr list = SetupDiCreateDeviceInfoList(ref display, IntPtr.Zero);
        if (list == new IntPtr(-1)) throw new System.ComponentModel.Win32Exception();
        try {
            var device = new Device {size=Marshal.SizeOf(typeof(Device))};
            bool exists = SetupDiOpenDeviceInfo(list,Instance,IntPtr.Zero,0,ref device);
            if (remove) {
                if (exists && !SetupDiCallClassInstaller(5,list,ref device)) throw new System.ComponentModel.Win32Exception();
                RemoveSettings();
                return false;
            }
            bool managed=ConfigureSettings(false);
            if(!exists && !SetupDiCreateDeviceInfo(list,Instance,ref display,"Phone as a Second Monitor",IntPtr.Zero,0,ref device))
                throw new System.ComponentModel.Win32Exception();
            // The package provides a root-enumerated HWID and a software-device HWID.
            // Keep the product-specific instance ID when upgrading an existing installation.
            byte[] ids=Encoding.Unicode.GetBytes("Root\\MttVDD\0MttVDD\0\0");
            if(!SetupDiSetDeviceRegistryProperty(list,ref device,1,ids,ids.Length) ||
                (!exists && !SetupDiCallClassInstaller(0x19,list,ref device)))throw new System.ComponentModel.Win32Exception();
            bool reboot=BindPackage(list,ref device);
            if(!reboot && !WaitForMonitor()){
                reboot=RestartDriver(false);
                if(!reboot && !WaitForMonitor() && managed){
                    ConfigureSettings(true);
                    reboot=RestartDriver(false);
                }
            }
            return reboot;
        } finally { SetupDiDestroyDeviceInfoList(list); }
    }

    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
    struct Name { public int type,size;
        public int low,high,id;
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=128)] public string name;
    }
    [DllImport("user32")] static extern int GetDisplayConfigBufferSizes(uint flags,out int paths,out int modes);
    [DllImport("user32")] static extern int QueryDisplayConfig(uint flags,ref int count,[Out]byte[] paths,ref int modes,[Out]byte[] modeData,IntPtr topology);
    [DllImport("user32",CharSet=CharSet.Unicode)] static extern int DisplayConfigGetDeviceInfo(ref Name info);
    static string ReadName(byte[] paths,int offset,int type) {
        var query = new Name {type=type,size=type==1?84:276,low=BitConverter.ToInt32(paths,offset),
            high=BitConverter.ToInt32(paths,offset+4),id=type==4?0:BitConverter.ToInt32(paths,offset+8)};
        return DisplayConfigGetDeviceInfo(ref query)==0 ? query.name : "";
    }
    [DllImport("user32")] static extern int SetDisplayConfig(int count,byte[] paths,int modes,byte[] modeData,uint flags);
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
    struct TargetName {
        public int type,size,low,high,id,flags,technology;
        public ushort manufacturer,product; public int connector;
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=64)] public string friendly;
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=128)] public string path;
    }
    [DllImport("user32",EntryPoint="DisplayConfigGetDeviceInfo")] static extern int GetTargetName(ref TargetName info);
    [StructLayout(LayoutKind.Sequential)] struct InterfaceData {
        public int size; public Guid cls; public uint flags; public IntPtr reserved;
    }
    [DllImport("setupapi",EntryPoint="SetupDiCreateDeviceInfoList")] static extern IntPtr NewDeviceList(IntPtr cls,IntPtr parent);
    [DllImport("setupapi",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool SetupDiOpenDeviceInterface(IntPtr list,string path,uint flags,ref InterfaceData entry);
    [DllImport("setupapi",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr list,ref InterfaceData entry,IntPtr detail,int length,out int needed,ref Device device);
    static bool OwnedInterface(string path) {
        if(String.IsNullOrEmpty(path))return false;
        uint owner;
        if(CM_Locate_DevNodeW(out owner,Instance,0)!=0)return false;
        var list=NewDeviceList(IntPtr.Zero,IntPtr.Zero);
        if(list==new IntPtr(-1))return false;
        try{
            var entry=new InterfaceData{size=Marshal.SizeOf(typeof(InterfaceData))};
            if(!SetupDiOpenDeviceInterface(list,path,0,ref entry))return false;
            var device=new Device{size=Marshal.SizeOf(typeof(Device))};
            int needed;
            // The sizing call also fills DeviceInfoData with the interface's devnode.
            if(!SetupDiGetDeviceInterfaceDetail(list,ref entry,IntPtr.Zero,0,out needed,ref device) && Marshal.GetLastWin32Error()!=122)return false;
            uint node=(uint)device.dev;
            while(node!=0){
                if(node==owner)return true;
                uint parent;
                if(CM_Get_Parent(out parent,node,0)!=0 || parent==node)break;
                node=parent;
            }
            return false;
        }finally{SetupDiDestroyDeviceInfoList(list);}
    }
    static bool OwnsTarget(byte[] paths,int row) {
        if(ReadName(paths,row+20,4).IndexOf("#MCODEPASM#0000#",StringComparison.OrdinalIgnoreCase)>=0)return true;
        // Hybrid graphics can report a render adapter here. Resolve the monitor itself, too.
        var target=new TargetName{type=2,size=Marshal.SizeOf(typeof(TargetName)),
            low=Field(paths,row+20),high=Field(paths,row+24),id=Field(paths,row+28)};
        return GetTargetName(ref target)==0 && OwnedInterface(target.path);
    }
    static bool SameEndpoint(byte[] paths,int a,int b) {
        return BitConverter.ToInt64(paths,a)==BitConverter.ToInt64(paths,b) && Field(paths,a+8)==Field(paths,b+8);
    }
    static int ReadPaths(uint flags,out byte[] paths,out int count,out byte[] modes,out int modeCount) {
        paths=modes=null; count=modeCount=0;
        int status=122;
        for(int i=0;i<3 && status==122;i++){
            status=GetDisplayConfigBufferSizes(flags,out count,out modeCount);
            if(status!=0)continue;
            paths=new byte[count*72];modes=new byte[modeCount*64];
            status=QueryDisplayConfig(flags,ref count,paths,ref modeCount,modes,IntPtr.Zero);
        }
        return status;
    }
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
    struct DisplayDevice {
        public int size;
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)] public string name;
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=128)] public string description;
        public int flags;
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=128)] public string id;
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=128)] public string key;
    }
    [DllImport("user32",CharSet=CharSet.Unicode)] static extern bool EnumDisplayDevices(string name,int index,ref DisplayDevice device,int flags);
    static string GdiSource(bool attached) {
        var adapter=new DisplayDevice{size=Marshal.SizeOf(typeof(DisplayDevice))};
        for(int ai=0;EnumDisplayDevices(null,ai,ref adapter,0);ai++){
            if(((adapter.flags&1)!=0)!=attached || (adapter.flags&12)!=0)continue; // primary or mirroring driver
            var monitor=new DisplayDevice{size=adapter.size};
            bool owned=String.Equals(adapter.id,Instance,StringComparison.OrdinalIgnoreCase), foreign=false;
            for(int mi=0;EnumDisplayDevices(adapter.name,mi,ref monitor,1);mi++){
                if(OwnedInterface(monitor.id))owned=true;
                else if((monitor.flags&1)!=0)foreign=true;
            }
            if(owned && !foreign)return adapter.name;
        }
        return null;
    }
    static string WaitForSource(){
        for(int i=0;i<10;i++){
            var name=Source(true);
            if(name!=null)return name;
            Thread.Sleep(150);
        }
        return null;
    }
    internal sealed class DisplayLayoutException : Exception {
        internal DisplayLayoutException(string message) : base(message) {}
    }
    // Count physical/virtual targets, not source-target combinations. A laptop GPU can
    // advertise more than a hundred possible paths for just two connected displays.
    internal static bool CanUseSystemExtend(byte[] paths,int count,Func<int,bool> owned) {
        var targets=new List<int>(2);
        for(int i=0;i<count;i++){
            int row=i*72;
            bool active=(Field(paths,row+68)&1)!=0;
            if(!active && Field(paths,row+60)==0)continue;
            int match=targets.FindIndex(other=>SameEndpoint(paths,other+20,row+20));
            if(match>=0){
                if(active)targets[match]=row;
            }else{
                if(targets.Count==2)return false;
                targets.Add(row);
            }
        }
        if(targets.Count!=2)return false;
        bool first=owned(targets[0]),second=owned(targets[1]);
        if(first==second)return false;
        return Field(paths,targets[first?0:1]+60)!=0 && (Field(paths,targets[first?1:0]+68)&1)!=0;
    }
    static string TrySystemExtend(out int status) {
        status=0;
        byte[] paths,modes;int count,modeCount;
        if(ReadPaths(1,out paths,out count,out modes,out modeCount)!=0 ||
           !CanUseSystemExtend(paths,count,row=>OwnsTarget(paths,row)))return null;
        const uint topologyExtend=0x4, apply=0x80;
        // Delegate source assignment to the same Windows projection mode as Win+P → Extend.
        status=SetDisplayConfig(0,null,0,null,topologyExtend|apply);
        if(status!=0)return null;
        for(int retry=0;retry<20;retry++){
            var source=Source(true);
            if(source!=null)return source;
            Thread.Sleep(200);
        }
        return null;
    }
    static string EnableOwnPath(){
        bool sawTarget=false, applied=false;
        int lastError=0;
        var wait=Stopwatch.StartNew();
        do{
            string existing=Source(true);
            if(existing!=null)return existing;
            byte[] paths,modes;int count,modeCount;
            int status=ReadPaths(1,out paths,out count,out modes,out modeCount);
            if(status!=0)throw new Exception("Windows could not list display paths (code "+status+"). Try again from the laptop’s local desktop.");
            var active=new List<int>();
            for(int i=0;i<count;i++)if((Field(paths,i*72+68)&1)!=0)active.Add(i*72);
            for(int i=0;i<count;i++){
                int row=i*72;
                if(Field(paths,row+60)==0 || !OwnsTarget(paths,row))continue;
                sawTarget=true;
                if(active.Contains(row))continue;
                // Replace this target's cloned path, preserving every other active monitor.
                var keep=active.FindAll(a=>!SameEndpoint(paths,a+20,row+20));
                if(keep.Exists(a=>SameEndpoint(paths,a,row)))continue;
                int offset=keep.Count*72;
                var selected=new byte[offset+72];
                for(int k=0;k<keep.Count;k++)Buffer.BlockCopy(paths,keep[k],selected,k*72,72);
                Buffer.BlockCopy(paths,row,selected,offset,72);
                Set(selected,offset+12,-1);Set(selected,offset+32,-1);Set(selected,offset+68,1);
                const uint supplied=0x20|0x400;
                status=SetDisplayConfig(keep.Count+1,selected,modeCount,modes,supplied|0x40);
                if(status==0)status=SetDisplayConfig(keep.Count+1,selected,modeCount,modes,supplied|0x80);
                if(status!=0){lastError=status;continue;}
                applied=true;
                var name=WaitForSource();if(name!=null)return name;
                break;
            }
            // Detached GDI displays can acquire a desktop source before CCD lists an available path.
            string detached=GdiSource(false);
            if(detached!=null){
                sawTarget=true;
                var mode=Mode(detached,-2);
                if(mode==null || Field(mode,172)==0 || Field(mode,176)==0)mode=Mode(detached,0);
                if(mode!=null){
                    int right=0;foreach(var screen in System.Windows.Forms.Screen.AllScreens)right=Math.Max(right,screen.Bounds.Right);
                    Set(mode,72,0x180020);Set(mode,76,right);Set(mode,80,0);
                    int change=ChangeDisplaySettingsEx(detached,mode,IntPtr.Zero,2,IntPtr.Zero);
                    if(change==0)change=ChangeDisplaySettingsEx(detached,mode,IntPtr.Zero,0,IntPtr.Zero);
                    if(change==0){applied=true;var name=WaitForSource();if(name!=null)return name;}
                    else lastError=change;
                }
            }
            if(sawTarget)break;
            Thread.Sleep(300);
        }while(wait.ElapsedMilliseconds<5000);
        if(!sawTarget && !HasChild())throw new Exception("The virtual display driver is installed, but Windows has not detected its monitor. Choose Repair display driver.");
        int projectionStatus;
        string extended=TrySystemExtend(out projectionStatus);
        if(extended!=null)return extended;
        if(projectionStatus!=0)lastError=projectionStatus;
        string detail=lastError!=0?"Windows returned display code "+lastError+".":
            applied?"Windows accepted the change but did not expose a separate desktop.":"Windows has not provided an independent desktop for the virtual monitor.";
        throw new DisplayLayoutException(detail+" In Display settings, extend the desktop to the virtual monitor, then start a new pairing.");
    }
    internal static string Source(bool requireActive) {
        byte[] paths,modes;int count,modeCount;
        bool cloned=false;
        var primary=System.Windows.Forms.Screen.PrimaryScreen;
        if(ReadPaths(requireActive?2u:1u,out paths,out count,out modes,out modeCount)==0){
            for(int i=0;i<count;i++){
                int row=i*72;
                if(!OwnsTarget(paths,row))continue;
                bool shared=false;
                for(int j=0;j<count;j++)if(j!=i && (Field(paths,j*72+68)&1)!=0 && SameEndpoint(paths,row,j*72))shared=true;
                if(shared){cloned=true;continue;}
                var name=ReadName(paths,row,1);
                if(String.IsNullOrEmpty(name))continue;
                if(primary!=null && String.Equals(name,primary.DeviceName,StringComparison.OrdinalIgnoreCase)){
                    cloned=true;continue;
                }
                return name;
            }
        }
        return cloned?null:GdiSource(requireActive);
    }
    internal static string Diagnostics() {
        byte[] paths,modes;int count,modeCount;
        int result=ReadPaths(1,out paths,out count,out modes,out modeCount), own=0,available=0,active=0;
        if(result==0)for(int i=0;i<count;i++)if(OwnsTarget(paths,i*72)){
            own++;if(Field(paths,i*72+60)!=0)available++;if((Field(paths,i*72+68)&1)!=0)active++;
        }
        return "Adapter child: "+HasChild()+"; display query: "+result+
            "; paths: "+count+"; app paths: "+own+"; available: "+available+"; active: "+active+
            "; desktop source: "+(Source(true)??"none");
    }
    [DllImport("user32",CharSet=CharSet.Unicode)] static extern bool EnumDisplaySettings(string name,int mode,[In,Out]byte[] settings);
    [DllImport("user32",CharSet=CharSet.Unicode)] static extern int ChangeDisplaySettingsEx(string name,byte[] settings,IntPtr hwnd,uint flags,IntPtr param);
    static byte[] Mode(string name,int index) {
        byte[] data=new byte[220]; data[68]=220;
        return EnumDisplaySettings(name,index,data)?data:null;
    }
    static int Field(byte[] mode,int offset){return BitConverter.ToInt32(mode,offset);}
    static void Set(byte[] data,int offset,int value){Buffer.BlockCopy(BitConverter.GetBytes(value),0,data,offset,4);}
    internal sealed class Area { public string name; public int x,y,width,height,fps; }
    internal static Area Current() {
        string name=Source(true);
        if(name==null) return null;
        var mode=Mode(name,-1);
        if(mode==null) return null;
        var s=System.Windows.Forms.Screen.PrimaryScreen;
        if(s==null || s.DeviceName==name) return null;
        return new Area{name=name,x=Field(mode,76),y=Field(mode,80),width=Field(mode,172),height=Field(mode,176),fps=Field(mode,184)<30?60:Math.Min(120,Field(mode,184))};
    }
    internal static Area Attach(int width,int height,int fps) {
        string name=Source(true) ?? EnableOwnPath();
        if(name==null || System.Windows.Forms.Screen.PrimaryScreen.DeviceName==name)
            throw new Exception("The virtual monitor is unavailable. Choose Extend in Windows Display settings, or repair the installation.");
        var current=Current();
        byte[] best=null; double score=double.MaxValue;
        for(int i=0;;i++) {
            byte[] m=Mode(name,i); if(m==null) break;
            int w=Field(m,172),h=Field(m,176),rate=Field(m,184);
            if(w<320 || h<320 || rate<30 || Field(m,168)!=32) continue;
            double cost=12*Math.Abs(Math.Log((double)w*height/(h*width)))+Math.Abs(Math.Log((double)w/width))+0.004*Math.Abs(rate-fps);
            if(cost<score){best=m;score=cost;}
        }
        if(best==null){
            if(current!=null && current.width>=320 && current.height>=320)return current;
            throw new Exception("Windows did not expose a usable video mode for "+name+". Check the display adapter in Device Manager.");
        }
        int x=0,y=0;
        if(current!=null){x=current.x;y=current.y;} else {
            foreach(var s in System.Windows.Forms.Screen.AllScreens) x=Math.Max(x,s.Bounds.Right);
        }
        Set(best,72,0x180020|0x400000); Set(best,76,x);Set(best,80,y);
        if(ChangeDisplaySettingsEx(name,best,IntPtr.Zero,0,IntPtr.Zero)!=0){
            if(current!=null)return current;
            throw new Exception("Windows could not set a resolution for the virtual monitor.");
        }
        var area=Current();
        if(area==null) throw new Exception("Windows has not activated the separate display.");
        return area;
    }
    internal static void Detach(){
        var a=Current(); if(a==null)return;
        var m=Mode(a.name,-1); if(m==null)return;
        Set(m,72,0x180020); Set(m,172,0); Set(m,176,0);
        ChangeDisplaySettingsEx(a.name,m,IntPtr.Zero,0,IntPtr.Zero);
    }
}
