(function(global) {
    const CLOUD_NAME = 'dqnzndovz';
    const UPLOAD_PRESET = 'dienchan_unsigned';
    const FOLDER = 'dienchan';

    function getConfig() {
        return {
            cloudName: CLOUD_NAME,
            uploadPreset: UPLOAD_PRESET,
            folder: FOLDER
        };
    }

    async function uploadFile(file, options = {}) {
        const config = getConfig();
        if (!config.cloudName || !config.uploadPreset) {
            throw new Error('Cloudinary chưa cấu hình. Mở file cloudinary.js và điền CLOUD_NAME, UPLOAD_PRESET.');
        }
        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', config.uploadPreset);
        if (options.folder || config.folder) {
            formData.append('folder', options.folder || config.folder);
        }
        if (options.public_id) {
            formData.append('public_id', options.public_id);
        }
        if (options.tags) {
            formData.append('tags', options.tags.join(','));
        }
        const transformations = [];
        if (options.transformation) {
            const transformation = Array.isArray(options.transformation)
                ? options.transformation.join('/')
                : options.transformation;
            transformations.push(transformation);
        }
        if (transformations.length) {
            formData.append('transformation', transformations.join('/'));
        }

        const url = `https://api.cloudinary.com/v1_1/${config.cloudName}/upload`;
        const response = await fetch(url, {
            method: 'POST',
            body: formData
        });
        const bodyText = await response.text();
        let bodyJson = null;
        try {
            bodyJson = JSON.parse(bodyText);
        } catch {
            bodyJson = null;
        }
        if (!response.ok) {
            const errMessage = bodyJson?.error?.message || bodyJson?.message || bodyText || `HTTP ${response.status}`;
            throw new Error(`Upload Cloudinary lỗi: ${response.status} - ${errMessage}`);
        }
        return bodyJson;
    }

    function makeUrl(publicId, options = {}) {
        if (!publicId) return '';
        const cloudName = getConfig().cloudName;
        const transformations = [];
        if (options.width) transformations.push(`w_${options.width}`);
        if (options.height) transformations.push(`h_${options.height}`);
        if (options.crop) transformations.push(`c_${options.crop}`);
        if (options.quality) transformations.push(`q_${options.quality}`);
        if (options.format) transformations.push(`f_${options.format}`);
        const transform = transformations.length ? transformations.join(',') + '/' : '';
        return `https://res.cloudinary.com/${cloudName}/image/upload/${transform}${publicId}`;
    }

    function getMetadataStore() {
        try {
            return JSON.parse(localStorage.getItem('dc_cloudinary_images') || '{}');
        } catch {
            return {};
        }
    }

    function saveMetadata(key, data) {
        const store = getMetadataStore();
        store[key] = data;
        localStorage.setItem('dc_cloudinary_images', JSON.stringify(store));
    }

    function getMetadata(key) {
        return getMetadataStore()[key] || null;
    }

    function removeMetadata(key) {
        const store = getMetadataStore();
        delete store[key];
        localStorage.setItem('dc_cloudinary_images', JSON.stringify(store));
    }

    function getImageUrlForKey(key, options = {}) {
        const meta = getMetadata(key);
        const defaultOptions = { format: 'auto', quality: 'auto' };
        const urlOptions = { ...defaultOptions, ...options };
        if (meta && meta.public_id) {
            return makeUrl(meta.public_id, urlOptions);
        }
        if (meta && meta.secure_url) {
            return meta.secure_url;
        }
        // Fallback: nếu key là ID đơn hoặc path public_id đầy đủ
        const publicId = key.includes('/') ? key : `dienchan/data/${key}`;
        return makeUrl(publicId, urlOptions);
    }

    global.DCcloudinary = {
        uploadFile,
        makeUrl,
        saveMetadata,
        getMetadata,
        removeMetadata,
        getImageUrlForKey,
        getConfig
    };
})(window);
