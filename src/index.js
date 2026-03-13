import { optimizeImage } from 'wasm-image-optimization';

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const bucket = env[env.R2_BINDING || 'blob'];

        // Security: Domain Lockdown (Allow localhost for dev)
        const host = request.headers.get('Host')?.split(':')[0]; // Remove port if present
        const isLocal = host && host.includes('localhost');

        // Debug logging for production troubleshooting
        if (env.ALLOWED_DOMAIN) {
            const allowedDomains = env.ALLOWED_DOMAIN.split(',').map(d => d.trim());
            const isAllowed = allowedDomains.includes(host);
            console.log(`[Domain Check] Host: "${host}", Allowed: "${env.ALLOWED_DOMAIN}", Match: ${isAllowed}`);

            if (!isLocal && !isAllowed) {
                return new Response(`Access denied: Unauthorized domain. (Host: ${host})`, { status: 403 });
            }
        }

        if (request.method === 'GET') {
            const key = url.pathname.slice(1);
            if (!key) return new Response('No file specified', { status: 400 });

            // Security: Signature Verification (For Private Access)
            const sig = url.searchParams.get('sig');
            const exp = url.searchParams.get('exp');

            if (!sig || !exp) {
                return new Response('Unauthorized: Missing signature or expiry', { status: 401 });
            }

            // Check Expiry
            if (Date.now() > parseInt(exp)) {
                return new Response('Unauthorized: Link has expired', { status: 401 });
            }

            // Verify HMAC Signature (Shared secret with Next.js)
            const signingSecret = env.SIGNING_SECRET || 'dev-secret';
            const dataToVerify = `${key}:${exp}`;
            const encoder = new TextEncoder();
            const keyData = encoder.encode(signingSecret);
            const cryptoKey = await crypto.subtle.importKey(
                'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
            );

            const sigBuffer = hexToBuffer(sig);
            const isValid = await crypto.subtle.verify(
                'HMAC', cryptoKey, sigBuffer, encoder.encode(dataToVerify)
            );

            if (!isValid) {
                return new Response('Unauthorized: Invalid signature', { status: 401 });
            }

            if (!bucket) return new Response('Server Error: Bucket binding not found', { status: 500 });
            const object = await bucket.get(key);
            if (object === null) return new Response('File not found', { status: 404 });

            const headers = new Headers();
            object.writeHttpMetadata(headers);
            headers.set('etag', object.httpEtag);

            return new Response(object.body, { headers });
        }

        if (request.method !== 'POST') {
            return new Response('Method not allowed', { status: 405 });
        }

        // Authentication Check
        const authKey = request.headers.get('X-API-Key');
        if (!authKey || (env.AUTH_KEY && authKey !== env.AUTH_KEY)) {
            return new Response(JSON.stringify({ error: 'Unauthorized: Invalid or missing API Key' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        try {
            const formData = await request.formData();
            const image = formData.get('image');

            if (!image || !(image instanceof File)) {
                return new Response('No file found in request under the field "image"', { status: 400 });
            }

             // Security: File Size Limit
            const maxSizeMB = parseInt(env.MAX_SIZE_MB) || 10;
            const MAX_SIZE = maxSizeMB * 1024 * 1024;
            if (image.size > MAX_SIZE) {
                return new Response(`File too large. Maximum size is ${maxSizeMB}MB.`, { status: 413 });
            }

            // Security: Image Type Validation
            const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'];
            if (!allowedTypes.includes(image.type)) {
                return new Response(`Invalid file type: ${image.type}`, { status: 415 });
            }
            
            const inputBuffer = await image.arrayBuffer();

            // Perform compression to WebP
            const quality = parseInt(env.IMAGE_QUALITY) || 80;
            const compressedBuffer = await optimizeImage({
                image: inputBuffer,
                quality: quality,
                format: 'webp'
            });

            const fileName = `${crypto.randomUUID()}.webp`;
            if (!bucket) return new Response('Server Error: Bucket binding not found', { status: 500 });
            await bucket.put(fileName, compressedBuffer, {
                httpMetadata: { contentType: 'image/webp' }
            });

            const baseUrl = env.BASE_URL && !isLocal ? env.BASE_URL : `${url.protocol}//${url.host}`;
            const permUrl = `${baseUrl.replace(/\/$/, '')}/${fileName}`;

            // Generate a Preview Signed URL (for immediate view)
            const expiryMinutes = parseInt(env.URL_EXPIRY_MINUTES) || 60;
            const previewExpiry = Date.now() + (expiryMinutes * 60 * 1000);
            const signingSecret = env.SIGNING_SECRET || 'dev-secret';
            const dataToSign = `${fileName}:${previewExpiry}`;
            const encoder = new TextEncoder();
            const keyData = encoder.encode(signingSecret);
            const cryptoKey = await crypto.subtle.importKey(
                'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
            );
            const sigBuffer = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(dataToSign));
            const sig = bufferToHex(sigBuffer);
            const signedUrl = `${permUrl}?sig=${sig}&exp=${previewExpiry}`;

            return new Response(JSON.stringify({
                message: 'Image uploaded & compressed successfully!',
                fileName: fileName,
                permanentUrl: permUrl,
                previewUrl: signedUrl,
                originalSize: inputBuffer.byteLength,
                compressedSize: compressedBuffer.byteLength
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });

        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }
};

// Helper functions for HEX/Buffer conversion
function bufferToHex(buffer) {
    return Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

function hexToBuffer(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes.buffer;
}
