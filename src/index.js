import { optimizeImage } from 'wasm-image-optimization';

export default {
    async fetch(request, env, ctx) {
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

            const inputBuffer = await image.arrayBuffer();

            // Perform compression to WebP
            const quality = parseInt(env.IMAGE_QUALITY) || 80;
            const compressedBuffer = await optimizeImage({
                image: inputBuffer,
                quality: quality,
                format: 'webp'
            });

            return new Response(compressedBuffer, {
                headers: {
                    'Content-Type': 'image/webp',
                    'X-Original-Size': inputBuffer.byteLength.toString(),
                    'X-Compressed-Size': compressedBuffer.byteLength.toString()
                }
            });

        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }
};
