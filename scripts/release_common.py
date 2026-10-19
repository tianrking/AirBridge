"""Release packaging primitives; archive readback is a publication requirement."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import zipfile


def identity(root, tag, commit):
    version = json.loads((root / 'desktop/package.json').read_text(encoding='utf-8'))['version']
    if tag != 'v' + version or not re.fullmatch(r'v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?', tag):
        raise ValueError('Release tag must match the application version')
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('A full source commit SHA is required')
    return version


def archive(output, name, component, version, commit, contents):
    if 'MANIFEST.json' in contents:
        raise ValueError('Manifest name is reserved')
    for entry in contents:
        path = PurePosixPath(entry)
        if path.is_absolute() or '..' in path.parts or '\\' in entry:
            raise ValueError('Unsafe archive entry')
    manifest = {'component': component, 'version': version, 'commit': commit,
                'hardware_qualified_by_ci': False,
                'files': {n: {'bytes': len(b), 'sha256': hashlib.sha256(b).hexdigest()} for n, b in contents.items()}}
    contents = dict(contents, **{'MANIFEST.json': (json.dumps(manifest, indent=2) + '\n').encode()})
    output.mkdir(parents=True, exist_ok=True)
    destination = output / name
    with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as z:
        for entry, data in sorted(contents.items()):
            info = zipfile.ZipInfo(entry, (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, data)
    verify_archive(destination, version, commit, component)
    return destination


def verify_archive(path, version, commit, component):
    with zipfile.ZipFile(path) as z:
        if z.testzip() is not None:
            raise ValueError('Archive CRC check failed')
        names = z.namelist()
        if len(names) != len(set(names)):
            raise ValueError('Duplicate archive entries')
        manifest = json.loads(z.read('MANIFEST.json'))
        if (manifest.get('version'), manifest.get('commit')) != (version, commit):
            raise ValueError('Archive source/version mismatch')
        if manifest.get('component') != component:
            raise ValueError('Wrong release component')
        if set(names) != set(manifest['files']) | {'MANIFEST.json'}:
            raise ValueError('Archive manifest coverage mismatch')
        for name, record in manifest['files'].items():
            entry = PurePosixPath(name)
            if entry.is_absolute() or '..' in entry.parts or '\\' in name:
                raise ValueError('Unsafe archive entry')
            data = z.read(name)
            if record != {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}:
                raise ValueError('Archive content does not match manifest: ' + name)
        if manifest.get('hardware_qualified_by_ci') is not False:
            raise ValueError('CI cannot claim hardware qualification')
        return manifest
