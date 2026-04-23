(function(global) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    function toBase64(buffer) {
        return btoa(String.fromCharCode(...new Uint8Array(buffer)));
    }

    function fromBase64(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    async function deriveKey(password, salt, iterations = 200_000) {
        const passwordKey = await crypto.subtle.importKey(
            'raw',
            encoder.encode(password),
            { name: 'PBKDF2' },
            false,
            ['deriveKey']
        );

        return crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt instanceof Uint8Array ? salt : encoder.encode(salt),
                iterations,
                hash: 'SHA-256'
            },
            passwordKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    async function encryptJSON(key, payload) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const plain = typeof payload === 'string' ? payload : JSON.stringify(payload);
        const cipherBuffer = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            encoder.encode(plain)
        );

        return {
            version: 1,
            iv: toBase64(iv),
            ciphertext: toBase64(cipherBuffer)
        };
    }

    async function decryptJSON(key, data) {
        const iv = new Uint8Array(fromBase64(data.iv));
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            fromBase64(data.ciphertext)
        );
        const text = decoder.decode(decrypted);
        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    }

    async function hashPassword(password) {
        const digest = await crypto.subtle.digest('SHA-256', encoder.encode(password));
        return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function randomBytes(length) {
        return crypto.getRandomValues(new Uint8Array(length));
    }

    function toHex(buffer) {
        return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function fromHex(hex) {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
        }
        return bytes.buffer;
    }

    global.DCCrypto = {
        deriveKey,
        encryptJSON,
        decryptJSON,
        hashPassword,
        randomBytes,
        toBase64,
        fromBase64,
        toHex,
        fromHex
    };
})(window);
