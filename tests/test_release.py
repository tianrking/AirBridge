"""Release policy regression tests: no test-failure or packaging bypass."""
import importlib.util
import itertools
import json
import sys
from pathlib import Path
import tempfile
import unittest
import zipfile

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('package_web', ROOT / 'scripts/package-web.py')
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class ReleasePolicy(unittest.TestCase):
    def workflow(self, name):
        # BaseLoader preserves the GitHub key `on` instead of YAML 1.1's boolean.
        return yaml.load((ROOT / '.github/workflows' / name).read_text(), Loader=yaml.BaseLoader)

    def test_ci_runs_every_push_and_pull_request_without_path_filters(self):
        ci = self.workflow('ci.yml')
        self.assertEqual(set(ci['on']), {'push', 'pull_request', 'workflow_dispatch'})
        self.assertFalse(ci['on']['push'])
        self.assertFalse(ci['on']['pull_request'])
        self.assertEqual(ci['jobs']['checks']['uses'], './.github/workflows/quality.yml')

    def test_release_has_no_alternate_trigger_or_gate_bypass(self):
        release = self.workflow('release.yml')
        self.assertEqual(release['on'], {'push': {'tags': ['v*']}})
        self.assertEqual(release['jobs']['checks']['uses'], './.github/workflows/quality.yml')
        self.assertEqual(release['jobs']['package']['needs'], 'checks')
        self.assertEqual(release['jobs']['publish']['needs'], ['checks', 'package'])
        for name in ('package', 'publish'):
            self.assertNotIn('if', release['jobs'][name])
            self.assertNotIn('continue-on-error', release['jobs'][name])
        self.assertEqual(release['permissions'], {'contents': 'read'})
        self.assertEqual(release['jobs']['publish']['permissions'], {'contents': 'write'})

    def test_pages_only_deploys_tested_main_artifact_with_narrow_permissions(self):
        ci = self.workflow('ci.yml')
        jobs = ci['jobs']
        self.assertEqual(jobs['pages-artifact']['needs'], 'checks')
        self.assertEqual(jobs['deploy-pages']['needs'], ['checks', 'pages-artifact'])
        guard = "github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')"
        for name in ('pages-artifact', 'deploy-pages'):
            self.assertEqual(jobs[name]['if'], guard)
            self.assertNotIn('always()', jobs[name]['if'])
        self.assertEqual(jobs['deploy-pages']['permissions'], {'contents': 'read', 'pages': 'write', 'id-token': 'write'})
        artifact_steps = jobs['pages-artifact']['steps']
        self.assertTrue(any(s.get('with', {}).get('name') == 'tested-web' for s in artifact_steps))
        self.assertFalse(any('npm run build' in s.get('run', '') for s in artifact_steps))
        self.assertIn('git/ref/heads/main', jobs['deploy-pages']['steps'][0]['run'])

    def test_gate_rejects_failed_cancelled_skipped_and_missing_results(self):
        quality = self.workflow('quality.yml')
        gate = quality['jobs']['quality-gate']
        suites = ['web', 'native', 'firmware', 'desktop']
        self.assertEqual(gate['needs'], suites)
        self.assertEqual(gate['if'], 'always()')
        script = gate['steps'][0]['run']
        self.assertEqual(script.strip().splitlines(), [f'test "${name.upper()}_RESULT" = success' for name in suites])
        outcomes = [['success'] * 4]
        for index, bad in itertools.product(range(4), ['failure', 'cancelled', 'skipped', '']):
            values = ['success'] * 4
            values[index] = bad
            outcomes.append(values)
        for values in outcomes:
            # Run the actual gate commands, using sh on Unix and Git's bash on Windows.
            import os
            import shutil
            import subprocess
            shell = shutil.which('bash') if os.name != 'nt' else r'C:\Program Files\Git\bin\bash.exe'
            env = dict(os.environ, **{name.upper() + '_RESULT': value for name, value in zip(suites, values)})
            code = subprocess.run([shell, '-e', '-c', script], env=env, capture_output=True).returncode
            self.assertEqual(code == 0, all(v == 'success' for v in values), values)

    def test_all_test_steps_are_blocking_and_actions_pinned(self):
        quality = self.workflow('quality.yml')
        runs = '\n'.join(s.get('run', '') for j in quality['jobs'].values() for s in j['steps'])
        for command in ('npm ci', 'npm test', 'npm run build', 'npm run test:browser',
                        'python -m unittest', 'ctest ', 'cargo test ', 'cargo fmt '):
            self.assertIn(command, runs)
        for filename in ('ci.yml', 'quality.yml', 'release.yml'):
            workflow = self.workflow(filename)
            self.assertNotIn('pull_request_target', workflow['on'])
            for job in workflow['jobs'].values():
                self.assertNotIn('continue-on-error', job)
                for step in job.get('steps', []):
                    self.assertNotIn('continue-on-error', step)
                    if 'uses' in step:
                        self.assertRegex(step['uses'], r'@[0-9a-f]{40}$')

    def test_firmware_and_installer_are_required_real_builds(self):
        quality = self.workflow('quality.yml')['jobs']
        self.assertRegex(quality['firmware']['container']['image'], r'^espressif/idf:v6\.1@sha256:[0-9a-f]{64}$')
        firmware = '\n'.join(s.get('run', '') for s in quality['firmware']['steps'])
        self.assertIn('idf.py -C firmware', firmware)
        self.assertIn('-DAIRBRIDGE_PUBLIC_BUILD=ON', firmware)
        self.assertIn('package-firmware.py', firmware)
        self.assertEqual(quality['desktop']['needs'], 'web')
        self.assertTrue(any(s.get('with', {}).get('name') == 'tested-web' for s in quality['desktop']['steps']))
        desktop = '\n'.join(s.get('run', '') for s in quality['desktop']['steps'])
        self.assertIn('tauri -- build --ci --bundles nsis', desktop)
        self.assertIn('package-desktop.py', desktop)
        release = self.workflow('release.yml')['jobs']
        names = {s.get('with', {}).get('name') for s in release['package']['steps']}
        self.assertTrue({'public-esp32s3','public-windows-x64','tested-web'}.issubset(names))
        publish = '\n'.join(s.get('run','') for s in release['publish']['steps'])
        self.assertIn('sha256sum --check', publish)
        self.assertIn('--prerelease', publish)


