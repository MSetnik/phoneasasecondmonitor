"""Generate one website update feed using the release operator's Sparkle signing key."""
import argparse
import base64
import hashlib
import json
import os
import plistlib
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile

ACCOUNT = 'com.mcode.phoneasmonitor.updates'
PUBLIC_KEY = '2h45R7xIOnAQNSgI+1fuOJz+rKgq6q8/KCvQ0vAtQ5k='
BASE = 'https://storage.googleapis.com/phone-as-monitor-mcode-downloads'
SPARKLE = 'http://www.andymatuschak.org/xml-namespaces/sparkle'
ROOT = Path(__file__).resolve().parents[1]

def run(*args):
    return subprocess.check_output(args, text=True).strip()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('platform', choices=['windows','macos'])
    parser.add_argument('artifact',type=Path)
    parser.add_argument('--tools',type=Path,required=True,help='Sparkle bin directory')
    parser.add_argument('--notes',required=True)
    parser.add_argument('--output',type=Path,default=ROOT/'web/updates')
    args=parser.parse_args()
    if not 0<len(args.notes.strip())<=1500:
        parser.error('Release notes must contain 1 to 1500 characters.')
    if run(args.tools/'generate_keys','--account',ACCOUNT,'-p')!=PUBLIC_KEY:
        parser.error('The release signing key does not match the public key in the app.')
    signer=args.tools/'sign_update'
    artifact=args.artifact
    with artifact.open('rb') as f:
        digest=hashlib.file_digest(f,'sha256').hexdigest()
    size=artifact.stat().st_size
    args.output.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=args.output) as scratch:
        if args.platform=='windows':
            filename='Phone-as-a-Second-Monitor-Windows-x64-Setup.exe'
            if artifact.name!=filename:
                parser.error('Select the Windows x64 setup executable.')
            version=json.loads((ROOT/'windows/app/package.json').read_text())['version']
            url=f'{BASE}/windows/x64/{digest}/{filename}'
            release=dict(platform='windows-x64',version=version,sha256=digest,size=size,notes=args.notes)
            payload=json.dumps(release,ensure_ascii=False,separators=(',',':')).encode()
            data=Path(scratch)/'release.dat'
            data.write_bytes(payload)
            signature=run(signer,'--account',ACCOUNT,'-p',data)
            run(signer,'--account',ACCOUNT,'--verify',data,signature)
            feed=Path(scratch)/'windows.json'
            feed.write_text(json.dumps(dict(payload=base64.b64encode(payload).decode(),signature=signature))+'\n')
        else:
            with ZipFile(artifact) as z:
                info=plistlib.loads(z.read('Phone as a Second Monitor.app/Contents/Info.plist'))
            if info.get('CFBundleIdentifier')!='com.mcode.phoneasmonitor.direct' or info.get('SUPublicEDKey')!=PUBLIC_KEY:
                parser.error('Select the direct macOS release with the correct update key.')
            if not (info.get('SURequireSignedFeed') is True and info.get('SUVerifyUpdateBeforeExtraction') is True):
                parser.error('Sparkle needs both signed-feed and pre-extraction verification enabled.')
            build=info['CFBundleVersion']
            version=info['CFBundleShortVersionString']
            url=f'{BASE}/macos/{digest}/Phone-as-a-Second-Monitor.zip'
            signature=run(signer,'--account',ACCOUNT,'-p',artifact)
            run(signer,'--account',ACCOUNT,'--verify',artifact,signature)
            ET.register_namespace('sparkle',SPARKLE)
            channel=ET.Element('channel')
            rss=ET.Element('rss',version='2.0')
            rss.append(channel)
            ET.SubElement(channel,'title').text='Phone as a Second Monitor'
            item=ET.SubElement(channel,'item')
            ET.SubElement(item,'title').text=f'Version {version} (build {build})'
            ET.SubElement(item,f'{{{SPARKLE}}}version').text=build
            ET.SubElement(item,f'{{{SPARKLE}}}shortVersionString').text=f'{version} ({build})'
            ET.SubElement(item,f'{{{SPARKLE}}}minimumSystemVersion').text=info['LSMinimumSystemVersion']
            description=ET.SubElement(item,'description',{f'{{{SPARKLE}}}format':'plain-text'})
            description.text=args.notes
            ET.SubElement(item,'enclosure',{'url':url,'length':str(size),'type':'application/octet-stream',f'{{{SPARKLE}}}edSignature':signature})
            feed=Path(scratch)/'macos.xml'
            ET.ElementTree(rss).write(feed,encoding='utf-8',xml_declaration=True)
            run(signer,'--account',ACCOUNT,feed)
            run(signer,'--account',ACCOUNT,'--verify',feed)
        os.replace(feed,args.output/feed.name)
    print(f'{args.platform} feed ready. Upload this exact artifact to {url} before publishing the feed.')

if __name__=='__main__':
    main()
