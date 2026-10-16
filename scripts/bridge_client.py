"""One-owner serial client for native sending and concurrent verified receiving."""
# Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
import base64
import hashlib
import importlib.util
import json
import plistlib
import re
import secrets
import time
import uuid
import zlib
from pathlib import Path

import serial
from serial.tools import list_ports

_spec = importlib.util.spec_from_file_location('airbridge_receiving', Path(__file__).with_name('receive-native.py'))
_receiving = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_receiving)


class BridgeError(RuntimeError):
    pass


def encode_command(sequence, body):
    if not isinstance(sequence, int) or not 0 <= sequence <= 0xffffffff:
        raise ValueError('Sequence exceeds uint32')
    encoded = body.encode('ascii')
    if not encoded or len(encoded) > 192 or any(c < 32 or c > 126 or c == 42 for c in encoded):
        raise ValueError('Invalid command body')
    payload = str(sequence).encode('ascii') + b' ' + encoded
    frame = b'AB2 ' + payload + (' *%08x\n' % (zlib.crc32(payload) & 0xffffffff)).encode('ascii')
    if len(frame) > 224:
        raise ValueError('Command exceeds physical record bound')
    return frame


def make_manifest(name, size, sender_id, uti='public.data', transfer_id=None):
    if not _receiving.safe_name(name) or not isinstance(size, int) or size < 0:
        raise ValueError('Invalid source file metadata')
    if not re.fullmatch(r'[A-Za-z0-9.-]{1,64}', uti) or not re.fullmatch(r'[0-9a-f]{12}', sender_id):
        raise ValueError('Invalid UTI or sender identity')
    identity = transfer_id or str(uuid.uuid4()).upper()
    if not re.fullmatch(r'[A-Za-z0-9-]{1,64}', identity):
        raise ValueError('Invalid transfer id')
    manifest = {
        'TransferID': {'id': identity}, 'TransferType': {'files': {}},
        'SenderID': sender_id, 'BundleID': 'com.apple.finder',
        'SenderComputerName': 'AirBridge PC', 'SenderModelName': 'Windows',
        'Items': [], 'ConvertMediaFormats': False,
        'Files': [{'FileName': name, 'FileSize': size, 'FileType': uti,
                   'FileBomPath': './' + name, 'FileIsDirectory': False,
                   'ConvertMediaFormats': False}],
    }
    encoded = plistlib.dumps(manifest, fmt=plistlib.FMT_BINARY, sort_keys=False)
    if len(encoded) > 131072:
        raise ValueError('Manifest exceeds firmware bound')
    return identity, encoded


def open_authorized_port(port='COM4', usb_serial='F0:9E:9E:1E:61:3C'):
    matches = [p for p in list_ports.comports() if p.device == port]
    if port != 'COM4' or len(matches) != 1 or matches[0].serial_number != usb_serial:
        raise BridgeError('Authorized replacement COM4 identity is not present')
    connection = serial.Serial(port=None, baudrate=115200, timeout=.1, write_timeout=5)
    connection.dtr = connection.rts = False
    connection.port = port
    connection.open()
    connection.reset_input_buffer()
    return connection


