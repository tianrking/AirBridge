import base64
import importlib.util
from pathlib import Path
import struct
import tempfile
import time
import unittest
import zlib
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('round_display_diagnostics',ROOT/'scripts/round-display.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class FakeLink(module.RoundLink):
    def __init__(self, events): self.events=iter(events);self.commands=[]
    def send(self, command): self.commands.append(command)
    def event(self, deadline):
        if time.monotonic()>deadline: raise TimeoutError()
        return next(self.events)


class FrameCapture(unittest.TestCase):
    def test_frame_encoding_retains_rgb565_byte_order_and_valid_png_checksums(self):
        pixels=bytearray(259200)
        pixels[:6]=bytes.fromhex('f80007e0001f')
        encoded=module.rgb565_png(pixels)
        self.assertEqual(encoded[:8],b'\x89PNG\r\n\x1a\n')
        at=8;image=b''
        while at<len(encoded):
            length=struct.unpack('>I',encoded[at:at+4])[0]
            kind=encoded[at+4:at+8];body=encoded[at+8:at+8+length]
            checksum=struct.unpack('>I',encoded[at+8+length:at+12+length])[0]
            self.assertEqual(zlib.crc32(kind+body),checksum)
            if kind==b'IDAT':image+=body
            at+=12+length
        raw=zlib.decompress(image)
        self.assertEqual(raw[:10],bytes.fromhex('00ff000000ff000000ff'))
        self.assertEqual(len(raw),360*(360*3+1))
        with self.assertRaises(ValueError): module.rgb565_png(pixels[:-2])

    def test_missing_conflicting_or_incomplete_chunks_never_create_a_success_image(self):
        begin={'event':'round_frame_begin','id':1,'width':360,'height':360,'format':'rgb565be','bytes':259200}
        chunk={'event':'round_frame_chunk','id':1,'offset':0,'data':base64.b64encode(b'ab').decode()}
        wrong=dict(chunk,offset=2)
        missing={'event':'round_frame_end','id':1,'complete':True,'bytes':259200}
        for events in ([begin,wrong],[begin,chunk,chunk],[begin,chunk,missing],[dict(begin,width=400)]):
            with tempfile.TemporaryDirectory() as temporary:
                target=Path(temporary)/'frame.png'
                with self.assertRaises(RuntimeError):FakeLink(events).screenshot(target)
                self.assertFalse(target.exists())

    def test_exact_complete_capture_is_saved_after_all_bytes_and_final_confirmation(self):
        payload=bytes(259200)
        events=[{'event':'round_frame_begin','id':42,'width':360,'height':360,'format':'rgb565be','bytes':259200}]
        for offset in range(0,len(payload),384):
            events.append({'event':'round_frame_chunk','id':42,'offset':offset,'data':base64.b64encode(payload[offset:offset+384]).decode()})
        events.append({'event':'round_frame_end','id':42,'complete':True,'bytes':len(payload)})
        with tempfile.TemporaryDirectory() as temporary:
            target=Path(temporary)/'frame.png';link=FakeLink(events)
            result=link.screenshot(target)
            self.assertTrue(target.exists());self.assertEqual(result['rgb565_bytes'],259200)
            self.assertIn('not a photograph',result['source']);self.assertEqual(link.commands,['ROUND SCREEN'])
