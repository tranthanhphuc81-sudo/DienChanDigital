#!/usr/bin/env node
const https = require('https');
const admin = require('firebase-admin');

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;
const CLOUDINARY_FOLDER = process.env.CLOUDINARY_FOLDER || 'dienchan';
const FIRESTORE_COLLECTION = process.env.FIRESTORE_COLLECTION || 'acupoints';

function assertEnv(name, value) {
  if (!value) {
    console.error(`Missing environment variable: ${name}`);
    process.exit(1);
  }
}

function requestCloudinary(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const authToken = Buffer.from(`${CLOUDINARY_API_KEY}:${CLOUDINARY_API_SECRET}`).toString('base64');
    const options = {
      hostname: 'api.cloudinary.com',
      path: `/v1_1/${encodeURIComponent(CLOUDINARY_CLOUD_NAME)}/resources/search`,
      method: 'POST',
      headers: {
        Authorization: `Basic ${authToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, res => {
      let result = '';
      res.setEncoding('utf8');
      res.on('data', chunk => result += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(result);
          if (res.statusCode >= 400) {
            reject(new Error(json.error?.message || result));
            return;
          }
          resolve(json);
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function fetchCloudinaryResources(folder) {
  let cursor = undefined;
  const resources = [];
  const expression = `folder:${folder} AND resource_type:image`;

  do {
    const payload = { expression, max_results: 500 };
    if (cursor) payload.next_cursor = cursor;

    const response = await requestCloudinary(payload);
    if (!Array.isArray(response.resources)) {
      throw new Error('Không nhận được resources từ Cloudinary');
    }
    resources.push(...response.resources);
    cursor = response.next_cursor;
  } while (cursor);

  return resources;
}

function matrixPublicIdToHuyetId(publicId) {
  const lastSegment = publicId.split('/').pop();
  const match = lastSegment.match(/^(\d+)$/);
  return match ? match[1] : null;
}

function normalizeImageIds(imageIds) {
  if (!Array.isArray(imageIds)) return [];
  return Array.from(new Set(imageIds.map(id => String(id).trim()).filter(Boolean)));
}

function upsertAcupointData(id, publicId) {
  const now = new Date().toISOString();
  const doc = {
    code: String(id),
    name: String(id),
    alias: '',
    category: '',
    location: '',
    functions: '',
    manual: '',
    imageIds: [publicId],
    tags: ['cloudinary-sync'],
    createdBy: 'cloudinary-sync',
    meta: { cloudinaryPublicId: publicId, syncedAt: now },
    createdAt: now,
    updatedAt: now
  };
  return doc;
}

async function initFirestore() {
  if (admin.apps.length === 0) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  return admin.firestore();
}

async function sync() {
  assertEnv('CLOUDINARY_CLOUD_NAME', CLOUDINARY_CLOUD_NAME);
  assertEnv('CLOUDINARY_API_KEY', CLOUDINARY_API_KEY);
  assertEnv('CLOUDINARY_API_SECRET', CLOUDINARY_API_SECRET);

  console.log(`Cloudinary folder: ${CLOUDINARY_FOLDER}`);
  const firestore = await initFirestore();
  const collection = firestore.collection(FIRESTORE_COLLECTION);

  const resources = await fetchCloudinaryResources(CLOUDINARY_FOLDER);
  console.log(`Tìm thấy ${resources.length} ảnh Cloudinary.`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const resource of resources) {
    const publicId = resource.public_id;
    const id = matrixPublicIdToHuyetId(publicId);
    if (!id) {
      skipped += 1;
      console.warn(`Bỏ qua ảnh không phải ID huyệt: ${publicId}`);
      continue;
    }

    const docRef = collection.doc(String(id));
    const snap = await docRef.get();
    if (!snap.exists) {
      await docRef.set(upsertAcupointData(id, publicId));
      created += 1;
      continue;
    }

    const existing = snap.data() || {};
    const imageIds = normalizeImageIds(existing.imageIds || []);
    if (!imageIds.includes(publicId)) {
      imageIds.unshift(publicId);
      await docRef.set({
        ...existing,
        imageIds,
        updatedAt: new Date().toISOString(),
        meta: { ...existing.meta, cloudinarySync: true }
      }, { merge: true });
      updated += 1;
    } else {
      skipped += 1;
    }
  }

  console.log(`Sync complete. created=${created}, updated=${updated}, skipped=${skipped}`);
}

sync().catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});
