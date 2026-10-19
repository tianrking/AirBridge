"""Validate an already-tested project-site build and expose its source identity."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re


def prepare(site, commit, run_url):
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('Full source SHA required')
    if not re.fullmatch(r'https://github\.com/[\w.-]+/[\w.-]+/actions/runs/\d+', run_url):
        raise ValueError('Invalid public workflow URL')
    if not (site / 'index.html').is_file():
        raise ValueError('Missing tested web build')
    html = (site / 'index.html').read_text(encoding='utf-8')
    refs = re.findall(r'(?:src|href)="([^"]+)"', html)
    if not refs or any(not ref.startswith('./assets/') for ref in refs):
        raise ValueError('Entry assets must use relative project-site paths')
    if any(not (site / ref).is_file() for ref in refs):
        raise ValueError('Missing entry asset')
    paths = sorted(site.rglob('*'))
    if any(path.is_symlink() for path in paths):
        raise ValueError('Symlinks cannot be published')
    records = {}
    for path in paths:
        if not path.is_file():
            continue
        name = path.relative_to(site).as_posix()
        if not (name == 'index.html' or name.startswith('assets/')):
            raise ValueError('Unexpected production file: ' + name)
        data = path.read_bytes()
        records[name] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    metadata = {'commit': commit, 'workflow': run_url,
                'prepared_at': datetime.now(timezone.utc).isoformat(),
                'hardware_tested_by_ci': False, 'files': records}
    (site / 'build-info.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
    (site / '.nojekyll').write_text('', encoding='utf-8')
    return metadata


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site', type=Path, required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--run-url', required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.site, args.commit, args.run_url), indent=2))
