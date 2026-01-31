// worker.js
const SECRET_SEED = "mission-critical-key";

async function getEncryptionKey() {
    const enc = new TextEncoder();
    const keyMaterial = await self.crypto.subtle.importKey(
        "raw", enc.encode(SECRET_SEED), { name: "PBKDF2" }, false, ["deriveKey"]
    );
    return self.crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: enc.encode("unique-agent-salt"),
            iterations: 100000,
            hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

self.onmessage = async (e) => {
    const { type, payload } = e.data;
    const key = await getEncryptionKey();

    if (type === 'encrypt') {
        const dataStr = JSON.stringify(payload);
        const iv = self.crypto.getRandomValues(new Uint8Array(12));
        const encryptedData = await self.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            key,
            new TextEncoder().encode(dataStr)
        );

        // Progress simulation for UI feel
        for (let i = 0; i <= 100; i += 20) {
            self.postMessage({ type: 'progress', value: i });
            const start = Date.now(); while (Date.now() - start < 50); // Small block for visibility
        }

        self.postMessage({ type: 'encrypt_complete', result: { encryptedData, iv } });
    }

    if (type === 'decrypt') {
        try {
            const decryptedBuffer = await self.crypto.subtle.decrypt(
                { name: "AES-GCM", iv: payload.iv },
                key,
                payload.encryptedData
            );
            
            for (let i = 0; i <= 100; i += 20) {
                self.postMessage({ type: 'progress', value: i });
                const start = Date.now(); while (Date.now() - start < 50);
            }

            const decryptedStr = new TextDecoder().decode(decryptedBuffer);
            self.postMessage({ type: 'decrypt_complete', result: JSON.parse(decryptedStr) });
        } catch (err) {
            self.postMessage({ type: 'error', msg: "Decryption failed" });
        }
    }
};