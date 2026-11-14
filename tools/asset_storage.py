#!/usr/bin/env python3
"""3D Lab's scoped, disk-first draft store. Python 3 standard library only."""
from __future__ import annotations
import argparse
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

PROTOCOL = 'capp.3d-lab.disk.v1'
MAX_BLOB = 0xffffffff  # GLB 2.0 uint32 byte length, not an editor budget.
MAX_CHUNK = 8 * 1024 * 1024
MAX_JSON = 136 * 1024 * 1024
HEX = re.compile(r'^[a-f0-9]{64}$')
IDENT = re.compile(r'^[a-zA-Z0-9_-]{1,100}$')
SETTINGS = {'action-prompts', 'workflows', 'shape-session', 'rig-shelf'}

class StoreError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status

def check(condition, message, status=400):
    if not condition:
        raise StoreError(message, status)

def file_sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''): h.update(block)
    return h.hexdigest()

def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')

def sha(data):
    return hashlib.sha256(data).hexdigest()

def atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name('.' + path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with tmp.open('xb') as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, path)
        # Flush directory entries on platforms which support it.
        if os.name != 'nt':
            fd = os.open(path.parent, os.O_RDONLY)
            try: os.fsync(fd)
            finally: os.close(fd)
    finally:
        tmp.unlink(missing_ok=True)

def sync_parent(path):
    if os.name != 'nt':
        fd = os.open(path.parent, os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)

def safe(root, relative):
    p = Path(relative)
    check(not p.is_absolute() and all(part not in ('.', '..') for part in str(relative).split('/')), 'Invalid asset-relative path.')
    current = root
    for part in p.parts:
        check(not re.search(r'[\\:\x00-\x1f]', part), 'Invalid asset path.')
        current = current / part
        check(not current.is_symlink() and not (getattr(current.stat(follow_symlinks=False), 'st_file_attributes', 0) & 0x400) if current.exists() else not current.is_symlink(), 'Asset links and junctions are not followed.')
    check(current.resolve().is_relative_to(root), 'Asset path escapes its folder.')
    return current

