"""One public version across npm, lockfiles, Tauri, Cargo and firmware."""
import argparse
import json
from pathlib import Path
import re
import tomllib

ROOT = Path(__file__).resolve().parents[1]


def check(root, tag=None):
    version = (root / 'VERSION').read_text().strip()
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Invalid VERSION')
    values = {
        'npm': json.loads((root / 'desktop/package.json').read_text())['version'],
        'npm lock': json.loads((root / 'desktop/package-lock.json').read_text())['version'],
        'npm package lock': json.loads((root / 'desktop/package-lock.json').read_text())['packages']['']['version'],
        'Tauri': json.loads((root / 'desktop/src-tauri/tauri.conf.json').read_text())['version'],
        'Cargo': tomllib.loads((root / 'desktop/Cargo.toml').read_text())['workspace']['package']['version'],
    }
    for package in tomllib.loads((root / 'desktop/Cargo.lock').read_text())['package']:
        if package['name'] in ('airbridge-desktop', 'airbridge-host'):
            values['Cargo lock ' + package['name']] = package['version']
    if any(v != version for v in values.values()) or (tag and tag != 'v' + version):
        raise ValueError('Version mismatch: ' + repr(values))
    return version


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--tag')
    print(check(ROOT, p.parse_args().tag))
