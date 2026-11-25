"""Stage phone display modes alongside the signed driver's original settings."""
from pathlib import Path
import shutil
import xml.etree.ElementTree as ET


def prepare_settings(directory: Path) -> None:
    settings = directory / 'vdd_settings.xml'
    shutil.copyfile(settings, directory / 'vdd_defaults.xml')
    tree = ET.parse(settings)
    # The driver expands every global rate across every resolution. Keep this
    # table close to the size of the vendor's working configuration.
    rates = tree.find('global')
    rates.clear()
    for rate in (60, 120):
        ET.SubElement(rates, 'g_refresh_rate').text = str(rate)
    modes = tree.find('resolutions')
    for width, height in [(1080,1920), (1170,2532), (2532,1170), (1920,1600),
                          (1600,1920), (2160,1856), (1856,2160)]:
        mode = ET.SubElement(modes, 'resolution')
        for tag, value in [('width',width), ('height',height), ('refresh_rate',60)]:
            ET.SubElement(mode, tag).text = str(value)
    tree.write(settings, encoding='utf-8', xml_declaration=True)
