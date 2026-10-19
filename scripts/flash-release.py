"""Verify a release first; flash only an explicitly selected port and consent."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys


def verify(root):
    manifest = json.loads((root / 'MANIFEST.json').read_text())
    if manifest.get('component') != 'esp32s3':
        raise ValueError('Not an ESP32-S3 release package')
    for name, record in manifest['files'].items():
        path = Path(name)
        if path.is_absolute() or '..' in path.parts or '\\' in name:
            raise ValueError('Unsafe release path')
        data = (root / path).read_bytes()
        if record != {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}:
            raise ValueError('Integrity check failed: ' + name)
    if 'AirBridge-esp32s3.bin' not in manifest['files']:
        raise ValueError('Merged firmware image is missing')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', help='Explicit serial port, such as COM7 or /dev/ttyACM0')
    parser.add_argument('--verify-only', action='store_true')
    parser.add_argument('--yes', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    manifest = verify(root)
    print('Verified AirBridge ' + manifest['version'] + ' ESP32-S3 package')
    if args.verify_only:
        sys.exit(0)
    if not args.port or len(args.port) > 256 or any(ord(c) < 32 for c in args.port):
        parser.error('Choose a port explicitly; devices are never enumerated or selected automatically')
    if not args.yes and input('Write firmware to ' + args.port + '? Type FLASH to continue: ') != 'FLASH':
        sys.exit('Cancelled; no device was opened')
    subprocess.run([sys.executable, '-m', 'esptool', '--chip', 'esp32s3', '--port', args.port,
                    '--baud', '460800', 'write-flash', '--flash-mode', 'dio', '--flash-size', '16MB',
                    '--flash-freq', '80m', '0x0', str(root / 'AirBridge-esp32s3.bin')], check=True)
