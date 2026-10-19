"""Release-component acceptance without opening or enumerating any device."""
import importlib.util
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from release_common import archive, verify_archive


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), ROOT / 'scripts' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Components(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'desktop').mkdir()
        (self.root / 'docs').mkdir()
        (self.root / 'desktop/package.json').write_text('{"version":"0.0.1"}')
        (self.root / 'docs/release-notes-v0.0.1.md').write_text('Public prerelease')
        self.sha = 'a' * 40

    def test_repository_versions_and_tag_agree(self):
        check = load('check-version').check
        self.assertEqual(check(ROOT, 'v0.0.1'), '0.0.1')
        with self.assertRaises(ValueError):
            check(ROOT, 'v0.0.2')

    def test_deterministic_archive_hashes_and_tamper_rejection(self):
        one = archive(self.root / 'one', 'one.zip', 'esp32s3', '0.0.1', self.sha, {'AirBridge-esp32s3.bin': b'firmware'})
        two = archive(self.root / 'two', 'two.zip', 'esp32s3', '0.0.1', self.sha, {'AirBridge-esp32s3.bin': b'firmware'})
        self.assertEqual(one.read_bytes(), two.read_bytes())
        with zipfile.ZipFile(one) as z:
            contents = {n: z.read(n) for n in z.namelist()}
        contents['AirBridge-esp32s3.bin'] = b'corrupt'
        with zipfile.ZipFile(one, 'w') as z:
            for name, data in contents.items():
                z.writestr(name, data)
        with self.assertRaises(ValueError):
            verify_archive(one, '0.0.1', self.sha, 'esp32s3')

    def test_unsafe_paths_wrong_component_and_source_are_rejected(self):
        for path in ('../private.key', '/etc/private', 'a\\b'):
            with self.assertRaises(ValueError):
                archive(self.root, 'bad.zip', 'web', '0.0.1', self.sha, {path: b'x'})
        z = archive(self.root, 'good.zip', 'windows-x64', '0.0.1', self.sha, {'AirBridge.exe': b'fake'})
        for component, sha in [('esp32s3', self.sha), ('windows-x64', 'b' * 40)]:
            with self.assertRaises(ValueError):
                verify_archive(z, '0.0.1', sha, component)

    def test_flash_verify_only_reads_manifest_and_detects_corruption(self):
        z = archive(self.root, 'firmware.zip', 'esp32s3', '0.0.1', self.sha, {'AirBridge-esp32s3.bin': b'firmware'})
        with zipfile.ZipFile(z) as content:
            content.extractall(self.root / 'extracted')
        verifier = load('flash-release')
        self.assertEqual(verifier.verify(self.root / 'extracted')['commit'], self.sha)
        (self.root / 'extracted/AirBridge-esp32s3.bin').write_bytes(b'bad')
        with self.assertRaises(ValueError):
            verifier.verify(self.root / 'extracted')

    def test_missing_or_wrong_source_component_prevents_assembly(self):
        source = self.root / 'parts'
        for name, component in [('web', 'web'), ('esp32s3', 'esp32s3'), ('windows-x64', 'windows-x64')]:
            archive(source, f'AirBridge-{name}-v0.0.1.zip', component, '0.0.1', self.sha, {'sample': b'x'})
        assemble = load('assemble-release').assemble
        with self.assertRaises(ValueError):
            assemble(self.root, source, self.root / 'out', 'v0.0.1', self.sha)
        (source / 'AirBridge-v0.0.1-windows-x64-setup.exe').write_bytes(b'MZinstaller')
        result = assemble(self.root, source, self.root / 'out', 'v0.0.1', self.sha)
        self.assertEqual(len(result), 4)
        self.assertEqual(len((self.root / 'out/SHA256SUMS').read_text().splitlines()), 4)
        with self.assertRaises(ValueError):
            assemble(self.root, source, self.root / 'bad-out', 'v0.0.1', 'b' * 40)

    def test_real_pe_architecture_is_required_for_desktop_package(self):
        packager = load('package-desktop')
        data = bytearray(256)
        data[:2] = b'MZ'
        struct.pack_into('<I', data, 60, 128)
        data[128:132] = b'PE\0\0'
        struct.pack_into('<H', data, 132, 0x8664)
        self.assertEqual(packager.pe_machine(bytes(data)), 0x8664)
        with self.assertRaises(ValueError):
            packager.pe_machine(b'MZnot-a-real-PE')

    def test_public_firmware_rejects_private_or_wrong_profile_before_packaging(self):
        build = self.root / 'build'
        build.mkdir()
        (build / 'project_description.json').write_text(json.dumps({'target':'esp32s3','project_version':'0.0.1','git_revision':'v6.1'}))
        (build / 'sdkconfig').write_text('CONFIG_ESPTOOLPY_FLASHSIZE_16MB=y\nCONFIG_SPIRAM_MODE_OCT=y\nCONFIG_ESP_CONSOLE_USB_SERIAL_JTAG=y\n')
        (build / 'CMakeCache.txt').write_text('AIRBRIDGE_PUBLIC_BUILD:BOOL=OFF\n')
        with self.assertRaisesRegex(ValueError, 'public firmware'):
            load('package-firmware').package(self.root, build, 'v0.0.1', self.sha, self.root / 'out')
