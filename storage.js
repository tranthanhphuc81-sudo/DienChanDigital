(function(global) {
    const DB_NAME = 'dc_secure_storage';
    const DB_VERSION = 1;
    const USER_STORE = 'users';
    const RECORD_STORE = 'records';

    async function openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = event => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(USER_STORE)) {
                    db.createObjectStore(USER_STORE, { keyPath: 'username' });
                }
                if (!db.objectStoreNames.contains(RECORD_STORE)) {
                    const store = db.createObjectStore(RECORD_STORE, { keyPath: 'id' });
                    store.createIndex('user', 'username', { unique: false });
                }
            };
            request.onsuccess = event => resolve(event.target.result);
            request.onerror = event => reject(event.target.error);
        });
    }

    async function getTransaction(storeName, mode = 'readonly') {
        const db = await openDB();
        return db.transaction(storeName, mode).objectStore(storeName);
    }

    async function getUser(username) {
        const store = await getTransaction(USER_STORE, 'readonly');
        return new Promise(resolve => {
            const req = store.get(username);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    }

    async function putUser(user) {
        const store = await getTransaction(USER_STORE, 'readwrite');
        return new Promise((resolve, reject) => {
            const req = store.put(user);
            req.onsuccess = () => resolve(true);
            req.onerror = () => reject(req.error);
        });
    }

    async function putRecord(record) {
        const store = await getTransaction(RECORD_STORE, 'readwrite');
        return new Promise((resolve, reject) => {
            const req = store.put(record);
            req.onsuccess = () => resolve(record);
            req.onerror = () => reject(req.error);
        });
    }

    async function deleteRecordById(id) {
        const store = await getTransaction(RECORD_STORE, 'readwrite');
        return new Promise((resolve, reject) => {
            const req = store.delete(id);
            req.onsuccess = () => resolve(true);
            req.onerror = () => reject(req.error);
        });
    }

    async function getRecordsForUser(username) {
        const store = await getTransaction(RECORD_STORE, 'readonly');
        return new Promise((resolve, reject) => {
            const req = store.index('user').getAll(IDBKeyRange.only(username));
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    async function createUser(username, password) {
        if (!username || !password) throw new Error('Username và password yêu cầu');
        if (await getUser(username)) throw new Error('Username đã tồn tại');

        const salt = DCCrypto.randomBytes(16);
        const passwordHash = await DCCrypto.hashPassword(password);
        const derivedKey = await DCCrypto.deriveKey(password, salt);
        const masterKeyRaw = DCCrypto.randomBytes(32);
        const masterKey = await crypto.subtle.importKey('raw', masterKeyRaw, 'AES-GCM', true, ['encrypt','decrypt']);
        const encryptedKey = await DCCrypto.encryptJSON(masterKey, DCCrypto.toBase64(masterKeyRaw));

        const user = {
            username,
            passwordHash,
            salt: DCCrypto.toBase64(salt),
            encryptedKey,
            createdAt: new Date().toISOString()
        };
        await putUser(user);
        return user;
    }

    async function loginUser(username, password) {
        const user = await getUser(username);
        if (!user) throw new Error('Người dùng không tồn tại');
        const passwordHash = await DCCrypto.hashPassword(password);
        if (user.passwordHash !== passwordHash) throw new Error('Sai mật khẩu');

        const salt = DCCrypto.fromBase64(user.salt);
        const derivedKey = await DCCrypto.deriveKey(password, salt);
        const masterKeyRaw = await DCCrypto.decryptJSON(derivedKey, user.encryptedKey);
        const masterKey = await crypto.subtle.importKey(
            'raw',
            DCCrypto.fromBase64(masterKeyRaw),
            'AES-GCM',
            true,
            ['encrypt','decrypt']
        );

        global.dcCurrentUser = {
            username,
            masterKey
        };
        global.localStorage.setItem('dc_active_user', username);
        return global.dcCurrentUser;
    }

    async function logoutUser() {
        delete global.dcCurrentUser;
        localStorage.removeItem('dc_active_user');
    }

    async function saveRecord(record) {
        if (!global.dcCurrentUser || !global.dcCurrentUser.masterKey) throw new Error('Chưa mở khóa user');
        const data = await DCCrypto.encryptJSON(global.dcCurrentUser.masterKey, record);
        const stored = {
            id: record.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            username: global.dcCurrentUser.username,
            updatedAt: new Date().toISOString(),
            encryptedPayload: data
        };
        return putRecord(stored);
    }

    async function loadRecords() {
        if (!global.dcCurrentUser || !global.dcCurrentUser.masterKey) throw new Error('Chưa mở khóa user');
        const rows = await getRecordsForUser(global.dcCurrentUser.username);
        const records = [];
        for (const row of rows) {
            try {
                const payload = await DCCrypto.decryptJSON(global.dcCurrentUser.masterKey, row.encryptedPayload);
                records.push({ id: row.id, ...payload, updatedAt: row.updatedAt });
            } catch (err) {
                console.warn('Không giải mã được record', row.id, err);
            }
        }
        return records.sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    }

    async function deleteRecord(recordId) {
        return deleteRecordById(recordId);
    }

    async function exportBackup() {
        if (!global.dcCurrentUser) throw new Error('Chưa mở khóa user');
        const user = await getUser(global.dcCurrentUser.username);
        const records = await getRecordsForUser(global.dcCurrentUser.username);
        return {
            version: 1,
            exportedAt: new Date().toISOString(),
            user: {
                username: user.username,
                salt: user.salt,
                encryptedKey: user.encryptedKey,
                createdAt: user.createdAt
            },
            records
        };
    }

    async function importBackup(backup) {
        if (!backup || !backup.user || !backup.records) throw new Error('File backup không hợp lệ');
        if (!global.dcCurrentUser || global.dcCurrentUser.username !== backup.user.username) {
            throw new Error('Vui lòng mở khóa đúng user trước khi import backup');
        }
        const existingUser = await getUser(backup.user.username);
        if (!existingUser) {
            await putUser(backup.user);
        }
        for (const rec of backup.records) {
            await putRecord(rec);
        }
        return true;
    }

    global.DCEncryptedStorage = {
        createUser,
        loginUser,
        logoutUser,
        saveRecord,
        loadRecords,
        deleteRecord,
        exportBackup,
        importBackup
    };
})(window);
