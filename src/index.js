import { optimizeImage } from 'wasm-image-optimization';

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const bucket = env[env.R2_BINDING || 'blob'];

        // Security: Domain Lockdown (Allow localhost for dev)
        const host = request.headers.get('Host');
        const isLocal = host && host.includes('localhost');
        if (!isLocal && env.ALLOWED_DOMAIN && host !== env.ALLOWED_DOMAIN) {
            return new Response('Access denied: Unauthorized domain.', { status: 403 });
        }

        if (request.method === 'GET') {
            const key = url.pathname.slice(1);

            if (!key) {
                return new Response('No file specified', { status: 400 });
            }

            const object = await bucket.get(key);

            if (object === null) {
                return new Response('File not found', { status: 404 });
            }

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

            // Upload to R2
            await bucket.put(fileName, compressedBuffer, {
                httpMetadata: { contentType: 'image/webp' }
            });

            // Construct public URL
            const requestUrl = new URL(request.url);
            const baseUrl = env.BASE_URL && !requestUrl.hostname.includes('localhost')
                ? env.BASE_URL
                : `${requestUrl.protocol}//${requestUrl.host}`;

            const url = `${baseUrl.replace(/\/$/, '')}/${fileName}`;

            return new Response(JSON.stringify({
                message: 'Image uploaded & compressed successfully!',
                url: url,
                fileName: fileName,
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
