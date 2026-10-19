import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('prepare_pages', ROOT / 'scripts/prepare-pages.py')
pages = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pages)


class PagesArtifact(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.site = Path(self.temp.name)
        (self.site / 'assets').mkdir()
        (self.site / 'assets/app.js').write_text('checked')
        (self.site / 'index.html').write_text('<script src="./assets/app.js"></script>')

    def prepare(self):
        return pages.prepare(self.site, 'a' * 40, 'https://github.com/tianrking/AirBridge/actions/runs/123')

    def test_relative_project_assets_get_hashed_source_manifest(self):
        result = self.prepare()
        self.assertEqual(result['commit'], 'a' * 40)
        self.assertEqual(result['files']['assets/app.js']['bytes'], 7)
        self.assertFalse(result['hardware_tested_by_ci'])
        self.assertTrue((self.site / '.nojekyll').exists())
        self.assertEqual(json.loads((self.site / 'build-info.json').read_text()), result)

    def test_root_paths_missing_assets_and_unexpected_files_are_rejected(self):
        for invalid in ('/assets/app.js', './assets/missing.js', 'https://external.example/app.js'):
            (self.site / 'index.html').write_text(f'<script src="{invalid}"></script>')
            with self.assertRaises(ValueError):
                self.prepare()
        (self.site / 'index.html').write_text('<script src="./assets/app.js"></script>')
        (self.site / 'private.txt').write_text('must not publish')
        with self.assertRaises(ValueError):
            self.prepare()
