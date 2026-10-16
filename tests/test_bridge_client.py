# Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import plistlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('bridge_client', Path(__file__).resolve().parents[1]/'scripts/bridge_client.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class Connection:
    def __init__(self, fragment=19):
        self.buffer = bytearray()
        self.writes = []
        self.fragment = fragment
        self.partial = False
        self.respond = True
        self.wrong_offset = False

    @property
    def in_waiting(self):
        return len(self.buffer)

    def read(self, count):
        size = min(count, self.fragment)
        result = bytes(self.buffer[:size])
        del self.buffer[:size]
        return result

    def write(self, frame):
        self.writes.append(frame)
        if self.partial:
            return len(frame)-1
        if self.respond and frame.startswith(b'AB2 '):
            fields = frame.decode('ascii').split()
            offset = 0
            if fields[3] in ('DATA', 'META'):
                offset = int(fields[4])+len(base64.b64decode(fields[5]))+(1 if self.wrong_offset else 0)
            reply = dict(event='command_reply', sequence=int(fields[1]), ok=True,
                         protocol=2, radio_mac='02:01:02:03:04:05', max_file=1048576,
                         chunk_bytes=112, offset=offset)
            self.buffer.extend(json.dumps(reply).encode()+b'\n')
        return len(frame)


class BridgeContract(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.connection = Connection()
        self.client = bridge.BridgeClient(self.connection, Path(self.temp.name)/'received', emit=lambda event: None)

    def tearDown(self):
        self.client.close()
        self.temp.cleanup()

    def test_literal_crc_and_line_bound(self):
        self.assertEqual(bridge.encode_command(17, 'HELLO'), b'AB2 17 HELLO *414b814b\n')
        for body in ['', 'x'*193, 'x\ny', 'x*y', '測試']:
            with self.assertRaises((ValueError, UnicodeError)):
                bridge.encode_command(1, body)
        with self.assertRaises(ValueError):
            bridge.encode_command(2**32, 'HELLO')

    def test_fragmented_ack_preserves_session(self):
        result = self.client.hello()
        self.assertEqual(result['protocol'], 2)
        self.assertIn(self.client.session.encode(), self.connection.writes[-1])
        self.assertEqual(self.client.request('STATUS')['sequence'], 2)

    def test_partial_write_never_retries_mutation(self):
        self.connection.partial = True
        with self.assertRaises(bridge.BridgeError):
            self.client.hello()
        self.assertEqual(len(self.connection.writes), 1)

    def test_timeout_never_retries_mutation(self):
        self.connection.respond = False
        with self.assertRaises(bridge.BridgeError):
            self.client.request('BEGIN', timeout=0)
        self.assertEqual(len(self.connection.writes), 1)

    def test_native_manifest_unicode_and_consistent_id(self):
        identity, raw = bridge.make_manifest('測試 & data.bin', 262145, '020102030405')
        manifest = plistlib.loads(raw)
        self.assertEqual(manifest['TransferID']['id'], identity)
        self.assertEqual(manifest['TransferType'], {'files': {}})
        self.assertEqual(manifest['Files'][0]['FileBomPath'], './測試 & data.bin')
        self.assertEqual(manifest['Files'][0]['FileSize'], 262145)
        self.assertFalse(manifest['Files'][0]['FileIsDirectory'])
        for filename in ['../secret', 'CON', 'bad:name', 'bad.']:
            with self.assertRaises(ValueError):
                bridge.make_manifest(filename, 3, '020102030405')

    def test_staging_payload_hash_and_physical_bounds(self):
        payload = bytes(range(256))*2+b'last'
        source = Path(self.temp.name)/'源.bin'
        source.write_bytes(payload)
        expected = self.client.stage_file(source, '02:11:22:33:44:55')
        chunks = []
        for frame in self.connection.writes:
            self.assertLessEqual(len(frame), 224)
            if not frame.startswith(b'AB2 '):
                continue
            fields = frame.decode('ascii').split()
            if fields[3] == 'DATA':
                chunks.append(base64.b64decode(fields[5]))
        self.assertEqual(b''.join(chunks), payload)
        self.assertEqual(expected['sha256'], hashlib.sha256(payload).hexdigest())
        self.assertFalse(any(b' SEND ' in frame for frame in self.connection.writes))

    def test_bad_offset_does_not_begin_native_send(self):
        self.connection.wrong_offset = True
        source = Path(self.temp.name)/'source.bin'
        source.write_bytes(b'abc')
        with self.assertRaises(bridge.BridgeError):
            self.client.stage_file(source, '02:11:22:33:44:55')
        self.assertIsNone(self.client.active_transfer_id)
        self.assertFalse(any(b' SEND ' in frame for frame in self.connection.writes))

    def test_restart_and_old_completion_fail_closed(self):
        self.client.hello()
        with self.assertRaises(bridge.BridgeError):
            self.client.handle(dict(event='qualification_boot'))
        with self.assertRaises(bridge.BridgeError):
            self.client.handle(dict(event='outgoing_complete', transfer_id='old'))
        with self.assertRaises(bridge.BridgeError):
            self.client.handle(dict(event='command_reply', sequence=999, ok=True))


if __name__ == '__main__':
    unittest.main()
