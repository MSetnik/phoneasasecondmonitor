using System;
using System.Runtime.InteropServices;
using System.Text;
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
    internal static void CheckDevice() {
        uint device,status,problem;
        if(CM_Locate_DevNodeW(out device,Instance,0)!=0)
            throw new Exception("The virtual monitor driver is missing. Run the Windows installer and approve the display driver.");
        if(CM_Get_DevNode_Status(out status,out problem,device,0)!=0 || (status&8)==0 || problem!=0)
            throw new Exception("Windows has not started the monitor driver (device code "+problem+"). Check Device Manager, or repair the installation.");
    }
    internal static void Install(bool remove) {
        IntPtr list = SetupDiCreateDeviceInfoList(ref display, IntPtr.Zero);
        if (list == new IntPtr(-1)) throw new System.ComponentModel.Win32Exception();
        try {
            var device = new Device {size=Marshal.SizeOf(typeof(Device))};
            bool exists = SetupDiOpenDeviceInfo(list,Instance,IntPtr.Zero,0,ref device);
            if (remove) {
                if (exists && !SetupDiCallClassInstaller(5,list,ref device)) throw new System.ComponentModel.Win32Exception();
                return;
            }
            if (exists) return;
            byte[] ids = Encoding.Unicode.GetBytes("MttVDD\0\0");
            if (!SetupDiCreateDeviceInfo(list,Instance,ref display,"Phone as a Second Monitor",IntPtr.Zero,0,ref device)
                || !SetupDiSetDeviceRegistryProperty(list,ref device,1,ids,ids.Length)
                || !SetupDiCallClassInstaller(0x19,list,ref device)) throw new System.ComponentModel.Win32Exception();
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
    internal static string Source(bool requireActive) {
        for(int attempt=0;attempt<3;attempt++){
            int n,m; uint flags=requireActive?2u:1u;
            if(GetDisplayConfigBufferSizes(flags,out n,out m)!=0) break;
            byte[] p=new byte[n*72], modes=new byte[m*64];
            int result=QueryDisplayConfig(flags,ref n,p,ref m,modes,IntPtr.Zero);
            if(result==122) continue;
            if(result!=0) break;
            for(int i=0;i<n;i++){
                int row=i*72;
                if(ReadName(p,row+20,4).IndexOf("#MCODEPASM#0000#",StringComparison.OrdinalIgnoreCase)<0) continue;
                string name=ReadName(p,row,1);
                if(string.IsNullOrEmpty(name)) continue;
                bool shared=false;
                for(int j=0;j<n;j++){
                    int other=j*72;
                    if(i!=j && (BitConverter.ToInt32(p,other+68)&1)!=0 && ReadName(p,other,1)==name) shared=true;
                }
                if(!shared) return name;
            }
            break;
        }
        return null;
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
        return new Area{name=name,x=Field(mode,76),y=Field(mode,80),width=Field(mode,172),height=Field(mode,176),fps=Field(mode,184)};
    }
    internal static Area Attach(int width,int height,int fps) {
        string name=Source(true) ?? Source(false);
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
        if(best==null) throw new Exception("Windows reported no usable modes for the virtual monitor.");
        int x=0,y=0;
        if(current!=null){x=current.x;y=current.y;} else {
            foreach(var s in System.Windows.Forms.Screen.AllScreens) x=Math.Max(x,s.Bounds.Right);
        }
        Set(best,72,0x180020|0x400000); Set(best,76,x);Set(best,80,y);
        if(ChangeDisplaySettingsEx(name,best,IntPtr.Zero,1,IntPtr.Zero)!=0) throw new Exception("Windows could not extend the desktop. Open Display settings and select Extend.");
        var area=Current();
        if(area==null) throw new Exception("Windows has not activated the separate display.");
        return area;
    }
    internal static void Detach(){
        var a=Current(); if(a==null)return;
        var m=Mode(a.name,-1); if(m==null)return;
        Set(m,72,0x180020); Set(m,172,0); Set(m,176,0);
        ChangeDisplaySettingsEx(a.name,m,IntPtr.Zero,1,IntPtr.Zero);
    }
}