class DraftStore:
    def __init__(self, root):
        candidate = Path(root).expanduser()
        for part in [candidate, *candidate.parents]:
            check(not part.is_symlink() and not (getattr(part.stat(follow_symlinks=False), 'st_file_attributes', 0) & 0x400) if part.exists() else not part.is_symlink(), 'Asset roots cannot use links or junctions.')
        self.root = candidate.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        for name in ('drafts', '_blobs', '_history', '_service', 'settings', 'recovered'):
            p = safe(self.root, name)
            check(not p.is_symlink(), 'Storage subfolders must not be symbolic links.')
            p.mkdir(exist_ok=True)
        # One writer process per root, including different HTTP ports.
        self.lock_file = safe(self.root, '_service/writer.lock').open('a+b')
        self.lock_file.seek(0)
        self.lock_file.write(b'0')
        self.lock_file.flush()
        self.lock_file.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(self.lock_file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.lock_file.close()
            raise StoreError('This asset folder already has a storage service running. Use its connection link.', 409)
        self.lock = threading.RLock()
        self.index_path = safe(self.root, 'catalogue.json')
        check(not self.index_path.is_symlink(), 'The catalogue must not be a symbolic link.')
        if not self.index_path.exists():
            atomic(self.index_path, encoded({'format': PROTOCOL, 'assets': {}, 'imports': {}, 'deleted': {}}))
        self.index = json.loads(self.index_path.read_text('utf-8'))
        check(self.index.get('format') == PROTOCOL, 'The catalogue format is not supported. Originals have not been changed.')
        token_path = safe(self.root, '_service/connection-token.txt')
        if not token_path.exists():
            atomic(token_path, secrets.token_urlsafe(36).encode('ascii'))
            try: token_path.chmod(0o600)
            except OSError: pass
        self.token = token_path.read_text('ascii').strip()
        check(re.fullmatch(r'[A-Za-z0-9_-]{40,100}', self.token), 'The storage connection token is invalid.')

    def close(self):
        self.lock_file.close()

    def commit_index(self, value):
        old = self.index_path.read_bytes()
        atomic(safe(self.root, '_history/' + sha(old) + '.catalogue.json'), old)
        atomic(self.index_path, encoded(value))
        self.index = value

    def blob_path(self, key):
        check(isinstance(key, str) and HEX.fullmatch(key), 'Invalid content hash.')
        p = safe(self.root, '_blobs/' + key)
        check(not p.is_symlink(), 'A content file must not be a symbolic link.')
        return p

    def put_blob(self, key, data):
        p = self.blob_path(key)
        check(0 < len(data) <= MAX_BLOB and sha(data) == key, 'Content length or checksum does not match.')
        with self.lock:
            if p.exists():
                check(p.stat().st_size == len(data) and file_sha(p) == key, 'An existing content file is damaged; restore it before retrying.', 409)
            else:
                atomic(p, data)
        return {'sha256': key, 'size': len(data)}

    def put_chunk(self, key, total, offset, data):
        destination = self.blob_path(key)
        check(type(total) is int and 0 < total <= MAX_BLOB and type(offset) is int and 0 <= offset < total, 'Invalid chunk extent.')
        check(0 < len(data) <= MAX_CHUNK and offset + len(data) <= total, 'Invalid blob chunk.')
        partial = safe(self.root, '_service/blob-upload-' + key + '.part')
        with self.lock:
            if destination.exists():
                check(destination.stat().st_size == total and file_sha(destination) == key, 'Existing content is damaged.', 409)
                return {'received': total, 'complete': True}
            length = partial.stat().st_size if partial.exists() else 0
            check(length <= total and offset <= length, 'Retry chunks in order.', 409)
            if offset < length:
                with partial.open('rb') as stream:
                    stream.seek(offset); check(stream.read(len(data)) == data, 'Retry chunk differs from retained bytes.', 409)
            else:
                with partial.open('ab') as stream:
                    stream.write(data); stream.flush(); os.fsync(stream.fileno())
            length = partial.stat().st_size
            if length == total:
                if file_sha(partial) != key:
                    partial.unlink(); raise StoreError('Uploaded content checksum mismatch.', 409)
                os.replace(partial, destination); sync_parent(destination)
            return {'received': length, 'complete': length == total}

    def read_chunk(self, key, offset):
        path = self.blob_path(key)
        check(path.is_file() and type(offset) is int and 0 <= offset < path.stat().st_size <= MAX_BLOB, 'Invalid content chunk.', 404)
        with path.open('rb') as stream:
            stream.seek(offset); return stream.read(MAX_CHUNK)

    def checked_ref(self, value, limit=MAX_BLOB):
        check(isinstance(value, dict) and set(value) == {'$blob'}, 'Missing content descriptor.')
        ref = value['$blob']
        check(isinstance(ref, dict) and isinstance(ref.get('size'), int) and 0 < ref['size'] <= limit, 'Invalid content length.')
        p = self.blob_path(ref.get('sha256'))
        check(p.is_file() and p.stat().st_size == ref['size'] and file_sha(p) == ref['sha256'], 'Content is missing or has a different checksum. Retry saving.', 409)
        check(isinstance(ref.get('type'), str) and len(ref['type']) < 100, 'Invalid content type.')
        return p

    def validate(self, bundle):
        check(isinstance(bundle, dict) and set(bundle) == {'asset', 'files'}, 'Invalid draft bundle.')
        asset, files = bundle['asset'], bundle['files']
        check(isinstance(asset, dict) and isinstance(files, dict), 'Invalid draft record.')
        check(isinstance(asset.get('id'), str) and IDENT.fullmatch(asset['id']) and files.get('id') == asset['id'], 'Invalid draft identity.')
        check(isinstance(asset.get('title'), str) and 0 < len(asset['title']) <= 160, 'Invalid draft title.')
        check(isinstance(asset.get('revision'), int) and asset['revision'] >= 1, 'Invalid draft revision.')
        p = self.checked_ref(files.get('glb'))
        check(asset.get('sha256') == files['glb']['$blob']['sha256'] and asset.get('byteLength') == p.stat().st_size, 'Model metadata does not match the GLB.')
        with p.open('rb') as stream: header = stream.read(12)
        check(len(header) == 12 and header[:4] == b'glTF' and int.from_bytes(header[4:8], 'little') == 2 and int.from_bytes(header[8:12], 'little') == p.stat().st_size, 'Invalid GLB header.')
        check(asset.get('origin') in ('generation', 'import', 'edit', 'shape', 'action'), 'Invalid draft origin.')
        check((asset['origin'] == 'action') == (files.get('actionDocument') is not None), 'Action drafts need their editable action document.')
        check((asset['origin'] == 'shape') == (files.get('shapeDocument') is not None), 'Shape drafts need their editable shape document.')
        for name in ('image', 'thumbnail'):
            if files.get(name): self.checked_ref(files[name], 4 * 1024 * 1024 if name == 'image' else 1024 * 1024)
        views = files.get('views') or {}
        check(isinstance(views, dict) and set(views) <= {'left', 'right', 'back'}, 'Invalid reference views.')
        for view in views.values(): self.checked_ref(view.get('blob'), 4 * 1024 * 1024)

    def read(self, id):
        check(isinstance(id, str) and IDENT.fullmatch(id), 'Invalid draft identity.')
        item = self.index['assets'].get(id)
        check(item, 'This draft is not in the disk catalogue.', 404)
        path = safe(self.root, 'drafts/' + id + '/' + item['fingerprint'] + '/record.json')
        bundle = json.loads(path.read_text('utf-8'))
        check(sha(encoded(bundle)) == item['fingerprint'], 'Draft record checksum mismatch. Restore a retained revision before editing.', 409)
        return {'bundle': bundle, 'fingerprint': item['fingerprint'], 'path': str(path.parent), 'modelPath': str(path.parent / 'model.glb')}

    def list(self):
        return {'assets': [dict(v['asset'], fingerprint=v['fingerprint'], diskPath=str(self.root / 'drafts' / k / v['fingerprint'])) for k, v in self.index['assets'].items()], 'deleted': list(self.index['deleted'])}

    def preview(self, id):
        files = self.read(id)['bundle']['files']
        ref = files.get('thumbnail') or files.get('image')
        if not ref: return b'', 'image/png'
        path = self.checked_ref(ref, 4 * 1024 * 1024)
        return path.read_bytes(), ref['$blob']['type']

    def materialize(self, bundle, fingerprint):
        asset, files = bundle['asset'], bundle['files']
        folder = safe(self.root, 'drafts/' + asset['id'] + '/' + fingerprint)
        check(folder.resolve().is_relative_to(self.root) and not folder.parent.is_symlink() and not folder.is_symlink(), 'Draft paths must stay inside the asset folder.')
        folder.mkdir(parents=True, exist_ok=True)
        def copy(ref, name):
            if not ref: return
            source = self.checked_ref(ref)
            target = safe(self.root, str((folder / name).relative_to(self.root)))
            temporary = safe(self.root, str((folder / (name + '.' + uuid.uuid4().hex + '.tmp')).relative_to(self.root)))
            try:
                shutil.copyfile(source, temporary)
                check(file_sha(temporary) == ref['$blob']['sha256'], 'Copied content checksum mismatch.', 500)
                with temporary.open('r+b') as stream: stream.flush(); os.fsync(stream.fileno())
                os.replace(temporary, target); sync_parent(target)
            finally: temporary.unlink(missing_ok=True)
        def extension(ref):
            return {'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp'}.get(ref['$blob']['type'], '.bin')
        copy(files['glb'], 'model.glb')
        for name, dest in [('image', 'reference'), ('thumbnail', 'thumbnail')]:
            if files.get(name): copy(files[name], dest + extension(files[name]))
        for name, view in (files.get('views') or {}).items(): copy(view['blob'], 'reference-' + name + extension(view['blob']))
        for key, name in [('actionDocument', 'action.json'), ('shapeDocument', 'shape.json')]:
            if files.get(key) is not None: atomic(folder / name, encoded(files[key]))
        atomic(folder / 'asset.json', encoded(asset))
        atomic(folder / 'record.json', encoded(bundle))
        # Read-back of every materialized original before its catalogue pointer changes.
        check(file_sha(folder / 'model.glb') == asset['sha256'], 'The written GLB did not verify.', 500)
        for name, path in [('image', 'reference'), ('thumbnail', 'thumbnail')]:
            if files.get(name): check(sha((folder / (path + extension(files[name]))).read_bytes()) == files[name]['$blob']['sha256'], 'Reference checksum mismatch.', 500)
        for name, view in (files.get('views') or {}).items(): check(sha((folder / ('reference-' + name + extension(view['blob']))).read_bytes()) == view['blob']['$blob']['sha256'], 'View checksum mismatch.', 500)
        check(sha((folder / 'record.json').read_bytes()) == fingerprint, 'Written record did not verify.', 500)

    def save(self, request):
        bundle = request.get('bundle')
        self.validate(bundle)
        with self.lock:
            original = sha(encoded(bundle))
            source_id = bundle['asset']['id']
            import_key = source_id + ':' + original
            migration = request.get('migrate') is True
            if migration and source_id in self.index['deleted']:
                return {'deleted': True}
            if import_key in self.index['imports'] and (migration or request.get('expected') is None):
                mapped = self.index['imports'][import_key]
                if mapped in self.index['deleted']: return {'deleted': True}
                return dict(self.read(mapped), unchanged=True)
            id = source_id
            current = self.index['assets'].get(id)
            if current and current['fingerprint'] == original:
                return dict(self.read(id), unchanged=True)
            if current and migration:
                # Conflicting legacy copies become separate, deterministic recoveries.
                id = str(uuid.uuid5(uuid.NAMESPACE_URL, import_key))
                bundle = json.loads(json.dumps(bundle))
                bundle['asset']['id'] = bundle['files']['id'] = id
                bundle['asset']['title'] = (bundle['asset']['title'][:135] + ' (browser recovery)')
                current = self.index['assets'].get(id)
            else:
                check((current or {}).get('fingerprint') == request.get('expected'), 'This draft changed in another window. Refresh before saving.', 409)
                check(id not in self.index['deleted'], 'This draft was deleted. Save a new draft instead.', 409)
            if not migration:
                used = {v['asset']['title'].strip().casefold() for k, v in self.index['assets'].items() if k != id and v['asset'].get('folder', '').strip().casefold() == bundle['asset'].get('folder', '').strip().casefold()}
                title = bundle['asset']['title']
                if current:
                    check(title.strip().casefold() not in used, 'That name already exists in this folder.', 409)
                else:
                    number = 2
                    while bundle['asset']['title'].strip().casefold() in used:
                        suffix = f' ({number})'
                        bundle['asset']['title'] = title[:160-len(suffix)] + suffix
                        number += 1
            fingerprint = sha(encoded(bundle))
            self.materialize(bundle, fingerprint)
            new = json.loads(json.dumps(self.index))
            new['assets'][id] = {'asset': bundle['asset'], 'fingerprint': fingerprint}
            if migration or request.get('expected') is None: new['imports'][import_key] = id
            self.commit_index(new)
            return dict(self.read(id), recovered=id != source_id)

    def remove(self, id, revision):
        with self.lock:
            row = self.index['assets'].get(id)
            check(row and row['asset']['revision'] == revision, 'This draft changed. Refresh before deleting it.', 409)
            new = json.loads(json.dumps(self.index))
            new['deleted'][id] = new['assets'].pop(id)
            self.commit_index(new)
            return {'removed': id, 'retainedOnDisk': True}

    def setting(self, name):
        check(name in SETTINGS, 'Unknown authoring collection.')
        path = safe(self.root, 'settings/' + name + '.json')
        if not path.exists(): return {'value': None, 'fingerprint': None}
        data = path.read_bytes()
        return {'value': json.loads(data), 'fingerprint': sha(data)}

    def save_setting(self, name, request):
        check(name in SETTINGS, 'Unknown authoring collection.')
        value = request.get('value')
        data = encoded(value)
        limit = {'action-prompts': 256 * 1024, 'workflows': 6 * 1024 * 1024, 'shape-session': 2 * 1024 * 1024, 'rig-shelf': 128 * 1024 * 1024}[name]
        check(len(data) <= limit, 'This authoring collection is too large.')
        with self.lock:
            current = self.setting(name)
            fingerprint = sha(data)
            if current['fingerprint'] == fingerprint: return current
            if request.get('migrate') and current['fingerprint'] is not None:
                recovery = safe(self.root, 'recovered/' + name + '-' + fingerprint + '.json')
                atomic(recovery, data)
                return dict(current, recovered=str(recovery))
            check(current['fingerprint'] == request.get('expected'), 'This authoring collection changed in another window. Reconnect to recover both versions.', 409)
            path = safe(self.root, 'settings/' + name + '.json')
            if path.exists(): atomic(safe(self.root, '_history/' + name + '-' + current['fingerprint'] + '.json'), path.read_bytes())
            atomic(path, data)
            check(path.read_bytes() == data, 'The settings file did not verify.', 500)
            return {'value': value, 'fingerprint': fingerprint}

class Server(ThreadingHTTPServer):
    daemon_threads = True
    def __init__(self, address, store, app_root, public_origin=None):
        self.store, self.app_root = store, app_root
        self.public_origin = validate_public_origin(public_origin)
        super().__init__(address, Handler)

class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *_): pass  # Never log tokens or saved content.
    def send_headers(self, status, length, mime='application/json'):
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(length))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.end_headers()
    def reply(self, data, status=200):
        raw = encoded(data)
        self.send_headers(status, len(raw))
        self.wfile.write(raw)
    def body(self, limit):
        check(not self.headers.get('Transfer-Encoding'), 'Chunked requests are not supported.')
        length = int(self.headers.get('Content-Length', '-1'))
        check(0 <= length <= limit, 'Request is too large or lacks a length.', 413)
        self.connection.settimeout(60)
        data = self.rfile.read(length)
        check(len(data) == length, 'Incomplete request.')
        return data
    def do_OPTIONS(self):
        self.headers_response(204)
    def headers_response(self, status):
        self.send_headers( status, 0)
    def dispatch(self):
        try:
            hosts = {'127.0.0.1:' + str(self.server.server_port)}
            if self.server.public_origin: hosts.add(urlparse(self.server.public_origin).netloc)
            check(self.headers.get('Host') in hosts, 'Unconfigured storage host.', 403)
            route = urlparse(self.path).path
            if self.command == 'GET' and route == '/':
                data = (self.server.app_root / 'index.html').read_bytes()
                self.send_headers( 200, len(data), 'text/html; charset=utf-8')
                self.wfile.write(data)
                return
            check(hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + self.server.store.token), 'Use the private connection link printed by Start-3D-Asset-Storage.cmd.', 401)
            store = self.server.store
            if route == '/v1/status' and self.command == 'GET':
                return self.reply({'protocol': PROTOCOL, 'root': str(store.root), 'count': len(store.index['assets']), 'role': 'model'})
            if route == '/v1/assets' and self.command == 'GET': return self.reply(store.list())
            if route == '/v1/assets' and self.command == 'POST': return self.reply(store.save(json.loads(self.body(MAX_JSON))))
            m = re.fullmatch(r'/v1/assets/([A-Za-z0-9_-]{1,100})', route)
            if m and self.command == 'GET': return self.reply(store.read(m[1]))
            if m and self.command == 'DELETE': return self.reply(store.remove(m[1], json.loads(self.body(1024)).get('revision')))
            m = re.fullmatch(r'/v1/blobs/([a-f0-9]{64})', route)
            if m and self.command == 'PUT': return self.reply(store.put_blob(m[1], self.body(MAX_BLOB)))
            if m and self.command == 'GET':
                p = store.blob_path(m[1])
                check(p.is_file(), 'Content is missing.', 404)
                data = p.read_bytes()
                check(sha(data) == m[1], 'Stored content checksum mismatch.', 409)
                self.send_headers( 200, len(data), 'application/octet-stream')
                self.wfile.write(data)
                return
            m = re.fullmatch(r'/v1/settings/([a-z-]+)', route)
            if m and self.command == 'GET': return self.reply(store.setting(m[1]))
            if m and self.command == 'PUT': return self.reply(store.save_setting(m[1], json.loads(self.body(MAX_JSON))))
            raise StoreError('Unknown storage operation.', 404)
        except (BrokenPipeError, ConnectionResetError): pass
        except StoreError as e: self.reply({'error': str(e)}, e.status)
        except (ValueError, TypeError, KeyError) as e: self.reply({'error': 'Invalid storage request: ' + str(e)}, 400)
        except OSError as e: self.reply({'error': 'Disk operation failed. Existing revisions are retained. ' + str(e)}, 507)
    do_GET = do_POST = do_PUT = do_DELETE = dispatch