class WebPackage(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        dist = self.root / 'desktop/dist'
        dist.mkdir(parents=True)
        (dist / 'index.html').write_text('<script src="main.js"></script>')
        (dist / 'main.js').write_bytes(b'console.log("checked")')
        (self.root / 'desktop/package.json').write_text('{"version":"0.4.0"}')
        (self.root / 'desktop/README.web.md').write_text('Serve over localhost.')

    def package(self, tag='v0.4.0', commit='a' * 40):
        return packager.package(self.root, tag, commit, self.root / 'release')

    def test_roundtrip_manifest_and_archive_digest(self):
        import hashlib
        archive = self.package()
        with zipfile.ZipFile(archive) as z:
            manifest = json.loads(z.read('MANIFEST.json'))
            self.assertFalse(manifest['hardware_qualified_by_ci'])
            self.assertEqual(manifest['commit'], 'a' * 40)
            for name, record in manifest['files'].items():
                data = z.read(name)
                self.assertEqual(record, {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
        self.assertEqual((archive.parent / 'SHA256SUMS').read_text().split()[0], hashlib.sha256(archive.read_bytes()).hexdigest())

    def test_invalid_tag_commit_and_missing_build_cannot_package(self):
        for tag, commit in [('v9.0.0', 'a' * 40), ('bad/tag', 'a' * 40), ('v0.4.0', 'main')]:
            with self.assertRaises(ValueError):
                self.package(tag, commit)
        (self.root / 'desktop/dist/main.js').unlink()
        with self.assertRaises(ValueError):
            self.package()
