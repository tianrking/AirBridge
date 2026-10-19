"""Package a real ESP-IDF 6.1 public build without NVS, private keys or host paths."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from release_common import archive, identity

ROOT = Path(__file__).resolve().parents[1]


def package(root, build, tag, commit, output):
    version = identity(root, tag, commit)
    description = json.loads((build / 'project_description.json').read_text())
    config = (build / 'sdkconfig').read_text()
    cache = (build / 'CMakeCache.txt').read_text()
    if (description.get('target'), description.get('project_version'), description.get('git_revision')) != ('esp32s3', version, 'v6.1'):
        raise ValueError('Expected a version-matched ESP-IDF 6.1 ESP32-S3 build')
    for flag in ('AIRBRIDGE_PUBLIC_BUILD', 'AIRBRIDGE_NATIVE_SERVICE', 'AIRBRIDGE_PRESENCE_TX', 'AIRBRIDGE_IPV6_LINK'):
        if not any(f'{flag}:BOOL={v}' in cache for v in ('TRUE', 'ON', '1')):
            raise ValueError('Not a complete public firmware build: ' + flag)
    if 'AIRBRIDGE_PROBE_PEER:STRING=\n' not in cache:
        raise ValueError('Public release must not embed a private peer address')
    for flag in ('CONFIG_ESPTOOLPY_FLASHSIZE_16MB=y', 'CONFIG_SPIRAM_MODE_OCT=y', 'CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG=y'):
        if flag not in config:
            raise ValueError('Wrong board profile: ' + flag)
    flash = json.loads((build / 'flasher_args.json').read_text())
    if flash['flash_settings'] != {'flash_mode': 'dio', 'flash_size': '16MB', 'flash_freq': '80m'} or flash['extra_esptool_args']['chip'] != 'esp32s3':
        raise ValueError('Unsupported flash settings')
    expected = {'0x0': 'bootloader/bootloader.bin', '0x8000': 'partition_table/partition-table.bin', '0x10000': 'airbridge_native.bin'}
    if flash['flash_files'] != expected:
        raise ValueError('Unexpected flash layout')
    contents = {name: (build / name).read_bytes() for name in expected.values()}
    if contents['airbridge_native.bin'][:1] != b'\xe9':
        raise ValueError('Missing real ESP application image')
    with tempfile.TemporaryDirectory() as temporary:
        merged = Path(temporary) / 'AirBridge-esp32s3.bin'
        args = [sys.executable, '-m', 'esptool', '--chip', 'esp32s3', 'merge-bin', '-o', str(merged), *flash['write_flash_args']]
        for offset, name in expected.items():
            args += [offset, str(build / name)]
        subprocess.run(args, check=True)
        contents['AirBridge-esp32s3.bin'] = merged.read_bytes()
    contents['flash.py'] = (root / 'scripts/flash-release.py').read_bytes()
    contents['README.md'] = (root / 'docs/firmware-release.md').read_bytes()
    contents['LICENSE'] = (root / 'LICENSE').read_bytes()
    contents['BUILD.json'] = (json.dumps({'version': version, 'commit': commit, 'idf': 'v6.1', 'target': 'ESP32-S3 N16R8',
        'flash_bytes': 16777216, 'psram_bytes': 8388608, 'identity': 'generated per device at first boot',
        'incoming_policy': 'explicit session peer authorization', 'hardware_tested_by_ci': False,
        'flash_files': expected}, indent=2) + '\n').encode()
    result = archive(output, f'AirBridge-esp32s3-{tag}.zip', 'esp32s3', version, commit, contents)
    with tempfile.TemporaryDirectory() as temporary:
        import zipfile
        with zipfile.ZipFile(result) as z:
            z.extractall(temporary)
        subprocess.run([sys.executable, str(Path(temporary) / 'flash.py'), '--verify-only'], check=True)
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--build', type=Path, required=True)
    p.add_argument('--tag', required=True)
    p.add_argument('--commit', required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    print(package(ROOT, a.build.resolve(), a.tag, a.commit, a.output))