def validate_public_origin(value):
    if not value: return None
    u = urlparse(value)
    check(u.scheme == 'https' and u.hostname and not u.username and not u.password and u.path in ('', '/') and not u.query and not u.fragment, 'Public origin must be an HTTPS origin without a path.')
    return 'https://' + u.netloc

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path.home() / 'cApp' / 'assets' / '3d')
    parser.add_argument('--port', type=int, default=43193)
    parser.add_argument('--app-root', type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument('--public-origin', help='Explicit HTTPS reverse-proxy origin; listener stays loopback.')
    args = parser.parse_args()
    store = DraftStore(args.root)
    try:
        server = Server(('127.0.0.1', args.port), store, args.app_root.resolve(), args.public_origin)
        origin = validate_public_origin(args.public_origin) or f'http://127.0.0.1:{server.server_port}'
        link = origin + '/#storage=' + store.token
        print('\n3D Lab permanent draft storage\nFolder: ' + str(store.root), flush=True)
        print('\nPrivate connection link:\n' + link, flush=True)
        print('\nIn your EXISTING installed 3D Lab: Asset storage -> paste link -> Connect & migrate.\nKeep this window running. Browser copies are retained as cache.\nCtrl+C stops the service; saved files remain on disk.\n', flush=True)
        server.serve_forever()
    except KeyboardInterrupt: pass
    finally: store.close()

if __name__ == '__main__':
    try: main()
    except (StoreError, OSError, ValueError) as error:
        raise SystemExit('Asset storage could not start: ' + str(error))
