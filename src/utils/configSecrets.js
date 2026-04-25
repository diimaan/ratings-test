const crypto = require('crypto');
const logger = require('./logger');

const ENCRYPTION_PREFIX = 'enc:v1';
const SECRET_PROVIDERS = ['tmdb', 'mdblist', 'publicmetadb'];

function getEncryptionSecret() {
    return process.env.CONFIG_ENCRYPTION_SECRET || '';
}

function deriveKey(secret) {
    return crypto
        .createHash('sha256')
        .update(String(secret))
        .digest();
}

function isEncryptedValue(value) {
    return typeof value === 'string' && value.startsWith(`${ENCRYPTION_PREFIX}:`);
}

function encryptValue(value) {
    if (!value || isEncryptedValue(value)) return value || '';

    const secret = getEncryptionSecret();
    if (!secret) {
        logger.warn('[Config Secrets] CONFIG_ENCRYPTION_SECRET is not set. Provider keys will be stored in plaintext.');
        return value;
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(secret), iv);
    const encrypted = Buffer.concat([
        cipher.update(String(value), 'utf8'),
        cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return [
        ENCRYPTION_PREFIX,
        iv.toString('base64url'),
        tag.toString('base64url'),
        encrypted.toString('base64url'),
    ].join(':');
}

function decryptValue(value) {
    if (!isEncryptedValue(value)) return value || '';

    const secret = getEncryptionSecret();
    if (!secret) {
        throw new Error('CONFIG_ENCRYPTION_SECRET is required to decrypt stored provider keys.');
    }

    const [, , ivRaw, tagRaw, encryptedRaw] = String(value).split(':');
    if (!ivRaw || !tagRaw || !encryptedRaw) {
        throw new Error('Stored provider key has an invalid encrypted format.');
    }

    const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        deriveKey(secret),
        Buffer.from(ivRaw, 'base64url')
    );
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));

    return Buffer.concat([
        decipher.update(Buffer.from(encryptedRaw, 'base64url')),
        decipher.final(),
    ]).toString('utf8');
}

function cloneConfig(userConfig) {
    return JSON.parse(JSON.stringify(userConfig));
}

function encryptUserConfigSecrets(userConfig) {
    const copy = cloneConfig(userConfig);

    for (const provider of SECRET_PROVIDERS) {
        if (copy.providers?.[provider]?.apiKey) {
            copy.providers[provider].apiKey = encryptValue(copy.providers[provider].apiKey);
        }
    }

    return copy;
}

function decryptUserConfigSecrets(userConfig) {
    const copy = cloneConfig(userConfig);

    for (const provider of SECRET_PROVIDERS) {
        if (copy.providers?.[provider]?.apiKey) {
            copy.providers[provider].apiKey = decryptValue(copy.providers[provider].apiKey);
        }
    }

    return copy;
}

module.exports = {
    decryptUserConfigSecrets,
    encryptUserConfigSecrets,
    isEncryptedValue,
};
