"""Failure gates use isolated temporary roots; never a user's actual asset folder."""
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('asset_storage', Path(__file__).resolve().parents[1] / 'tools' / 'asset_storage.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class AtomicStorageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = module.DraftStore(self.tmp.name)
        data = b'glTF' + struct.pack('<II', 2, 12)
        key = module.sha(data)
        self.store.put_blob(key, data)
        self.bundle = {'asset': {'id': 'fixture', 'title': 'Fixture', 'revision': 1, 'origin': 'import', 'sha256': key, 'byteLength': 12}, 'files': {'id': 'fixture', 'glb': {'$blob': {'sha256': key, 'size': 12, 'type': 'model/gltf-binary'}}, 'image': None, 'thumbnail': None, 'views': {}, 'actionDocument': None, 'shapeDocument': None}}
        self.saved = self.store.save({'bundle': self.bundle})
    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()
    def test_failed_catalogue_replace_preserves_previous_revision(self):
        before = self.store.index_path.read_bytes()
        self.bundle['asset']['title'] = 'Failed edit'
        self.bundle['asset']['revision'] = 2
        original = module.atomic
        def fail(path, data):
            if path == self.store.index_path: raise OSError('simulated disk full at commit')
            return original(path, data)
        with patch.object(module, 'atomic', fail):
            with self.assertRaises(OSError): self.store.save({'bundle': self.bundle, 'expected': self.saved['fingerprint']})
        self.assertEqual(self.store.index_path.read_bytes(), before)
        self.assertEqual(self.store.read('fixture')['bundle']['asset']['title'], 'Fixture')
        self.store.close()
        self.store = module.DraftStore(self.tmp.name)
        self.assertEqual(self.store.read('fixture')['bundle']['asset']['title'], 'Fixture')
        self.store.save({'bundle': self.bundle, 'expected': self.saved['fingerprint']})
        self.assertEqual(self.store.read('fixture')['bundle']['asset']['title'], 'Failed edit')
    def test_failed_content_write_never_publishes(self):
        self.bundle['asset']['id'] = self.bundle['files']['id'] = 'new-fixture'
        before = self.store.index_path.read_bytes()
        with patch.object(module, 'atomic', side_effect=OSError('simulated write failure')):
            with self.assertRaises(OSError): self.store.save({'bundle': self.bundle})
        self.assertEqual(self.store.index_path.read_bytes(), before)
    def test_failed_settings_write_keeps_previous_prompts(self):
        old = self.store.save_setting('action-prompts', {'value': {'name': 'kept'}, 'expected': None})
        with patch.object(module, 'atomic', side_effect=OSError('disk full')):
            with self.assertRaises(OSError): self.store.save_setting('action-prompts', {'value': {'name': 'lost'}, 'expected': old['fingerprint']})
        self.assertEqual(self.store.setting('action-prompts')['value'], {'name': 'kept'})
    def test_second_writer_is_blocked(self):
        with self.assertRaisesRegex(module.StoreError, 'already has a storage service'): module.DraftStore(self.tmp.name)
    def test_traversal_and_unrecognised_settings_are_rejected(self):
        for value in ('../outside', 'C:\\outside', 'a' * 63):
            with self.assertRaises(module.StoreError): self.store.blob_path(value)
        with self.assertRaises(module.StoreError): self.store.save_setting('../outside', {'value': 1})

if __name__ == '__main__': unittest.main()
