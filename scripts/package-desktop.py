"""Package an actual Windows x64 production executable and NSIS installer."""
import argparse
from pathlib import Path
import shutil
import struct
from release_common import archive, identity

ROOT = Path(__file__).resolve().parents[1]


def pe_machine(data):
    if data[:2] != b'MZ' or len(data) < 64:
        raise ValueError('Not a Windows executable')
    offset = struct.unpack_from('<I', data, 60)[0]
    if data[offset:offset + 4] != b'PE\x00\x00':
        raise ValueError('Invalid Windows PE header')
    return struct.unpack_from('<H', data, offset + 4)[0]


def package(root, target, tag, commit, output):
    version = identity(root, tag, commit)
    executable = target / 'release/airbridge-desktop.exe'
    installers = list((target / 'release/bundle/nsis').glob('*_x64-setup.exe'))
    if len(installers) != 1 or f'_{version}_' not in installers[0].name:
        raise ValueError('Expected exactly one version-matched x64 NSIS installer')
    binary = executable.read_bytes()
    if pe_machine(binary) != 0x8664 or pe_machine(installers[0].read_bytes()) not in (0x14c, 0x8664):
        raise ValueError('Wrong Windows executable architecture')
    result = archive(output, f'AirBridge-windows-x64-{tag}.zip', 'windows-x64', version, commit,
                     {'AirBridge.exe': binary, 'README.md': (root / 'desktop/README.md').read_bytes()})
    shutil.copyfile(installers[0], output / f'AirBridge-{tag}-windows-x64-setup.exe')
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--target', type=Path, required=True)
    p.add_argument('--tag', required=True)
    p.add_argument('--commit', required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    print(package(ROOT, a.target, a.tag, a.commit, a.output))
