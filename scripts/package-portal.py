#!/usr/bin/env python3
"""Build the Omada import archive from public runtime assets only."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root = Path(__file__).resolve().parent.parent
output = root / 'omada-portal.zip'
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for name in ('index.html', 'index.css', 'index.js'):
        archive.write(root / 'template-repo' / name, name)
assert output.stat().st_size < 2 * 1024 * 1024, 'Omada portals must fit within 2 MB'
print(f'{output.name}: {output.stat().st_size:,} bytes; 3 public runtime assets')
