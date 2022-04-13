import { StorageBase } from 'storage/storage-base';
import { IdGenerator } from 'util/generators/id-generator';
import { IoBrowserCache } from 'storage/io-browser-cache';
// import { Storage } from 'storage/index';

// eslint-disable-next-line import/no-commonjs
const BaseLocale = require('locales/base');

class StorageFSAccess extends StorageBase {
    name = 'fsaccess';
    icon = 'hdd';
    enabled = true;

    init() {
        super.init();
        this.io = new IoBrowserCacheEx({
            cacheName: 'FileHandles',
            logger: this.logger
        });
    }

    _getIdForHandle(fileHandle, callback) {
        this.io.list((err, list) => {
            if (err) {
                return callback?.(err);
            }
            const entry = list.find((x) => fileHandle.isSameEntry(x.value));
            const id = entry?.key ?? IdGenerator.uuid();
            if (entry) {
                this.logger.debug('Found cached file handle ID', id);
            } else {
                this.logger.debug('Generated new file handle ID', id);
            }
            return callback?.(null, id);
        });
    }

    load(path, opts, callback) {
        this.stat(path, opts, (err, stat) => {
            if (err) {
                return callback?.(err);
            }
            this.io.load(path, (err, fileHandle) => {
                if (err) {
                    return callback?.(err);
                }

                fileHandle.queryPermission({ mode: 'readwrite' }).then((state) => {
                    this.logger.debug('[load] File handler state', state, path);
                    fileHandle
                        .requestPermission({ mode: 'readwrite' })
                        .then(() => {
                            fileHandle
                                .getFile()
                                .then((file) => {
                                    file.arrayBuffer().then((buffer) => {
                                        return callback(null, buffer, stat);
                                    });
                                })
                                .catch((e) => {
                                    return callback?.(e);
                                });
                        })
                        .catch((e) => {
                            return callback?.(e);
                        });
                });

                /*
                fileHandle.getFile().then((file) => {
                    file.arrayBuffer().then((buffer) => {
                        return callback(null, buffer, stat);
                    });
                });
                */
            });
        });
    }

    // TODO: Determine why file system access permissions are forgotten randomly.
    stat(path, opts, callback) {
        this.io.load(path, (err, fileHandle) => {
            if (err) {
                return callback?.(err);
            }
            fileHandle.queryPermission({ mode: 'readwrite' }).then((state) => {
                this.logger.debug('[stat] File handler state', state, path);
                fileHandle
                    .requestPermission({ mode: 'readwrite' })
                    .then(() => {
                        fileHandle
                            .getFile()
                            .then((file) => {
                                return callback?.(null, { rev: file.lastModified });
                            })
                            .catch((e) => {
                                return callback?.(e);
                            });
                    })
                    .catch((e) => {
                        return callback?.(e);
                    });
            });
        });
    }

    save(path, opts, data, callback, rev) {
        this.stat(path, opts, (err, stat) => {
            if (rev) {
                if (err) {
                    return callback?.(err);
                }
                if (stat.rev !== rev) {
                    return callback?.({ revConflict: true }, stat);
                }
            }
            this.io.load(path, (err, fileHandle) => {
                if (err) {
                    return callback?.(err);
                }
                fileHandle.createWritable().then((stream) => {
                    stream.write(data).then(() => {
                        stream.close();
                        this.stat(path, opts, (err, stat) => {
                            if (err) {
                                callback?.(err);
                            }
                            this.io.save(path, fileHandle);
                            return callback?.(null, { rev: stat.rev, path });
                        });
                    });
                });
            });
        });
    }

    list(dir, callback) {
        window
            .showOpenFilePicker({
                types: [{ description: 'KDBX file', accept: { 'application/x-kdbx': ['.kdbx'] } }]
            })
            .then((value) => {
                const [fileHandle] = value;
                this._getIdForHandle(fileHandle, (err, path) => {
                    if (err) {
                        return callback?.(err);
                    }
                    this.io.save(path, fileHandle);
                    const fileList = [
                        {
                            name: fileHandle.name,
                            path
                        }
                    ];
                    return callback?.(null, fileList);
                });
            })
            .catch((e) => {
                return callback?.(e);
            });
    }

    // TODO: Have the file handle successfully removed from the IDB
    //       when the KDBX is closed in the app.
    remove(path, callback) {
        this.logger.debug('Remove', path);
        const ts = this.logger.ts();
        this.io.remove(path, (err) => {
            this.logger('Removed', path, this.logger.ts(ts));
            callback(err);
        });
    }

    setEnabled(enabled) {
        StorageBase.prototype.setEnabled.call(this, enabled);
    }
}

BaseLocale.fsaccess = 'FS Access';
// Storage.fsaccess = new StorageFSAccess();
export { StorageFSAccess };

class IoBrowserCacheEx extends IoBrowserCache {
    list(callback) {
        this.logger.debug('List');
        this.initDb((err) => {
            if (err) {
                return callback?.(err);
            }
            try {
                const ts = this.logger.ts();
                const list = [];
                const req = this.db
                    .transaction(['files'], 'readonly')
                    .objectStore('files')
                    .openCursor();
                req.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        list.push({ key: cursor.primaryKey, value: cursor.value });
                        cursor.continue();
                    } else {
                        this.logger.debug('Listed', list.length, 'records', this.logger.ts(ts));
                        callback?.(null, list);
                    }
                };
                req.onerror = (event) => {
                    this.logger.error('Error listing from cache', req.error);
                    callback?.(req.error);
                };
            } catch (e) {
                this.logger.error('Error listing from cache', e);
                if (callback) {
                    callback?.(e);
                }
            }
        });
    }
}
