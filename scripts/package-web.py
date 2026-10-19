"""Package an already-tested static build; reject version drift and verify bytes."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def package(root, tag, commit, output):
    version = json.loads((root / 'desktop/package.json').read_text(encoding='utf-8'))['version']
    if tag != 'v' + version or not re.fullmatch(r'v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?', tag):
        raise ValueError('Release tag must match desktop/package.json version exactly')
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('A full source commit SHA is required')
    dist = root / 'desktop/dist'
    files = sorted(p for p in dist.rglob('*') if p.is_file())
    if not (dist / 'index.html').is_file() or not any(p.suffix == '.js' for p in files):
        raise ValueError('Missing tested production build')
    if any(p.is_symlink() for p in dist.rglob('*')):
        raise ValueError('Symlinks are not allowed in release assets')
    contents = {p.relative_to(dist).as_posix(): p.read_bytes() for p in files}
    contents['README.md'] = (root / 'desktop/README.web.md').read_bytes()
    manifest = {'version': version, 'commit': commit, 'hardware_qualified_by_ci': False,
                'files': {name: {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
                          for name, data in contents.items()}}
    contents['MANIFEST.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
    output.mkdir(parents=True, exist_ok=True)
    archive = output / f'AirBridge-web-{tag}.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, data in contents.items():
            z.writestr(name, data)
    with zipfile.ZipFile(archive) as z:
        if z.testzip() is not None:
            raise ValueError('Archive CRC check failed')
        for name, data in contents.items():
            if z.read(name) != data:
                raise ValueError('Archive readback failed: ' + name)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (output / 'SHA256SUMS').write_text(f'{digest}  {archive.name}\n', encoding='utf-8')
    (output / 'RELEASE-NOTES.md').write_text(
        f'Browser Web Serial build for {commit}.\n\n'
        'Automated unit, protocol, Windows host and Chromium failure/storage checks passed. '
        'CI uses synthetic serial input and real browser OPFS; it does not certify physical USB, '
        'the user-selected Windows folder picker, radio discovery or native AirDrop interoperability.\n\n'
        'Serve the extracted build over HTTPS or localhost. See the included README. '
        'This ZIP contains the web assets only. The same release provides separate Windows and ESP32-S3 packages.\n', encoding='utf-8')
    return archive


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tag', required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(package(ROOT, args.tag, args.commit, args.output))
