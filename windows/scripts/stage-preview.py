"""Stage the Windows test download as a separate Firebase Hosting preview."""
import hashlib
from pathlib import Path
import shutil

root = Path(__file__).resolve().parents[2]
name = 'Phone-as-a-Second-Monitor-Windows-x64-Setup.exe'
source = root / 'dist' / name
destination = root / 'out' / 'web-preview' / 'public'
destination.mkdir(parents=True, exist_ok=True)
shutil.copyfile(source, destination / name)
shutil.copyfile(root / 'viewer/display-icon.png', destination / 'icon.png')
shutil.copyfile(root / 'windows/website/index.html', destination / 'index.html')
with source.open('rb') as installer:
    print(name, hashlib.file_digest(installer, 'sha256').hexdigest())
