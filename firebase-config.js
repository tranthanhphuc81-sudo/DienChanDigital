(function(global) {
    const FIREBASE_CONFIG = {
        apiKey: "AIzaSyAbNSuFH6zgbHShKyUbK0TN5fo0VbzN_28",
  authDomain: "dienchandigital.firebaseapp.com",
  projectId: "dienchandigital",
  storageBucket: "dienchandigital.firebasestorage.app",
  messagingSenderId: "507632594325",
  appId: "1:507632594325:web:f578c3d93d5b00ea73da9c",
  measurementId: "G-BW66E3R2B7"
    };

    let app = null;
    let auth = null;
    let db = null;

    function slugify(text) {
        return String(text || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9-_]+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
    }

    function getStatusElement() {
        return document.getElementById('firebase-auth-status');
    }

    function updateStatus(message, isError = false) {
        const statusEl = getStatusElement();
        if (!statusEl) return;
        statusEl.textContent = message;
        statusEl.className = isError ? 'text-sm text-red-600 mt-3' : 'text-sm text-slate-500 mt-3';
    }

    function initFirebase(config = FIREBASE_CONFIG) {
        if (app) return { app, auth, db };
        if (!window.firebase || !window.firebase.initializeApp) {
            throw new Error('Firebase SDK chưa được tải. Kiểm tra lại thẻ <script> trong HTML.');
        }
        app = firebase.initializeApp(config);
        auth = firebase.auth();
        db = firebase.firestore();

        if (auth.setPersistence && firebase.auth.Auth && firebase.auth.Auth.Persistence) {
            auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
                .catch(err => console.warn('Không thể lưu phiên Firebase Auth:', err));
        }

        auth.onAuthStateChanged(user => {
            if (user) {
                updateStatus(`Firebase đã đăng nhập: ${user.email}`);
            } else {
                updateStatus('Chưa đăng nhập Firebase.');
            }
        });

        return { app, auth, db };
    }

    async function signUpWithFirebase(email, password) {
        const { auth: firebaseAuth } = initFirebase();
        const userCredential = await firebaseAuth.createUserWithEmailAndPassword(email, password);
        return userCredential.user;
    }

    async function signInWithFirebase(email, password) {
        const { auth: firebaseAuth } = initFirebase();
        const userCredential = await firebaseAuth.signInWithEmailAndPassword(email, password);
        return userCredential.user;
    }

    async function signOutFirebase() {
        const { auth: firebaseAuth } = initFirebase();
        await firebaseAuth.signOut();
        updateStatus('Đã đăng xuất Firebase.');
    }

    function getFirebaseUser() {
        if (!auth) return null;
        return auth.currentUser;
    }

    async function ensureFirestore() {
        if (!app || !auth || !db) {
            initFirebase();
        }
        return { auth, db };
    }

    async function saveDocument(collection, id, data) {
        if (!id) throw new Error('Thiếu id khi lưu tài liệu Firestore.');
        const { db: firestore } = await ensureFirestore();
        const now = new Date().toISOString();
        const payload = {
            ...data,
            updatedAt: now,
            createdAt: data.createdAt || now
        };
        await firestore.collection(collection).doc(String(id)).set(payload, { merge: true });
        return { id: String(id), ...payload };
    }

    async function getDocument(collection, id) {
        const { db: firestore } = await ensureFirestore();
        const snap = await firestore.collection(collection).doc(String(id)).get();
        return snap.exists ? { id: snap.id, ...snap.data() } : null;
    }

    async function createAcupointsFromCloudinaryIds(ids) {
        const uniqueIds = Array.from(new Set((Array.isArray(ids) ? ids : String(ids).split(/[\s,;]+/)).map(id => String(id).trim()).filter(Boolean)));
        const result = { created: 0, skipped: 0, errors: [] };
        for (const id of uniqueIds) {
            try {
                const existing = await getDocument('acupoints', id);
                if (existing) {
                    result.skipped += 1;
                    continue;
                }
                await saveAcupoint({
                    id,
                    name: id,
                    location: '',
                    functions: '',
                    manual: '',
                    imageIds: [id],
                    tags: ['cloudinary-fallback']
                });
                result.created += 1;
            } catch (err) {
                result.errors.push({ id, message: err.message || String(err) });
            }
        }
        return result;
    }

    async function listDocuments(collection, queryOptions = {}) {
        const { db: firestore } = await ensureFirestore();
        let q = firestore.collection(collection);
        if (queryOptions.where) {
            const [field, op, value] = queryOptions.where;
            q = q.where(field, op, value);
        }
        if (queryOptions.orderBy) {
            q = q.orderBy(queryOptions.orderBy.field, queryOptions.orderBy.direction || 'desc');
        }
        const snapshot = await q.get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    async function deleteDocument(collection, id) {
        const { db: firestore } = await ensureFirestore();
        await firestore.collection(collection).doc(String(id)).delete();
        return true;
    }

    async function saveAcupoint(data) {
        const id = data.id || data.code;
        if (!id) throw new Error('Huyệt cần có id hoặc code.');
        return saveDocument('acupoints', String(id), {
            code: String(id),
            name: data.name || data.alias || '',
            alias: data.alias || '',
            category: data.category || '',
            location: data.location || data.pos || '',
            functions: data.functions || data.effect || '',
            manual: data.manual || '',
            imageIds: Array.isArray(data.imageIds) ? data.imageIds : (data.imageIds ? [data.imageIds] : []),
            tags: Array.isArray(data.tags) ? data.tags : [],
            createdBy: data.createdBy || getFirebaseUser()?.uid || null,
            meta: data.meta || {}
        });
    }

    async function saveAcupointGroup(data) {
        const id = data.id || slugify(data.title || data.name || `group-${Date.now()}`);
        return saveDocument('acupointGroups', id, {
            title: data.title || data.name || '',
            description: data.description || '',
            acupointIds: Array.isArray(data.acupointIds) ? data.acupointIds : [],
            imageIds: Array.isArray(data.imageIds) ? data.imageIds : (data.imageIds ? [data.imageIds] : []),
            tags: Array.isArray(data.tags) ? data.tags : [],
            notes: data.notes || data.note || '',
            createdBy: data.createdBy || getFirebaseUser()?.uid || null,
            meta: data.meta || {}
        });
    }

    async function saveTreatmentPlan(data) {
        const id = data.id || slugify(data.title || `plan-${Date.now()}`);
        return saveDocument('treatmentPlans', id, {
            title: data.title || '',
            description: data.description || '',
            acupointIds: Array.isArray(data.acupointIds) ? data.acupointIds : [],
            groupIds: Array.isArray(data.groupIds) ? data.groupIds : [],
            steps: Array.isArray(data.steps) ? data.steps : [],
            keywords: Array.isArray(data.keywords) ? data.keywords : [],
            imageIds: Array.isArray(data.imageIds) ? data.imageIds : (data.imageIds ? [data.imageIds] : []),
            createdBy: data.createdBy || getFirebaseUser()?.uid || null,
            meta: data.meta || {}
        });
    }

    async function saveMedicalRecord(data) {
        const user = getFirebaseUser();
        if (!user) throw new Error('Vui lòng đăng nhập Firebase trước khi lưu hồ sơ bệnh án.');
        const id = data.id || slugify(`${data.patientName || 'patient'}-${Date.now()}`);
        return saveDocument('medicalRecords', id, {
            patientName: data.patientName || data.name || '',
            patientUid: data.patientUid || null,
            symptoms: data.symptoms || data.disease || '',
            diagnosis: data.diagnosis || '',
            protocol: data.protocol || '',
            notes: data.notes || data.note || '',
            attachments: Array.isArray(data.attachments) ? data.attachments : [],
            createdBy: data.createdBy || user.uid,
            patientType: data.patientType || '',
            meta: data.meta || {}
        });
    }

    async function listMedicalRecordsForCurrentUser() {
        const user = getFirebaseUser();
        if (!user) throw new Error('Vui lòng đăng nhập Firebase để đọc hồ sơ bệnh án.');
        return listDocuments('medicalRecords', {
            where: ['createdBy', '==', user.uid],
            orderBy: { field: 'updatedAt', direction: 'desc' }
        });
    }

    function _parseJsonLocal(key, defaultValue) {
        try {
            return JSON.parse(localStorage.getItem(key) || JSON.stringify(defaultValue));
        } catch {
            return defaultValue;
        }
    }

    function getLegacyLocalData() {
        return {
            customHuyet: _parseJsonLocal('dc_custom_huyet', []),
            customProtocols: _parseJsonLocal('dc_custom_protocols', []),
            customSets: _parseJsonLocal('dc_custom_sets', []),
            medicalRecords: _parseJsonLocal('dc_records', []),
            images: _parseJsonLocal('dc_images', {})
        };
    }

    async function migrateLegacyDataToFirebase() {
        initFirebase();
        updateStatus('Đang chuyển dữ liệu cũ sang Firebase...');
        const user = getFirebaseUser();
        if (!user) throw new Error('Vui lòng đăng nhập Firebase trước khi chuyển dữ liệu cũ.');
        const legacy = getLegacyLocalData();
        const result = { acupoints: 0, protocols: 0, groups: 0, records: 0, errors: [] };

        const normalizePoints = points => {
            if (!points) return [];
            if (Array.isArray(points)) return points.map(String);
            if (typeof points === 'string') {
                return points.split(/[,;|\s]+/).map(p => p.trim()).filter(Boolean);
            }
            return [];
        };

        for (const item of legacy.customHuyet) {
            try {
                await saveAcupoint({
                    id: item.id || item.code || item.name,
                    name: item.name || `Huyệt ${item.id || item.code || ''}`,
                    location: item.pos || item.location,
                    functions: item.effect || item.functions,
                    manual: item.manual || '',
                    tags: ['custom', 'legacy'],
                    createdBy: user.uid,
                    meta: { legacySource: 'dc_custom_huyet' }
                });
                result.acupoints += 1;
            } catch (err) {
                result.errors.push({ type: 'acupoint', item, message: err.message });
            }
        }

        for (const item of legacy.customProtocols) {
            try {
                await saveTreatmentPlan({
                    title: item.name || item.title || 'Phác đồ cũ',
                    description: item.note || item.description || '',
                    acupointIds: normalizePoints(item.points || item.acupointIds),
                    keywords: Array.isArray(item.keywords) ? item.keywords : normalizePoints(item.keywords),
                    imageIds: Array.isArray(item.imageIds) ? item.imageIds : (item.imageIds ? [item.imageIds] : []),
                    createdBy: user.uid,
                    meta: { legacySource: 'dc_custom_protocols' }
                });
                result.protocols += 1;
            } catch (err) {
                result.errors.push({ type: 'protocol', item, message: err.message });
            }
        }

        for (const item of legacy.customSets) {
            try {
                await saveAcupointGroup({
                    title: item.title || item.name || 'Bộ huyệt cũ',
                    description: item.description || '',
                    acupointIds: normalizePoints(item.points || item.acupointIds),
                    imageIds: item.imageKey ? [item.imageKey] : [],
                    tags: ['custom', 'legacy'],
                    notes: item.note || '',
                    createdBy: user.uid,
                    meta: { legacySource: 'dc_custom_sets' }
                });
                result.groups += 1;
            } catch (err) {
                result.errors.push({ type: 'group', item, message: err.message });
            }
        }

        for (const item of legacy.medicalRecords) {
            try {
                await saveMedicalRecord({
                    id: item.id || item.recordId || `legacy-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                    patientName: item.name || item.patientName || 'Bệnh nhân cũ',
                    symptoms: item.disease || item.symptoms || '',
                    protocol: item.protocol || '',
                    notes: item.note || item.notes || '',
                    attachments: Array.isArray(item.attachments) ? item.attachments : [],
                    createdBy: user.uid,
                    meta: { legacySource: 'dc_records' }
                });
                result.records += 1;
            } catch (err) {
                result.errors.push({ type: 'record', item, message: err.message });
            }
        }

        updateStatus(`Chuyển xong dữ liệu: ${result.acupoints} huyệt, ${result.protocols} phác đồ, ${result.groups} bộ huyệt, ${result.records} hồ sơ.`);
        return result;
    }

    async function firebaseSignInHandler() {
        const emailInput = document.getElementById('firebase-email');
        const passwordInput = document.getElementById('firebase-password');
        if (!emailInput || !passwordInput) return;
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        if (!email || !password) {
            updateStatus('Vui lòng nhập email và mật khẩu Firebase.', true);
            return;
        }
        try {
            initFirebase();
            await signInWithFirebase(email, password);
            updateStatus(`Đăng nhập Firebase thành công: ${email}`);
        } catch (err) {
            updateStatus(`Đăng nhập Firebase thất bại: ${err.message || err}`, true);
            console.error('firebaseSignInHandler', err);
        }
    }

    async function firebaseSignUpHandler() {
        const emailInput = document.getElementById('firebase-email');
        const passwordInput = document.getElementById('firebase-password');
        if (!emailInput || !passwordInput) return;
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        if (!email || !password) {
            updateStatus('Vui lòng nhập email và mật khẩu Firebase.', true);
            return;
        }
        try {
            initFirebase();
            await signUpWithFirebase(email, password);
            updateStatus(`Tạo tài khoản Firebase thành công: ${email}`);
        } catch (err) {
            updateStatus(`Đăng ký Firebase thất bại: ${err.message || err}`, true);
            console.error('firebaseSignUpHandler', err);
        }
    }

    async function firebaseSignOutHandler() {
        try {
            initFirebase();
            await signOutFirebase();
        } catch (err) {
            updateStatus(`Đăng xuất Firebase thất bại: ${err.message || err}`, true);
            console.error('firebaseSignOutHandler', err);
        }
    }

    global.firebaseSignInHandler = firebaseSignInHandler;
    global.firebaseSignUpHandler = firebaseSignUpHandler;
    global.firebaseSignOutHandler = firebaseSignOutHandler;

    global.DCFirebase = {
        initFirebase,
        signUpWithFirebase,
        signInWithFirebase,
        signOutFirebase,
        firebaseSignInHandler,
        firebaseSignUpHandler,
        firebaseSignOutHandler,
        getFirebaseUser,
        saveAcupoint,
        saveAcupointGroup,
        saveTreatmentPlan,
        saveMedicalRecord,
        getLegacyLocalData,
        migrateLegacyDataToFirebase,
        createAcupointsFromCloudinaryIds,
        listDocuments,
        getDocument,
        deleteDocument,
        listMedicalRecordsForCurrentUser
    };
})(window);