class BridgeClient:
    def __init__(self, connection, directory, log=None, emit=None):
        self.connection = connection
        self.receiver = _receiving.Receiver(directory, self.connection.write)
        self.lines = _receiving.SerialLines()
        self.log = log
        self.emit = emit or (lambda event: print(json.dumps(event, ensure_ascii=False), flush=True))
        self.session = secrets.token_hex(8)
        self.sequence = 0
        self.replies = {}
        self.outcomes = {}
        self.capabilities = None
        self.active_transfer_id = None
        self.last_command = None

    def handle(self, event):
        if not isinstance(event, dict) or not isinstance(event.get('event'), str):
            raise BridgeError('Malformed device event')
        if self.log:
            self.log.write(json.dumps(event, ensure_ascii=True)+'\n')
            self.log.flush()
        kind = event['event']
        if kind == 'qualification_boot' and self.capabilities is not None:
            raise BridgeError('Device restarted during this serial session')
        if kind == 'command_invalid':
            if self.capabilities is None:
                return  # A newline at connection setup may finish an abandoned record.
            raise BridgeError('Device rejected command framing or CRC')
        if kind == 'command_reply':
            sequence = event.get('sequence')
            if not isinstance(sequence, int) or not 0 <= sequence <= self.sequence or not isinstance(event.get('ok'), bool):
                raise BridgeError('Unexpected command acknowledgement')
            if len(self.replies) >= 16:
                raise BridgeError('Unexpected acknowledgement backlog')
            self.replies[sequence] = event
        elif kind == 'outgoing_complete':
            if event.get('transfer_id') != self.active_transfer_id:
                raise BridgeError('Unexpected outgoing completion')
            self.outcomes[self.active_transfer_id] = event
            self.emit(event)
        elif kind == 'outgoing_peer':
            try:
                name = base64.b64decode(event['name_b64'], validate=True).decode('utf-8')
            except (KeyError, ValueError, UnicodeError) as error:
                raise BridgeError('Malformed peer name') from error
            self.emit(dict(event='peer_name', display_name=name, name_source='airdrop_discover'))
        elif kind in ('outgoing_stage', 'outgoing_progress'):
            self.emit(event)
        self.receiver.handle(event)

    def poll(self):
        raw = self.connection.read(max(1, min(self.connection.in_waiting, 4096)))
        for line in self.lines.feed(raw):
            try:
                event = json.loads(line.decode('utf-8'))
            except (ValueError, UnicodeError):
                continue  # SDK boot/driver lines share the diagnostic channel.
            self.handle(event)

    def request(self, verb, arguments='', timeout=5, hello=False):
        self.sequence += 1
        body = ('HELLO '+self.session) if hello else self.session+' '+verb+((' '+arguments) if arguments else '')
        frame = encode_command(self.sequence, body)
        if self.connection.write(frame) != len(frame):
            raise BridgeError('Incomplete serial command write; operation outcome is uncertain')
        self.last_command = frame
        deadline = time.monotonic()+timeout
        while time.monotonic() < deadline:
            self.poll()
            reply = self.replies.pop(self.sequence, None)
            if reply is not None:
                if not reply['ok']:
                    raise BridgeError('Device rejected '+verb+': '+str(reply.get('reason')))
                return reply
        raise BridgeError('Timed out waiting for '+verb+'; no automatic retransmission was made')

    def hello(self):
        if self.connection.write(b'\n') != 1:
            raise BridgeError('Unable to synchronize the serial record boundary')
        result = self.request('HELLO', hello=True)
        if result.get('protocol') != 2 or not isinstance(result.get('max_file'), int) or not 0 < result['max_file'] <= 16*1024*1024:
            raise BridgeError('Unsupported device capabilities')
        if not isinstance(result.get('chunk_bytes'), int) or not 0 < result['chunk_bytes'] <= 112 or not re.fullmatch(r'(?:[0-9a-f]{2}:){5}[0-9a-f]{2}', result.get('radio_mac', '')):
            raise BridgeError('Invalid chunk bound or radio identity')
        self.capabilities = result
        return result

    def stage_file(self, path, peer, port=8770, uti='public.data'):
        if self.capabilities is None:
            self.hello()
        if not re.fullmatch(r'(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}', peer) or not 1 <= port <= 65535:
            raise ValueError('Invalid recipient endpoint')
        path = Path(path)
        if not path.is_file() or path.stat().st_size > self.capabilities['max_file']:
            raise ValueError('Source is not a regular file within the device staging bound')
        with path.open('rb') as source:
            payload = source.read(self.capabilities['max_file']+1)
        if len(payload) > self.capabilities['max_file']:
            raise ValueError('Source grew beyond the staging bound')
        digest = hashlib.sha256(payload).hexdigest()
        identity, metadata = make_manifest(path.name, len(payload), self.capabilities['radio_mac'].replace(':', ''), uti)
        self.request('BEGIN', f'{len(payload)} {len(metadata)} {digest} {peer.lower()} {port}')
        chunk_size = self.capabilities['chunk_bytes']
        for verb, data in [('META', metadata), ('DATA', payload)]:
            for offset in range(0, len(data), chunk_size):
                chunk = data[offset:offset+chunk_size]
                encoded = base64.b64encode(chunk).decode('ascii')
                result = self.request(verb, f'{offset} {encoded}')
                if result.get('offset') != offset+len(chunk):
                    raise BridgeError('Device acknowledged the wrong staging offset')
                if verb == 'DATA' and (offset == 0 or offset+len(chunk) == len(data) or offset//16384 != (offset+len(chunk))//16384):
                    self.emit(dict(event='staging_progress', bytes=offset+len(chunk), total_bytes=len(data)))
        self.active_transfer_id = identity
        return dict(transfer_id=identity, bytes=len(payload), sha256=digest, name=path.name)

    def send_staged(self, expected, timeout=420):
        if expected['transfer_id'] != self.active_transfer_id:
            raise BridgeError('Staged transfer identity mismatch')
        self.request('SEND', timeout=10)
        deadline = time.monotonic()+timeout
        while time.monotonic() < deadline:
            result = self.outcomes.pop(self.active_transfer_id, None)
            if result is not None:
                if result.get('success') is not True or result.get('http_status') != 200:
                    raise BridgeError('Native send failed: '+json.dumps(result))
                if result.get('bytes') != expected['bytes'] or result.get('sha256') != expected['sha256']:
                    raise BridgeError('Native completion does not match the staged file')
                return result
            self.poll()
        self.request('CANCEL')
        raise BridgeError('Native send timed out and cancellation was requested')

    def close(self):
        self.receiver.close()

