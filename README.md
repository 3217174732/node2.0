# node2.0 remote-chunk upload version

This version keeps the existing 5 MiB manifest/chunk/DingTalk playback structure.

## New upload flow

1. Browser slices the selected video into 5 MiB chunks.
2. Each chunk is prefixed with an exact 125-byte 1x1 PNG payload.
3. Browser uploads the wrapped chunk to the configured third-party image upload API.
4. Browser extracts `data.url_list[0].url` from the JSON response.
5. Browser sends only that URL to `POST /api/videos/:id/remote-chunks/:index`.
6. Node downloads the returned URL on the server, discards exactly the first 125 bytes, verifies the remaining chunk size, and uploads the original bytes through the existing DingTalk uploader.
7. The existing manifest, playback URL, Range handling, 64 MiB memory cache, 1 GiB disk cache, 50 MiB prefetch and shared in-flight cache remain unchanged.

## Files to overwrite

- `server.js`
- `public/index.html`

Optional:
- copy `.env.example` values into the real `.env` and adjust the existing DingTalk settings.

## Start

```bash
cd /www/wwwroot/301
npm install
node server.js
```

For PM2/BT-Panel, restart the existing Node application after replacing the files.

## New API

```text
POST /api/videos/:id/remote-chunks/:index
Content-Type: application/json

{
  "url": "https://p26-feedback-sign.byteimg.com/...",
  "prefixBytes": 125
}
```

The endpoint does not accept arbitrary remote hosts. By default it only accepts HTTPS URLs whose hostname is `byteimg.com` or a subdomain of it.

## S3-compatible facade

The package also keeps the S3-compatible facade discussed earlier. It does not replace DingTalk storage.

```text
Endpoint: http://YOUR_HOST:8080/s3
Bucket: video
Region: us-east-1
Access Key: node2-access
Secret Key: change-this-secret
```

Change `S3_SECRET_KEY` in the real `.env` before exposing the S3 endpoint publicly.
