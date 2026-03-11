# Image Upload & Compression (Cloudflare Version)

This service allows for uploading images, which are then compressed and converted to WebP format before being stored in Cloudflare R2.

## Features
- **Fast Uploads**: Powered by Cloudflare Workers at the edge.
- **Wasm-Powered Compression**: Uses WebAssembly for efficient image processing.
- **R2 Storage**: Reliable and cost-effective object storage.
- **Security**: Protected by API Key authentication.

## Setup

### 1. Create the R2 Bucket
```bash
npx wrangler r2 bucket create image-uploads
```

### 2. Configure Public Access
1. Go to the **R2** dashboard in Cloudflare.
2. Select your bucket (`image-uploads`).
3. Go to the **Settings** tab.
4. Under **Public Access**, connect your custom domain (e.g., `images.example.com`).

### 3. Deployment
1. Set your production API Key:
   ```bash
   npx wrangler secret put AUTH_KEY
   ```
2. Deploy the worker:
   ```bash
   npm run deploy
   ```

## API Usage

### POST /upload
Send a `multipart/form-data` request with an image file.
- **Header**: `X-API-Key: your-secret-key`
- **Field Name**: `image`
- **Response**:
    ```json
    {
      "message": "Image uploaded & compressed successfully!",
      "url": "https://images.example.com/uuid.webp",
      "fileName": "uuid.webp",
      "originalSize": 1024,
      "compressedSize": 512
    }
    ```

### GET /filename.webp
Viewing images is public and does **not** require an API Key.
- **URL**: `https://images.example.com/uuid.webp`

## Environment Variables
- `IMAGE_QUALITY`: Quality of the output WebP image (default: 80).
- `BASE_URL`: The public URL (e.g., `https://images.example.com`).
- `AUTH_KEY`: The secret key for uploads (use `wrangler secret put AUTH_KEY` in production).
