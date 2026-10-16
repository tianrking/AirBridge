# Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
import base64
import contextlib
import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('native_receiver', Path(__file__).resolve().parents[1]/'scripts/receive-native.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ReceiveContract(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.acks = []
        def ack(command):
            if command.startswith(b'COMMIT '):
                self.assertTrue(any(p.is_dir() and not p.name.endswith('.partial') for p in Path(self.temp.name).iterdir()))
            self.acks.append(command)
            return len(command)
        self.receiver = module.Receiver(self.temp.name, ack)
        self.output = contextlib.redirect_stdout(io.StringIO())
        self.output.__enter__()
    def tearDown(self):
        self.receiver.close()
        self.output.__exit__(None, None, None)
        self.temp.cleanup()
    def begin(self, size=3, name='file.bin'):
        self.receiver.handle(dict(event='transfer_begin', transfer_id='test-id', files=1, total_bytes=size))
        self.receiver.handle(dict(event='manifest_file', index=0, name_b64=base64.b64encode(name.encode()).decode(), size=size))
        self.receiver.handle(dict(event='file_begin', index=0, name_b64=base64.b64encode(name.encode()).decode(), size=size))
    def finish_file(self, payload):
        for offset in range(0, len(payload), 512):
            self.receiver.handle(dict(event='file_chunk', index=0, offset=offset, data=base64.b64encode(payload[offset:offset+512]).decode()))
        self.receiver.handle(dict(event='file_end', index=0, bytes=len(payload), sha256=hashlib.sha256(payload).hexdigest()))
    def ready(self):
        files = self.receiver.job['files']
        self.receiver.handle(dict(event='transfer_ready', transfer_id='test-id', nonce='a'*32, files=len(files), total_bytes=sum(f['size'] for f in files.values())))
    def test_exact_binary_is_durable_before_ack(self):
        payload=bytes(range(256))*257+b'\0'
        self.begin(len(payload), '测试.bin')
        self.finish_file(payload)
        self.assertTrue(self.acks and all(c.startswith(b'CHUNK ') for c in self.acks))
        self.ready()
        self.assertEqual(self.acks[-1], b'COMMIT '+b'a'*32+b'\n')
        self.receiver.handle(dict(event='transfer_complete', transfer_id='test-id', host_committed=True, response_written=True))
        receipt=self.receiver.receipts[0]
        self.assertEqual((Path(receipt['directory'])/'测试.bin').read_bytes(), payload)
        self.assertEqual(receipt['files'][0]['sha256'], hashlib.sha256(payload).hexdigest())
    def test_out_of_order_data_never_acknowledged(self):
        self.begin()
        with self.assertRaises(ValueError):
            self.receiver.handle(dict(event='file_chunk', index=0, offset=1, data='YWJj'))
        self.assertFalse(any(c.startswith(b'COMMIT ') for c in self.acks))
    def test_incomplete_file_never_committed(self):
        self.begin()
        with self.assertRaises(ValueError): self.ready()
        self.assertFalse(any(c.startswith(b'COMMIT ') for c in self.acks))
    def test_digest_mismatch_never_committed(self):
        self.begin()
        self.receiver.handle(dict(event='file_chunk', index=0, offset=0, data='YWJj'))
        with self.assertRaises(ValueError):
            self.receiver.handle(dict(event='file_end', index=0, bytes=3, sha256='0'*64))
        self.assertFalse(any(c.startswith(b'COMMIT ') for c in self.acks))
    def test_zero_length_file(self):
        self.begin(0)
        self.finish_file(b'')
        self.ready()
        self.assertTrue(self.acks)
    def test_appledouble_is_preserved_and_verified(self):
        self.begin()
        self.finish_file(b'abc')
        self.receiver.handle(dict(event='file_begin', index=16, name_b64=base64.b64encode(b'._file.bin').decode(), size=4, metadata=True))
        self.receiver.handle(dict(event='file_chunk', index=16, offset=0, data=base64.b64encode(b'meta').decode()))
        self.receiver.handle(dict(event='file_end', index=16, bytes=4, sha256=hashlib.sha256(b'meta').hexdigest()))
        self.ready()
        self.assertEqual((self.receiver.job['published']/'._file.bin').read_bytes(), b'meta')
    def test_payload_cannot_be_overwritten_by_receipt(self):
        self.begin(3, '.airbridge-receipt.json')
        self.finish_file(b'abc')
        self.ready()
        self.receiver.handle(dict(event='transfer_complete', transfer_id='test-id', host_committed=True, response_written=True))
        self.assertEqual((self.receiver.job['published']/'.airbridge-receipt.json').read_bytes(), b'abc')
    def test_failed_device_completion_is_not_success(self):
        self.begin()
        self.finish_file(b'abc')
        self.ready()
        with self.assertRaises(ValueError):
            self.receiver.handle(dict(event='transfer_complete', transfer_id='test-id', host_committed=False))
        self.assertFalse(self.receiver.receipts)
    def test_unsafe_windows_names(self):
        for name in ('../outside', 'C:drive', 'NUL.txt', 'com1', 'bad.', 'bad ', 'a\\b'):
            self.assertFalse(module.safe_name(name))
    def test_wrong_transfer_nonce_context(self):
        self.begin()
        self.finish_file(b'abc')
        with self.assertRaises(ValueError):
            self.receiver.handle(dict(event='transfer_ready', transfer_id='other', nonce='a'*32))
        self.assertFalse(any(c.startswith(b'COMMIT ') for c in self.acks))
    def test_partial_chunk_ack_cannot_publish(self):
        self.begin()
        self.receiver.acknowledge = lambda command: len(command)-1
        with self.assertRaises(OSError): self.finish_file(b'abc')
        self.assertFalse(self.receiver.job.get('published'))

if __name__ == '__main__': unittest.main()
