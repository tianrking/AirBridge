"""Fail-closed round board programming and profile policy checks; no ports opened."""
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
import yaml
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('round_flasher',ROOT/'scripts/flash-round.py')
flash=importlib.util.module_from_spec(spec);spec.loader.exec_module(flash)

class RoundFlashPolicy(unittest.TestCase):
    def test_hardware_selection_never_falls_back_to_another_port_or_missing_identity(self):
        valid=SimpleNamespace(device='COM4',vid=0x303a,pid=0x1001,serial_number='F0:9E:9E:1E:61:3C')
        with patch.object(flash.list_ports,'comports',return_value=[valid]):
            flash.authorize('COM4',valid.serial_number)
            with self.assertRaises(ValueError):flash.authorize('COM3',valid.serial_number)
            with self.assertRaises(ValueError):flash.authorize('COM4','00:00:00:00:00:00')
        for serial in (None,'different'):
            with patch.object(flash.list_ports,'comports',return_value=[SimpleNamespace(device='COM4',vid=0x303a,pid=0x1001,serial_number=serial)]):
                with self.assertRaises(ValueError):flash.authorize('COM4',valid.serial_number)

    def test_standard_private_or_nvs_overlapping_build_is_rejected_before_programming(self):
        with tempfile.TemporaryDirectory() as directory:
            build=Path(directory)
            flags=('AIRBRIDGE_ROUND_DISPLAY','AIRBRIDGE_PUBLIC_BUILD','AIRBRIDGE_NATIVE_SERVICE','AIRBRIDGE_PRESENCE_TX','AIRBRIDGE_IPV6_LINK')
            cache=''.join(flag+':BOOL=ON\n' for flag in flags)+'AIRBRIDGE_PROBE_PEER:STRING=\n'
            (build/'project_description.json').write_text(json.dumps({'target':'esp32s3','git_revision':'v6.1'}))
            (build/'CMakeCache.txt').write_text(cache)
            (build/'sdkconfig').write_text('CONFIG_ESPTOOLPY_FLASHSIZE_16MB=y\nCONFIG_SPIRAM_MODE_OCT=y\nCONFIG_LV_COLOR_16_SWAP=y\n')
            layout={'0x0':'bootloader/bootloader.bin','0x8000':'partition_table/partition-table.bin','0x10000':'airbridge_native.bin'}
            (build/'flasher_args.json').write_text(json.dumps({'flash_files':layout,'flash_settings':{'flash_mode':'dio','flash_size':'16MB','flash_freq':'80m'}}))
            for name in layout.values():
                target=build/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(b'\xe9'*32)
            self.assertEqual(flash.inspect_build(build),layout)
            for invalid in (cache.replace('AIRBRIDGE_ROUND_DISPLAY:BOOL=ON','AIRBRIDGE_ROUND_DISPLAY:BOOL=OFF'),cache.replace('AIRBRIDGE_PROBE_PEER:STRING=\n','AIRBRIDGE_PROBE_PEER:STRING=00:11:22:33:44:55\n')):
                (build/'CMakeCache.txt').write_text(invalid)
                with self.assertRaises(ValueError):flash.inspect_build(build)
            (build/'CMakeCache.txt').write_text(cache)
            (build/'bootloader/bootloader.bin').write_bytes(bytes(0x8001))
            with self.assertRaises(ValueError):flash.inspect_build(build)
            (build/'bootloader/bootloader.bin').write_bytes(b'\xe9'*32)
            (build/'partition_table/partition-table.bin').write_bytes(bytes(4097))
            with self.assertRaises(ValueError):flash.inspect_build(build)

    def test_round_artifact_is_gated_by_policy_tests_and_cannot_deploy_pages(self):
        workflow=yaml.load((ROOT/'.github/workflows/round-display.yml').read_text(),Loader=yaml.BaseLoader)
        self.assertEqual(workflow['permissions'],{'contents':'read'})
        self.assertEqual(workflow['jobs']['round']['needs'],'policies')
        runs='\n'.join(step.get('run','') for step in workflow['jobs']['policies']['steps'])
        self.assertIn('unittest discover',runs);self.assertIn('ctest ',runs)
        serialized=json.dumps(workflow)
        self.assertNotIn('deploy-pages',serialized);self.assertNotIn('continue-on-error',serialized)
        self.assertIn('espressif/idf:v6.1@sha256:',serialized)
