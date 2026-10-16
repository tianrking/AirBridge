"""Serial acceptance tool: publish verified files atomically before acknowledging Apple."""
# Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
import argparse
import base64
import hashlib
import hmac
import json
import os
import re
import time
import uuid
from pathlib import Path, PureWindowsPath
import serial
from serial.tools import list_ports

def safe_name(name):
    if not name or len(name.encode('utf-8')) > 240 or name[-1] in '. ':
        return False
    if any(ord(c) < 32 or c in '/\\:<>"|?*' for c in name) or PureWindowsPath(name).is_reserved():
        return False
    return True

class SerialLines:
    """Preserve incomplete records across serial read timeouts."""
    def __init__(self):
        self.pending = bytearray()

    def feed(self, data):
        self.pending.extend(data)
        records = []
        while b'\n' in self.pending:
            at = self.pending.index(b'\n')
            if at > 16384:
                raise ValueError('Serial line exceeds bound')
            records.append(bytes(self.pending[:at]))
            del self.pending[:at+1]
        if len(self.pending) > 16384:
            raise ValueError('Serial line exceeds bound')
        return records

class Receiver:
    def __init__(self, directory, acknowledge):
        self.directory = Path(directory).resolve()
        self.directory.mkdir(parents=True, exist_ok=True)
        self.acknowledge = acknowledge
        self.job = None
        self.receipts = []

    def handle(self, event):
        kind = event.get('event')
        if kind == 'transfer_begin':
            if self.job and not self.job.get('complete'):
                raise ValueError('Previous transfer has not completed')
            identity = event['transfer_id']
            if not re.fullmatch(r'[A-Za-z0-9-]{1,64}', identity):
                raise ValueError('Invalid transfer id')
            count, total = event['files'], event['total_bytes']
            if not isinstance(count, int) or not 1 <= count <= 16 or not isinstance(total, int) or not 0 <= total <= 64*1024*1024:
                raise ValueError('Manifest exceeds bounds')
            temporary = self.directory / (identity + '.' + uuid.uuid4().hex + '.partial')
            temporary.mkdir()
            self.job = dict(id=identity, count=count, total=total, temporary=temporary, files={}, names=set(), offers={})
            print(json.dumps(dict(event='receiving', files=count, bytes=total)), flush=True)
        elif kind == 'manifest_file':
            job = self.job
            if not job or job.get('published') or job['files']:
                raise ValueError('Manifest outside a new transfer')
            index, size = event['index'], event['size']
            name = base64.b64decode(event['name_b64'], validate=True).decode('utf-8')
            if not isinstance(index, int) or not 0 <= index < job['count'] or index in job['offers'] or not safe_name(name) or not isinstance(size, int) or not 0 <= size <= job['total']:
                raise ValueError('Invalid manifest entry')
            if any(f['name'].casefold() == name.casefold() for f in job['offers'].values()):
                raise ValueError('Duplicate manifest filename')
            job['offers'][index] = dict(name=name, size=size)
        elif kind in ('file_begin', 'file_chunk', 'file_end'):
            job = self.job
            if not job or job.get('published'):
                raise ValueError('File event outside an active transfer')
            index = event['index']
            if not isinstance(index, int) or not 0 <= index < 32:
                raise ValueError('Invalid file index')
            if kind == 'file_begin':
                name = base64.b64decode(event['name_b64'], validate=True).decode('utf-8')
                size = event['size']
                metadata = event.get('metadata', False)
                original = index-16 if metadata is True else index
                offer = job['offers'].get(original)
                if len(job['offers']) != job['count'] or sum(f['size'] for f in job['offers'].values()) != job['total'] or not offer:
                    raise ValueError('File has no complete matching manifest')
                if metadata is not True and metadata is not False:
                    raise ValueError('Invalid metadata flag')
                if name != ('._'+offer['name'] if metadata else offer['name']) or (not metadata and size != offer['size']):
                    raise ValueError('File differs from accepted offer')
                if not safe_name(name) or name.casefold() in job['names'] or index in job['files'] or not isinstance(size, int) or not 0 <= size <= 64*1024*1024:
                    raise ValueError('Unsafe or duplicate file metadata')
                job['names'].add(name.casefold())
                path = job['temporary'] / name
                job['files'][index] = dict(name=name, size=size, offset=0, hash=hashlib.sha256(), stream=path.open('xb'), metadata=metadata)
            else:
                file = job['files'][index]
                if file.get('done'):
                    raise ValueError('File already closed')
                if kind == 'file_chunk':
                    chunk = base64.b64decode(event['data'], validate=True)
                    if event['offset'] != file['offset'] or not 0 < len(chunk) <= 512 or file['offset']+len(chunk) > file['size']:
                        raise ValueError('Chunk offset/length mismatch')
                    if file['stream'].write(chunk) != len(chunk):
                        raise OSError('Partial file write')
                    file['hash'].update(chunk)
                    file['offset'] += len(chunk)
                    command = ('CHUNK '+job['id']+' '+str(index)+' '+str(file['offset'])+'\n').encode('ascii')
                    if self.acknowledge(command) != len(command):
                        raise OSError('Incomplete chunk acknowledgement')
                else:
                    digest = file['hash'].hexdigest()
                    if file['offset'] != file['size'] or event['bytes'] != file['size'] or not hmac.compare_digest(digest, event['sha256']):
                        raise ValueError('File SHA256/size mismatch')
                    file['stream'].flush()
                    os.fsync(file['stream'].fileno())
                    file['stream'].close()
                    file.update(done=True, sha256=digest)
        elif kind == 'transfer_ready':
            job = self.job
            if not job or job.get('published') or event['transfer_id'] != job['id'] or not re.fullmatch(r'[0-9a-f]{32}', event['nonce']):
                raise ValueError('Unexpected commit challenge')
            originals = [f for f in job['files'].values() if not f['metadata']]
            if len(originals) != job['count'] or not all(f.get('done') for f in job['files'].values()) or sum(f['size'] for f in originals) != job['total'] or event['files'] != len(job['files']) or event['total_bytes'] != sum(f['size'] for f in job['files'].values()):
                raise ValueError('Transfer incomplete')
            destination = self.directory / (job['id'] + '-' + uuid.uuid4().hex[:8])
            os.rename(job['temporary'], destination)
            job.update(published=destination)
            command = ('COMMIT ' + event['nonce'] + '\n').encode('ascii')
            if self.acknowledge(command) != len(command):
                raise OSError('Incomplete serial commit acknowledgement')
        elif kind == 'transfer_complete':
            job = self.job
            if not job or event['transfer_id'] != job['id']:
                raise ValueError('Completion id mismatch')
            if event.get('host_committed') is not True or event.get('response_written') is not True or not job.get('published'):
                raise ValueError('Apple delivery was not confirmed')
            receipt = dict(event='received', transfer_id=job['id'], directory=str(job['published']), total_bytes=job['total'],
                           files=[dict(name=f['name'], bytes=f['size'], sha256=f['sha256'], metadata=f['metadata']) for _, f in sorted(job['files'].items())])
            self.receipts.append(receipt)
            job['complete'] = True
            print(json.dumps(receipt, ensure_ascii=False), flush=True)
            with job['published'].with_suffix('.receipt.json').open('x', encoding='utf-8') as record:
                record.write(json.dumps(receipt, ensure_ascii=False, indent=2))

    def close(self):
        if self.job:
            for file in self.job['files'].values():
                file['stream'].close()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', default='COM4')
    parser.add_argument('--serial', default='F0:9E:9E:1E:61:3C')
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--log', type=Path, required=True)
    parser.add_argument('--seconds', type=int, default=300, help='Run duration; 0 keeps the receiver running')
    args = parser.parse_args()
    ports = [p for p in list_ports.comports() if p.device == args.port]
    if len(ports) != 1 or ports[0].serial_number != args.serial or args.port != 'COM4':
        raise RuntimeError('Authorized replacement COM4 identity is not present')
    connection = serial.Serial(port=None, baudrate=115200, timeout=.2, write_timeout=5)
    connection.dtr = connection.rts = False
    connection.port = args.port
    receiver = Receiver(args.directory, connection.write)
    args.log.parent.mkdir(parents=True, exist_ok=True)
    try:
        with connection, args.log.open('w', encoding='utf-8') as log:
            print('Verified COM4; waiting for native AirDrop upload', flush=True)
            if args.seconds < 0:
                raise ValueError('Duration must be nonnegative')
            deadline = time.monotonic() + args.seconds if args.seconds else float('inf')
            lines = SerialLines()
            while time.monotonic() < deadline:
                data = connection.read(max(1, min(connection.in_waiting, 4096)))
                for raw in lines.feed(data):
                    try:
                        event = json.loads(raw.decode('utf-8'))
                    except (ValueError, UnicodeError):
                        continue
                    log.write(json.dumps(event, ensure_ascii=True)+'\n')
                    log.flush()
                    receiver.handle(event)
                    if event.get('event') in ('native_receiver_ready', 'native_receiver_failed', 'native_tls_ready', 'native_tls_failed', 'native_request', 'ask_rejected'):
                        print(json.dumps(event, ensure_ascii=True), flush=True)
    finally:
        receiver.close()

if __name__ == '__main__':
    main()
