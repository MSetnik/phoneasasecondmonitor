"""Prepare the pinned Windows runtime, signed upstream driver and NSIS file list."""
from pathlib import Path
import hashlib, shutil, sys, urllib.request, zipfile, struct
import xml.etree.ElementTree as ET
root = Path(__file__).resolve().parents[2]
out=root/'out'; product=out/'product'; cache=out/'cache'
cache.mkdir(parents=True,exist_ok=True)
(root/'dist').mkdir(exist_ok=True)
def fetch(name,url,digest):
    p=cache/name
    if not p.exists():
        with urllib.request.urlopen(url,timeout=90) as response, p.open('wb') as dst:
            shutil.copyfileobj(response,dst)
    if hashlib.file_digest(p.open('rb'),'sha256').hexdigest()!=digest:
        raise SystemExit('Checksum mismatch: '+name)
    return p
def extract(archive,directory):
    with zipfile.ZipFile(archive) as z: z.extractall(directory)
electron=fetch('electron.zip','https://github.com/electron/electron/releases/download/v45.5.0/electron-v45.5.0-win32-x64.zip','20155c8b8aa5b1f575f3757bdf21490e0bac2f19a65a26ce9ba99bcf9f2c69bd')
driver=fetch('vdd.zip','https://github.com/VirtualDrivers/Virtual-Display-Driver/releases/download/25.7.23/VirtualDisplayDriver-x86.Driver.Only.zip','e24210692b442b39af763536330ce78b423f19342b7a7792c26de3944e418b3a')
if product.exists(): shutil.rmtree(product)
extract(electron,product)
(product/'electron.exe').rename(product/'PhoneAsMonitor.exe')
res=product/'resources'
(res/'default_app.asar').unlink(missing_ok=True)
shutil.copytree(root/'windows/app',res/'app',ignore=shutil.ignore_patterns('package-lock.json','.bin'))
shutil.copytree(root/'viewer',res/'viewer')
shutil.copy(out/'MonitorHost.exe',res)
extract(driver,out/'upstream')
shutil.copytree(out/'upstream/VirtualDisplayDriver',product/'driver')
shutil.copy(root/'windows/installer/VDD-LICENSE.txt',product/'driver')
xml=product/'driver/vdd_settings.xml'
tree=ET.parse(xml); modes=tree.find('resolutions')
for w,h in [(1280,720),(1600,900),(1920,1080),(2560,1440),(1280,800),(1920,1200),(1440,1080),(2048,1536),(1600,1000),(1920,1440),(1680,1440),(2160,1856),(2176,1812),(2184,1968),(2208,1768),(2152,1536),(2160,2160),(1920,1920),(1920,864),(2340,1080),(2532,1170),(2556,1179),(2560,1184)]:
    for x,y in {(w,h),(h,w)}:
        elem=ET.SubElement(modes,'resolution')
        for tag,v in [('width',x),('height',y),('refresh_rate',60)]: ET.SubElement(elem,tag).text=str(v)
tree.write(xml,encoding='utf-8',xml_declaration=True)
png=(root/'viewer/display-icon.png').read_bytes()
w,h=struct.unpack('>II',png[16:24])
ico=struct.pack('<HHHBBBBHHII',0,1,1,w%256,h%256,0,0,1,32,len(png),22)+png
(out/'monitor.ico').write_bytes(ico);(product/'monitor.ico').write_bytes(ico)
entries=sorted(product.rglob('*'),key=lambda p:(len(p.parts),str(p)),reverse=True)
with (out/'uninstall-files.nsh').open('w',encoding='utf-8') as f:
    for p in entries:
        rel=str(p.relative_to(product)).replace('/','\\').replace('$','$$')
        f.write(('RMDir' if p.is_dir() else 'Delete')+' "$INSTDIR\\'+rel+'"\n')
