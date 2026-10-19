"""Require every component, verify embedded manifests, then publish one release."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
from release_common import identity, verify_archive

ROOT = Path(__file__).resolve().parents[1]


def assemble(root, source, output, tag, commit):
    version = identity(root, tag, commit)
    expected = {f'AirBridge-web-{tag}.zip': 'web', f'AirBridge-esp32s3-{tag}.zip': 'esp32s3',
                f'AirBridge-windows-x64-{tag}.zip': 'windows-x64', f'AirBridge-{tag}-windows-x64-setup.exe': 'installer'}
    output.mkdir(parents=True, exist_ok=True)
    records = {}
    for name, component in expected.items():
        candidates = list(source.rglob(name))
        if len(candidates) != 1 or candidates[0].is_symlink():
            raise ValueError('Missing or ambiguous release component: ' + name)
        original = candidates[0]
        if component != 'installer':
            verify_archive(original, version, commit, component)
        elif original.read_bytes()[:2] != b'MZ':
            raise ValueError('Installer is not executable')
        target = output / name
        shutil.copyfile(original, target)
        data = target.read_bytes()
        records[name] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    (output / 'SHA256SUMS').write_text(''.join(f'{r["sha256"]}  {name}\n' for name, r in sorted(records.items())))
    (output / 'RELEASE-MANIFEST.json').write_text(json.dumps({'version': version, 'commit': commit, 'files': records,
        'hardware_qualified_by_ci': False, 'desktop_signed': False}, indent=2) + '\n')
    (output / 'RELEASE-NOTES.md').write_text((root / 'docs/release-notes-v0.0.1.md').read_text(encoding='utf-8'), encoding='utf-8')
    return records


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--tag', required=True)
    p.add_argument('--commit', required=True)
    a = p.parse_args()
    print(json.dumps(assemble(ROOT, a.input, a.output, a.tag, a.commit), indent=2))
