using System;
using System.Linq;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Windows.Forms;

internal static class Host {
    [DllImport("user32")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32")] static extern bool SetCursorPos(int x,int y);
    [DllImport("user32")] static extern void mouse_event(uint flags,uint x,uint y,int data,UIntPtr extra);
    [DllImport("user32")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32")] static extern IntPtr MonitorFromWindow(IntPtr hwnd,uint flags);
    [DllImport("user32")] static extern IntPtr MonitorFromPoint(System.Drawing.Point point,uint flags);
    [StructLayout(LayoutKind.Explicit,Size=40)] struct Key { [FieldOffset(0)] public uint type; [FieldOffset(8)] public ushort vk; [FieldOffset(10)] public ushort scan; [FieldOffset(12)] public uint flags; }
    [DllImport("user32",SetLastError=true)] static extern uint SendInput(uint count,Key[] keys,int size);
    static string lease; static int step; static AutomationElement field; static IntPtr window;
    static bool secret,dragging; static Adapter.Area area;
    static readonly JavaScriptSerializer json=new JavaScriptSerializer {MaxJsonLength=100000};
    static string S(Dictionary<string,object> d,string k){return d.ContainsKey(k)?Convert.ToString(d[k],CultureInfo.InvariantCulture):"";}
    static double N(Dictionary<string,object> d,string k,double min,double max){
        double v;
        if(!double.TryParse(S(d,k),NumberStyles.Float,CultureInfo.InvariantCulture,out v)||double.IsNaN(v)||v<min||v>max)throw new Exception("Invalid input.");
        return v;
    }
    static void KeyEvent(int key,bool up=false,bool unicode=false){
        var k=new Key {type=1,vk=(ushort)(unicode?0:key),scan=(ushort)(unicode?key:0),flags=(uint)((up?2:0)|(unicode?4:0))};
        if(SendInput(1,new[]{k},Marshal.SizeOf(typeof(Key)))!=1)throw new Exception("Windows blocked input to this window.");
    }
    static void Press(int k,bool unicode=false){KeyEvent(k,false,unicode);KeyEvent(k,true,unicode);}
    static void Chord(int modifier,int key){KeyEvent(modifier);try{Press(key);}finally{KeyEvent(modifier,true);}}
    static void Release(){if(dragging)mouse_event(4,0,0,0,UIntPtr.Zero);dragging=false;lease=null;field=null;}
    static bool OnDisplay(){
        if(area==null)return false;
        return MonitorFromWindow(GetForegroundWindow(),0)==MonitorFromPoint(new System.Drawing.Point(area.x+area.width/2,area.y+area.height/2),0);
    }
    static object Reply(int status,string text=""){return new {status=status,responseText=text};}
    static object Input(Dictionary<string,object> d,bool keyboard,bool encrypted) {
        string action=S(d,"action");
        if(area==null) return Reply(409,"The display disconnected.");
        if(keyboard){
            if(action=="end"){if(S(d,"lease")==lease) Release();return Reply(204);}
            if(!OnDisplay())return Reply(409,"Tap a field on the second display first.");
            var focus=AutomationElement.FocusedElement;
            if(focus==null)return Reply(409,"Tap a text field to type, or use a shortcut.");
            if(action=="begin"){
                object pattern;
                bool password=focus.Current.IsPassword;
                bool editable=focus.Current.IsEnabled && (password || (focus.TryGetCurrentPattern(ValuePattern.Pattern,out pattern) && !((ValuePattern)pattern).Current.IsReadOnly) || (focus.Current.ControlType==ControlType.Document && focus.Current.IsKeyboardFocusable));
                if(!editable)return Reply(409,"Choose a shortcut or tap an editable text field.");
                if(password&&!encrypted)return Reply(412,"Password entry requires the encrypted video connection.");
                field=focus;window=GetForegroundWindow();lease=Guid.NewGuid().ToString("N");secret=password;step=0;
                return Reply(password?201:200,lease);
            }
            if(lease==null||S(d,"lease")!=lease||field==null||window!=GetForegroundWindow()||!Automation.Compare(field,focus)||focus.Current.IsPassword!=secret)
                return Reply(409,"The selected field changed. Tap it again.");
            if((int)N(d,"step",1,int.MaxValue)!=step+1)return Reply(409,"Keyboard input is out of sequence.");
            string value=S(d,"text");
            if(value.Length>4096)return Reply(400,"Text is too long.");
            if(secret){
                if(!encrypted)return Reply(412);
                if(action=="passwordDelete")Press(8);
                else if(action=="passwordEnter")Press(13);
                else if(action=="passwordInsert"){foreach(char ch in value)Press(ch,true);}
                else return Reply(400);
            }else if(action=="backspace")Press(8);
            else if(action=="edit"){
                int remove=(int)N(d,"remove",0,4096);
                for(int i=0;i<remove;i++)Press(8);
                foreach(char ch in value)Press(ch,true);
            }else return Reply(400);
            step++;return Reply(204);
        }
        if(action=="cancel"){Release();return Reply(204);}
        if(action=="start"){Press(0x5b);return Reply(204);}
        if(action=="taskView"){Chord(0x5b,9);return Reply(204);}
        if(action=="keyboardShortcut"){
            if(!OnDisplay())return Reply(409,"Tap a window on the second display first.");
            string shortcut=S(d,"shortcut");
            var letters=new Dictionary<string,char>{{"copy",'C'},{"paste",'V'},{"cut",'X'},{"selectAll",'A'},{"undo",'Z'},{"redo",'Y'},{"find",'F'},{"save",'S'}};
            if(letters.ContainsKey(shortcut))Chord(17,letters[shortcut]);
            else if(shortcut=="tab")Press(9);else if(shortcut=="backTab")Chord(16,9);else if(shortcut=="escape")Press(27);else return Reply(400);
            return Reply(204);
        }
        int x=area.x+(int)Math.Round(N(d,"x",0,1)*(area.width-1)),y=area.y+(int)Math.Round(N(d,"y",0,1)*(area.height-1));
        if(!SetCursorPos(x,y))return Reply(409,"Windows blocked pointer input.");
        switch(action){
            case "point":case "move":break;
            case "tap":mouse_event(2,0,0,0,UIntPtr.Zero);mouse_event(4,0,0,0,UIntPtr.Zero);break;
            case "rightClick":mouse_event(8,0,0,0,UIntPtr.Zero);mouse_event(16,0,0,0,UIntPtr.Zero);break;
            case "down":mouse_event(2,0,0,0,UIntPtr.Zero);dragging=true;break;
            case "up":Release();break;
            case "scroll":
                int dx=(int)Math.Round(-N(d,"dx",-2,2)*area.width*2),dy=(int)Math.Round(N(d,"dy",-2,2)*area.height*2);
                if(dx!=0)mouse_event(0x1000,0,0,dx,UIntPtr.Zero);if(dy!=0)mouse_event(0x800,0,0,dy,UIntPtr.Zero);break;
            default:return Reply(400);
        }
        return Reply(204);
    }
    [STAThread] static int Main(string[] args){
        SetProcessDpiAwarenessContext(new IntPtr(-4));
        try{
            if(args.Length==1 && (args[0]=="install"||args[0]=="uninstall")){Adapter.Install(args[0]=="uninstall");return 0;}
            Console.InputEncoding=new System.Text.UTF8Encoding(false);Console.OutputEncoding=new System.Text.UTF8Encoding(false);
            string line;
            while((line=Console.ReadLine())!=null){
                int id=0;object result;
                try{
                    var d=json.Deserialize<Dictionary<string,object>>(line); id=(int)d["id"];
                    switch(S(d,"op")){
                        case "attach":Release();area=Adapter.Attach((int)N(d,"width",320,4096),(int)N(d,"height",320,4096),(int)N(d,"fps",30,120));result=area;break;
                        case "check":area=Adapter.Current();result=area;break;
                        case "detach":Release();Adapter.Detach();area=null;result=true;break;
                        case "release":Release();result=true;break;
                        case "input":result=Input((Dictionary<string,object>)d["body"],S(d,"kind")=="keyboard",d.ContainsKey("encrypted") && (bool)d["encrypted"]);break;
                        default:throw new Exception("Unknown operation.");
                    }
                    Console.WriteLine(json.Serialize(new{id=id,result=result}));
                }catch(Exception e){Console.WriteLine(json.Serialize(new{id=id,error=e.Message}));}
            }
            Release();Adapter.Detach();return 0;
        }catch(Exception e){Console.Error.WriteLine(e.Message);return 1;}
    }
}
