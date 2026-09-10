import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

/*
|--------------------------------------------------------------------------
| Configuration
|--------------------------------------------------------------------------
*/

const PORT = Number(
    process.env.PORT || 8080
);

/*
 * 每个上传 chunk 大小。
 *
 * 默认 8MB。
 */
const CHUNK_SIZE = Math.max(
    256 * 1024,
    Number(
        process.env.CHUNK_SIZE ||
        8 * 1024 * 1024
    )
);

/*
 * 钉钉远程请求最大并发。
 */
const GLOBAL_REMOTE_CONCURRENCY = Math.max(
    1,
    Number(
        process.env.GLOBAL_REMOTE_CONCURRENCY ||
        32
    )
);

/*
 * 钉钉请求超时。
 *
 * 注意：
 * 这里不是整个视频下载超时。
 * 而是单个 Range HTTP 请求的超时。
 */
const REMOTE_TIMEOUT_MS = Math.max(
    3000,
    Number(
        process.env.REMOTE_TIMEOUT_MS ||
        30000
    )
);

/*
 * seek 缓存。
 *
 * 只有浏览器跳转 Range 时使用。
 */
const SEEK_CACHE_ENABLED =
    String(
        process.env.SEEK_CACHE_ENABLED || 'true'
    ).toLowerCase() === 'true';

/*
 * seek 时向附近扩展多少。
 */
const SEEK_PREFETCH_SIZE = Math.max(
    256 * 1024,
    Number(
        process.env.SEEK_PREFETCH_SIZE ||
        4 * 1024 * 1024
    )
);

/*
 * 单个 seek buffer 最大大小。
 */
const SEEK_BUFFER_SIZE = Math.max(
    256 * 1024,
    Number(
        process.env.SEEK_BUFFER_SIZE ||
        4 * 1024 * 1024
    )
);

/*
 * 全局 seek cache 最大内存。
 *
 * 默认 64MB。
 */
const MAX_SEEK_CACHE_BYTES = Math.max(
    0,
    Number(
        process.env.MAX_SEEK_CACHE_BYTES ||
        64 * 1024 * 1024
    )
);

/*
 * 单文件 seek cache 最大内存。
 */
const MAX_SEEK_CACHE_PER_FILE = Math.max(
    0,
    Number(
        process.env.MAX_SEEK_CACHE_PER_FILE ||
        8 * 1024 * 1024
    )
);

/*
|--------------------------------------------------------------------------
| DingTalk
|--------------------------------------------------------------------------
*/

const DINGTALK_UPLOAD_URL =
    process.env.DINGTALK_UPLOAD_URL ||
    'https://h5.dingtalk.com/common/picUpload';

/*
|--------------------------------------------------------------------------
| Storage
|--------------------------------------------------------------------------
*/

const STORAGE_DIR =
    path.resolve('./storage');

const MANIFEST_DIR =
    path.join(
        STORAGE_DIR,
        'manifests'
    );

const UPLOAD_DIR =
    path.join(
        STORAGE_DIR,
        'uploads'
    );

await fs.mkdir(
    MANIFEST_DIR,
    {
        recursive: true
    }
);

await fs.mkdir(
    UPLOAD_DIR,
    {
        recursive: true
    }
);

/*
|--------------------------------------------------------------------------
| MIME
|--------------------------------------------------------------------------
*/

const MIME_TYPES = {

    /*
     * Video
     */
    '.mp4':
        'video/mp4',

    '.m4v':
        'video/x-m4v',

    '.mov':
        'video/quicktime',

    '.mkv':
        'video/x-matroska',

    '.webm':
        'video/webm',

    '.avi':
        'video/x-msvideo',

    '.wmv':
        'video/x-ms-wmv',

    '.flv':
        'video/x-flv',

    '.ts':
        'video/mp2t',

    '.mts':
        'video/mp2t',

    '.m2ts':
        'video/mp2t',

    '.3gp':
        'video/3gpp',

    '.3g2':
        'video/3gpp2',

    '.ogv':
        'video/ogg',

    /*
     * Audio
     */
    '.mp3':
        'audio/mpeg',

    '.wav':
        'audio/wav',

    '.flac':
        'audio/flac',

    '.aac':
        'audio/aac',

    '.ogg':
        'audio/ogg',

    '.oga':
        'audio/ogg',

    '.opus':
        'audio/opus',

    '.m4a':
        'audio/mp4',

    '.wma':
        'audio/x-ms-wma',

    /*
     * Images
     */
    '.jpg':
        'image/jpeg',

    '.jpeg':
        'image/jpeg',

    '.png':
        'image/png',

    '.gif':
        'image/gif',

    '.webp':
        'image/webp',

    '.bmp':
        'image/bmp',

    '.svg':
        'image/svg+xml',

    '.ico':
        'image/x-icon',

    '.tif':
        'image/tiff',

    '.tiff':
        'image/tiff',

    '.avif':
        'image/avif',

    /*
     * Documents
     */
    '.pdf':
        'application/pdf',

    '.doc':
        'application/msword',

    '.docx':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',

    '.xls':
        'application/vnd.ms-excel',

    '.xlsx':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',

    '.ppt':
        'application/vnd.ms-powerpoint',

    '.pptx':
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',

    '.txt':
        'text/plain',

    '.csv':
        'text/csv',

    '.json':
        'application/json',

    '.xml':
        'application/xml',

    '.html':
        'text/html',

    '.htm':
        'text/html',

    '.css':
        'text/css',

    '.js':
        'text/javascript',

    '.mjs':
        'text/javascript',

    '.cjs':
        'text/javascript',

    '.wasm':
        'application/wasm',

    /*
     * Archives
     */
    '.zip':
        'application/zip',

    '.rar':
        'application/vnd.rar',

    '.7z':
        'application/x-7z-compressed',

    '.tar':
        'application/x-tar',

    '.gz':
        'application/gzip',

    '.bz2':
        'application/x-bzip2',

    '.xz':
        'application/x-xz',

    /*
     * Executables
     */
    '.apk':
        'application/vnd.android.package-archive',

    '.aab':
        'application/octet-stream',

    '.exe':
        'application/vnd.microsoft.portable-executable',

    '.msi':
        'application/x-msdownload',

    '.dmg':
        'application/x-apple-diskimage',

    '.iso':
        'application/x-iso9660-image'
};

/*
|--------------------------------------------------------------------------
| Express
|--------------------------------------------------------------------------
*/

const app =
    express();

app.disable(
    'x-powered-by'
);

app.use(
    express.json({
        limit:
            '2mb'
    })
);

/*
|--------------------------------------------------------------------------
| Static
|--------------------------------------------------------------------------
*/

app.use(
    express.static(
        path.resolve('./public')
    )
);

/*
|--------------------------------------------------------------------------
| Multer
|--------------------------------------------------------------------------
*/

const upload =
    multer({

        dest:
            UPLOAD_DIR,

        limits: {

            fileSize:
                CHUNK_SIZE
        }
    });

/*
|--------------------------------------------------------------------------
| Utility
|--------------------------------------------------------------------------
*/

function sanitizeFilename(
    filename
) {

    if (
        typeof filename !== 'string'
    ) {
        return 'file';
    }

    let result =
        filename
            .replace(
                /[\u0000-\u001f\u007f]/g,
                ''
            )
            .replace(
                /[/\\?%*:|"<>]/g,
                '_'
            )
            .trim();

    if (!result) {
        result = 'file';
    }

    if (
        result.length > 255
    ) {

        result =
            result.slice(
                0,
                255
            );
    }

    return result;
}

function getExtension(
    filename
) {

    return path
        .extname(
            sanitizeFilename(
                filename
            )
        )
        .toLowerCase();
}

function getMimeType(
    filename,
    browserType
) {

    const ext =
        getExtension(
            filename
        );

    if (
        MIME_TYPES[ext]
    ) {

        return MIME_TYPES[ext];
    }

    if (
        typeof browserType === 'string' &&
        browserType.trim() &&
        browserType !==
            'application/octet-stream'
    ) {

        return browserType;
    }

    return 'application/octet-stream';
}

function isValidId(
    id
) {

    return (
        typeof id === 'string' &&
        /^[a-zA-Z0-9_-]+$/.test(id)
    );
}

/*
|--------------------------------------------------------------------------
| Manifest
|--------------------------------------------------------------------------
*/

function getManifestPath(
    id
) {

    return path.join(
        MANIFEST_DIR,
        `${id}.json`
    );
}

async function saveManifest(
    manifest
) {

    const target =
        getManifestPath(
            manifest.id
        );

    const temp =
        `${target}.${process.pid}.${Date.now()}.tmp`;

    await fs.writeFile(
        temp,
        JSON.stringify(
            manifest,
            null,
            2
        ),
        'utf8'
    );

    await fs.rename(
        temp,
        target
    );
}

async function getManifest(
    id
) {

    if (
        !isValidId(id)
    ) {

        return null;
    }

    try {

        const text =
            await fs.readFile(
                getManifestPath(id),
                'utf8'
            );

        return JSON.parse(
            text
        );

    } catch {

        return null;
    }
}

/*
|--------------------------------------------------------------------------
| Create Manifest
|--------------------------------------------------------------------------
*/

function createManifest({
    id,
    filename,
    size,
    contentType
}) {

    const safeFilename =
        sanitizeFilename(
            filename
        );

    return {

        id,

        filename:
            safeFilename,

        extension:
            getExtension(
                safeFilename
            ),

        contentType:
            getMimeType(
                safeFilename,
                contentType
            ),

        size,

        chunkSize:
            CHUNK_SIZE,

        chunkCount:
            Math.ceil(
                size /
                CHUNK_SIZE
            ),

        chunks: {},

        status:
            'uploading',

        createdAt:
            new Date()
                .toISOString()
    };
}

/*
|--------------------------------------------------------------------------
| URL finder
|--------------------------------------------------------------------------
*/

function findUrl(
    value
) {

    if (
        typeof value === 'string'
    ) {

        if (
            /^https?:\/\//i.test(value)
        ) {

            return value;
        }

        return null;
    }

    if (
        !value ||
        typeof value !== 'object'
    ) {

        return null;
    }

    const directCandidates = [

        value.url,

        value.src,

        value.imageUrl,

        value.imgUrl,

        value.picUrl,

        value.downloadUrl,

        value.fileUrl,

        value.fileUrlPath,

        value.data?.url,

        value.data?.src,

        value.data?.imageUrl,

        value.data?.imgUrl,

        value.data?.picUrl,

        value.data?.downloadUrl,

        value.data?.fileUrl,

        value.result?.url,

        value.result?.src,

        value.result?.imageUrl,

        value.result?.imgUrl,

        value.result?.picUrl,

        value.result?.downloadUrl,

        value.result?.fileUrl
    ];

    for (
        const candidate
        of directCandidates
    ) {

        if (
            typeof candidate === 'string' &&
            /^https?:\/\//i.test(candidate)
        ) {

            return candidate;
        }
    }

    for (
        const child
        of Object.values(value)
    ) {

        const url =
            findUrl(
                child
            );

        if (url) {
            return url;
        }
    }

    return null;
}

/*
|--------------------------------------------------------------------------
| DingTalk headers
|--------------------------------------------------------------------------
*/

function getDingTalkHeaders() {

    const headers = {

        'User-Agent':
            'Mozilla/5.0',

        'Referer':
            'https://www.dingtalk.com'
    };

    if (
        process.env.DINGTALK_COOKIE
    ) {

        headers.Cookie =
            process.env.DINGTALK_COOKIE;
    }

    if (
        process.env.DINGTALK_TOKEN
    ) {

        headers.Authorization =
            `Bearer ${process.env.DINGTALK_TOKEN}`;
    }

    return headers;
}

/*
|--------------------------------------------------------------------------
| Upload to DingTalk
|--------------------------------------------------------------------------
|
| 重要：
|
| 以前这里固定：
|
|     type: image/jpeg
|
| 现在不再伪装成 JPEG。
|
|--------------------------------------------------------------------------
*/

async function uploadChunkToDingTalk({
    filePath,
    filename,
    contentType
}) {

    const buffer =
        await fs.readFile(
            filePath
        );

    const blob =
        new Blob(
            [
                buffer
            ],
            {
                type:
                    contentType ||
                    'application/octet-stream'
            }
        );

    const form =
        new FormData();

    form.append(
        'picFile',
        blob,
        filename
    );

    const response =
        await fetch(
            DINGTALK_UPLOAD_URL,
            {

                method:
                    'POST',

                headers:
                    getDingTalkHeaders(),

                body:
                    form,

                redirect:
                    'follow',

                signal:
                    AbortSignal.timeout(
                        REMOTE_TIMEOUT_MS
                    )
            }
        );

    const text =
        await response.text();

    if (
        !response.ok
    ) {

        throw new Error(
            `DingTalk HTTP ${
                response.status
            }: ${
                text.slice(
                    0,
                    1000
                )
            }`
        );
    }

    let data;

    try {

        data =
            JSON.parse(
                text
            );

    } catch {

        throw new Error(
            `DingTalk 返回非 JSON: ${
                text.slice(
                    0,
                    1000
                )
            }`
        );
    }

    const url =
        findUrl(
            data
        );

    if (!url) {

        throw new Error(
            'DingTalk 返回结果中没有 URL'
        );
    }

    return {

        url,

        raw:
            data
    };
}

/*
|--------------------------------------------------------------------------
| Remote concurrency
|--------------------------------------------------------------------------
*/

let globalRemoteActive = 0;

const globalRemoteQueue = [];

async function acquireRemoteSlot() {

    if (
        globalRemoteActive <
        GLOBAL_REMOTE_CONCURRENCY
    ) {

        globalRemoteActive++;

        return;
    }

    await new Promise(
        resolve => {

            globalRemoteQueue.push(
                resolve
            );
        }
    );

    globalRemoteActive++;
}

function releaseRemoteSlot() {

    globalRemoteActive =
        Math.max(
            0,
            globalRemoteActive - 1
        );

    const next =
        globalRemoteQueue.shift();

    if (next) {

        next();
    }
}

/*
|--------------------------------------------------------------------------
| Parse HTTP Range
|--------------------------------------------------------------------------
*/

function parseRange(
    header,
    totalSize
) {

    if (!header) {

        return null;
    }

    const match =
        /^bytes=(\d*)-(\d*)$/
            .exec(
                header.trim()
            );

    if (!match) {

        throw new Error(
            'Invalid Range'
        );
    }

    const startText =
        match[1];

    const endText =
        match[2];

    let start;
    let end;

    /*
     * bytes=-500
     */
    if (
        startText === ''
    ) {

        const length =
            Number(
                endText
            );

        if (
            !Number.isSafeInteger(
                length
            ) ||
            length <= 0
        ) {

            throw new Error(
                'Invalid Range'
            );
        }

        start =
            Math.max(
                0,
                totalSize - length
            );

        end =
            totalSize - 1;

    } else {

        start =
            Number(
                startText
            );

        if (
            !Number.isSafeInteger(
                start
            ) ||
            start < 0
        ) {

            throw new Error(
                'Invalid Range'
            );
        }

        /*
         * bytes=500-
         */
        if (
            endText === ''
        ) {

            end =
                totalSize - 1;

        } else {

            end =
                Number(
                    endText
                );
        }
    }

    if (
        !Number.isSafeInteger(
            end
        ) ||
        end < start ||
        start >= totalSize
    ) {

        throw new Error(
            'Range Not Satisfiable'
        );
    }

    end =
        Math.min(
            end,
            totalSize - 1
        );

    return {

        start,

        end,

        length:
            end -
            start +
            1
    };
}

/*
|--------------------------------------------------------------------------
| Remote Range Request
|--------------------------------------------------------------------------
|
| 最重要：
|
| 每次只从钉钉拿真正需要的 Range。
|
| 不读取整个文件。
|
|--------------------------------------------------------------------------
*/

async function fetchDingTalkRange({
    url,
    start,
    end,
    signal
}) {

    await acquireRemoteSlot();

    const controller =
        new AbortController();

    let released = false;

    function release() {

        if (released) {
            return;
        }

        released = true;

        releaseRemoteSlot();
    }

    function onAbort() {

        controller.abort();
    }

    if (signal) {

        if (
            signal.aborted
        ) {

            controller.abort();

        } else {

            signal.addEventListener(
                'abort',
                onAbort,
                {
                    once:
                        true
                }
            );
        }
    }

    const timer =
        setTimeout(
            () => {

                controller.abort();

            },
            REMOTE_TIMEOUT_MS
        );

    try {

        const headers =
            getDingTalkHeaders();

        headers.Range =
            `bytes=${start}-${end}`;

        const response =
            await fetch(
                url,
                {

                    method:
                        'GET',

                    headers,

                    redirect:
                        'follow',

                    signal:
                        controller.signal
                }
            );

        /*
         * 不允许 200 fallback。
         */
        if (
            response.status !== 206
        ) {

            throw new Error(
                `DingTalk Range 请求必须返回 206，实际 HTTP ${
                    response.status
                }`
            );
        }

        return {

            response,

            release
        };

    } catch (error) {

        release();

        throw error;

    } finally {

        clearTimeout(
            timer
        );

        if (signal) {

            signal.removeEventListener(
                'abort',
                onAbort
            );
        }
    }
}

/*
|--------------------------------------------------------------------------
| Stream DingTalk response directly
|--------------------------------------------------------------------------
|
| 这个函数是首次播放的核心。
|
| DingTalk
|     ↓
| response.body
|     ↓
| Node
|     ↓
| browser
|
| 中间不生成完整 Buffer。
|
|--------------------------------------------------------------------------
*/

async function streamRemoteRange({
    url,
    remoteStart,
    remoteEnd,
    response,
    expectedLength,
    signal
}) {

    const remote =
        await fetchDingTalkRange({

            url,

            start:
                remoteStart,

            end:
                remoteEnd,

            signal
        });

    try {

        if (
            !remote.response.body
        ) {

            throw new Error(
                'DingTalk response body 不存在'
            );
        }

        const reader =
            remote.response
                .body
                .getReader();

        let total =
            0;

        try {

            while (
                total <
                expectedLength
            ) {

                if (
                    signal.aborted ||
                    response.destroyed
                ) {

                    try {

                        await reader.cancel();

                    } catch {}

                    return;
                }

                const {
                    done,
                    value
                } =
                    await reader.read();

                if (done) {
                    break;
                }

                if (
                    !value ||
                    value.byteLength <= 0
                ) {

                    continue;
                }

                const remaining =
                    expectedLength -
                    total;

                const writeLength =
                    Math.min(
                        remaining,
                        value.byteLength
                    );

                const buffer =
                    Buffer.from(
                        value.buffer,
                        value.byteOffset,
                        writeLength
                    );

                total +=
                    writeLength;

                if (
                    !response.write(
                        buffer
                    )
                ) {

                    await new Promise(
                        resolve => {

                            response.once(
                                'drain',
                                resolve
                            );
                        }
                    );
                }
            }

        } finally {

            try {

                reader.releaseLock();

            } catch {}
        }

        if (
            total !==
                expectedLength &&
            !signal.aborted
        ) {

            throw new Error(
                `DingTalk Range 长度异常：期望 ${
                    expectedLength
                }，实际 ${
                    total
                }`
            );
        }

    } finally {

        remote.release();
    }
}

/*
|--------------------------------------------------------------------------
| Direct stream across chunks
|--------------------------------------------------------------------------
|
| 首次打开 / 正常播放：
|
| 永远优先使用这里。
|
|--------------------------------------------------------------------------
*/

async function streamRangeDirect({
    manifest,
    start,
    end,
    response,
    signal
}) {

    const firstChunk =
        Math.floor(
            start /
            manifest.chunkSize
        );

    const lastChunk =
        Math.floor(
            end /
            manifest.chunkSize
        );

    for (
        let index =
            firstChunk;

        index <=
            lastChunk;

        index++
    ) {

        if (
            signal.aborted ||
            response.destroyed
        ) {

            return;
        }

        const chunk =
            manifest.chunks[
                index
            ];

        if (!chunk) {

            throw new Error(
                `Chunk ${index} 不存在`
            );
        }

        const chunkStart =
            index *
            manifest.chunkSize;

        const chunkEnd =
            Math.min(
                manifest.size - 1,
                chunkStart +
                    manifest.chunkSize -
                    1
            );

        const actualStart =
            Math.max(
                start,
                chunkStart
            );

        const actualEnd =
            Math.min(
                end,
                chunkEnd
            );

        const remoteStart =
            actualStart -
            chunkStart;

        const remoteEnd =
            actualEnd -
            chunkStart;

        await streamRemoteRange({

            url:
                chunk.url,

            remoteStart,

            remoteEnd,

            response,

            expectedLength:
                actualEnd -
                actualStart +
                1,

            signal
        });
    }

    if (
        !signal.aborted &&
        !response.destroyed &&
        !response.writableEnded
    ) {

        response.end();
    }
}

/*
|--------------------------------------------------------------------------
| Seek Cache
|--------------------------------------------------------------------------
*/

const seekCache =
    new Map();

let seekCacheBytes =
    0;

/*
|--------------------------------------------------------------------------
| Cache key
|--------------------------------------------------------------------------
*/

function makeSeekCacheKey(
    fileId,
    start,
    end
) {

    return (
        `${fileId}:${start}:${end}`
    );
}

/*
|--------------------------------------------------------------------------
| Remove cache
|--------------------------------------------------------------------------
*/

function removeSeekCache(
    key
) {

    const entry =
        seekCache.get(
            key
        );

    if (!entry) {
        return;
    }

    seekCache.delete(
        key
    );

    seekCacheBytes =
        Math.max(
            0,
            seekCacheBytes -
                entry.buffer.length
        );
}

/*
|--------------------------------------------------------------------------
| Global cache eviction
|--------------------------------------------------------------------------
*/

function evictSeekCache(
    requiredBytes = 0
) {

    while (
        seekCacheBytes +
            requiredBytes >
        MAX_SEEK_CACHE_BYTES
    ) {

        const iterator =
            seekCache
                .entries()
                .next();

        if (
            iterator.done
        ) {

            break;
        }

        const [
            key
        ] =
            iterator.value;

        removeSeekCache(
            key
        );
    }
}

/*
|--------------------------------------------------------------------------
| File cache bytes
|--------------------------------------------------------------------------
*/

function getFileSeekCacheBytes(
    fileId
) {

    let total =
        0;

    for (
        const entry
        of seekCache.values()
    ) {

        if (
            entry.fileId ===
            fileId
        ) {

            total +=
                entry.buffer.length;
        }
    }

    return total;
}

/*
|--------------------------------------------------------------------------
| File cache eviction
|--------------------------------------------------------------------------
*/

function evictFileSeekCache(
    fileId,
    requiredBytes = 0
) {

    while (
        getFileSeekCacheBytes(
            fileId
        ) +
        requiredBytes >
        MAX_SEEK_CACHE_PER_FILE
    ) {

        let oldest =
            null;

        for (
            const entry
            of seekCache.values()
        ) {

            if (
                entry.fileId !==
                fileId
            ) {

                continue;
            }

            if (
                !oldest ||
                entry.lastUsed <
                    oldest.lastUsed
            ) {

                oldest =
                    entry;
            }
        }

        if (!oldest) {
            break;
        }

        removeSeekCache(
            oldest.key
        );
    }
}

/*
|--------------------------------------------------------------------------
| Find covering cache
|--------------------------------------------------------------------------
*/

function findCoveringSeekCache(
    fileId,
    start,
    end
) {

    for (
        const entry
        of seekCache.values()
    ) {

        if (
            entry.fileId !==
            fileId
        ) {

            continue;
        }

        if (
            entry.start <= start &&
            entry.end >= end
        ) {

            entry.lastUsed =
                Date.now();

            /*
             * LRU move to end.
             */
            seekCache.delete(
                entry.key
            );

            seekCache.set(
                entry.key,
                entry
            );

            return entry;
        }
    }

    return null;
}

/*
|--------------------------------------------------------------------------
| Put cache
|--------------------------------------------------------------------------
*/

function putSeekCache({
    fileId,
    start,
    end,
    buffer
}) {

    if (
        !SEEK_CACHE_ENABLED
    ) {

        return;
    }

    if (
        MAX_SEEK_CACHE_BYTES <= 0 ||
        MAX_SEEK_CACHE_PER_FILE <= 0
    ) {

        return;
    }

    if (
        !buffer ||
        buffer.length <= 0
    ) {

        return;
    }

    if (
        buffer.length >
        SEEK_BUFFER_SIZE
    ) {

        return;
    }

    /*
     * 先删除同文件旧缓存。
     */
    const key =
        makeSeekCacheKey(
            fileId,
            start,
            end
        );

    if (
        seekCache.has(key)
    ) {

        removeSeekCache(
            key
        );
    }

    /*
     * 当前文件限制。
     */
    evictFileSeekCache(
        fileId,
        buffer.length
    );

    /*
     * 全局限制。
     */
    evictSeekCache(
        buffer.length
    );

    /*
     * 如果即使清理后也放不下，
     * 就不缓存。
     */
    if (
        seekCacheBytes +
            buffer.length >
        MAX_SEEK_CACHE_BYTES
    ) {

        return;
    }

    if (
        getFileSeekCacheBytes(
            fileId
        ) +
        buffer.length >
        MAX_SEEK_CACHE_PER_FILE
    ) {

        return;
    }

    const now =
        Date.now();

    const entry = {

        key,

        fileId,

        start,

        end,

        buffer,

        createdAt:
            now,

        lastUsed:
            now
    };

    seekCache.set(
        key,
        entry
    );

    seekCacheBytes +=
        buffer.length;
}

/*
|--------------------------------------------------------------------------
| Slice cache
|--------------------------------------------------------------------------
*/

function sliceSeekCache(
    entry,
    start,
    end
) {

    entry.lastUsed =
        Date.now();

    seekCache.delete(
        entry.key
    );

    seekCache.set(
        entry.key,
        entry
    );

    const offset =
        start -
        entry.start;

    const length =
        end -
        start +
        1;

    return entry.buffer.subarray(
        offset,
        offset + length
    );
}

/*
|--------------------------------------------------------------------------
| Fetch seek buffer
|--------------------------------------------------------------------------
|
| 注意：
|
| 这个函数只用于 seek。
|
| 首次打开绝对不会调用。
|
|--------------------------------------------------------------------------
*/

async function getSeekBuffer({
    manifest,
    requestedStart,
    requestedEnd,
    signal
}) {

    /*
     * 先找缓存。
     */
    const cached =
        findCoveringSeekCache(
            manifest.id,
            requestedStart,
            requestedEnd
        );

    if (cached) {

        return {

            buffer:
                sliceSeekCache(
                    cached,
                    requestedStart,
                    requestedEnd
                ),

            fromCache:
                true
        };
    }

    /*
     * 计算预取范围。
     *
     * 从用户 seek 位置附近开始，
     * 而不是从文件头开始。
     */
    let fetchStart =
        Math.floor(
            requestedStart /
            SEEK_PREFETCH_SIZE
        ) *
        SEEK_PREFETCH_SIZE;

    fetchStart =
        Math.max(
            0,
            Math.min(
                fetchStart,
                requestedStart
            )
        );

    let fetchEnd =
        Math.max(
            requestedEnd,
            fetchStart +
                SEEK_PREFETCH_SIZE -
                1
        );

    fetchEnd =
        Math.min(
            manifest.size - 1,
            fetchEnd
        );

    /*
     * 控制最大 buffer。
     */
    if (
        fetchEnd -
            fetchStart +
            1 >
        SEEK_BUFFER_SIZE
    ) {

        fetchEnd =
            Math.min(
                manifest.size - 1,
                fetchStart +
                    SEEK_BUFFER_SIZE -
                    1
            );
    }

    /*
     * 一个 seek buffer 尽量限制在一个 chunk 内。
     */
    const chunkIndex =
        Math.floor(
            fetchStart /
            manifest.chunkSize
        );

    const chunk =
        manifest.chunks[
            chunkIndex
        ];

    if (!chunk) {

        throw new Error(
            `Chunk ${chunkIndex} 不存在`
        );
    }

    const chunkStart =
        chunkIndex *
        manifest.chunkSize;

    const chunkEnd =
        Math.min(
            manifest.size - 1,
            chunkStart +
                manifest.chunkSize -
                1
        );

    fetchEnd =
        Math.min(
            fetchEnd,
            chunkEnd
        );

    const remoteStart =
        fetchStart -
        chunkStart;

    const remoteEnd =
        fetchEnd -
        chunkStart;

    const buffer =
        await fetchRemoteBuffer({

            url:
                chunk.url,

            start:
                remoteStart,

            end:
                remoteEnd,

            signal
        });

    /*
     * 放进 seek cache。
     */
    putSeekCache({

        fileId:
            manifest.id,

        start:
            fetchStart,

        end:
            fetchStart +
                buffer.length -
                1,

        buffer
    });

    /*
     * 再查一次。
     */
    const newCached =
        findCoveringSeekCache(
            manifest.id,
            requestedStart,
            requestedEnd
        );

    if (newCached) {

        return {

            buffer:
                sliceSeekCache(
                    newCached,
                    requestedStart,
                    requestedEnd
                ),

            fromCache:
                false
        };
    }

    /*
     * 如果 cache 因内存限制没放进去，
     * 直接使用本次 buffer。
     */
    const offset =
        requestedStart -
        fetchStart;

    return {

        buffer:
            buffer.subarray(
                offset,
                offset +
                    (
                        requestedEnd -
                        requestedStart +
                        1
                    )
            ),

        fromCache:
            false
    };
}

/*
|--------------------------------------------------------------------------
| Fetch remote buffer
|--------------------------------------------------------------------------
|
| 仅 seek 使用。
|
|--------------------------------------------------------------------------
*/

async function fetchRemoteBuffer({
    url,
    start,
    end,
    signal
}) {

    const remote =
        await fetchDingTalkRange({

            url,

            start,

            end,

            signal
        });

    try {

        if (
            !remote.response.body
        ) {

            throw new Error(
                'DingTalk response body 不存在'
            );
        }

        const reader =
            remote.response
                .body
                .getReader();

        const parts = [];

        let total =
            0;

        try {

            while (true) {

                if (
                    signal?.aborted
                ) {

                    try {

                        await reader.cancel();

                    } catch {}

                    throw new Error(
                        'Request aborted'
                    );
                }

                const {
                    done,
                    value
                } =
                    await reader.read();

                if (done) {
                    break;
                }

                if (
                    value &&
                    value.byteLength > 0
                ) {

                    parts.push(
                        Buffer.from(
                            value
                        )
                    );

                    total +=
                        value.byteLength;
                }
            }

        } finally {

            try {

                reader.releaseLock();

            } catch {}
        }

        const buffer =
            Buffer.concat(
                parts,
                total
            );

        const expectedLength =
            end -
            start +
            1;

        if (
            buffer.length !==
            expectedLength
        ) {

            throw new Error(
                `DingTalk Range 长度异常：期望 ${
                    expectedLength
                }，实际 ${
                    buffer.length
                }`
            );
        }

        return buffer;

    } finally {

        remote.release();
    }
}

/*
|--------------------------------------------------------------------------
| Seek streaming
|--------------------------------------------------------------------------
*/

async function streamSeekRange({
    manifest,
    start,
    end,
    response,
    signal
}) {

    const firstChunk =
        Math.floor(
            start /
            manifest.chunkSize
        );

    const lastChunk =
        Math.floor(
            end /
            manifest.chunkSize
        );

    for (
        let index =
            firstChunk;

        index <=
            lastChunk;

        index++
    ) {

        if (
            signal.aborted ||
            response.destroyed
        ) {

            return;
        }

        const chunk =
            manifest.chunks[
                index
            ];

        if (!chunk) {

            throw new Error(
                `Chunk ${index} 不存在`
            );
        }

        const chunkStart =
            index *
            manifest.chunkSize;

        const chunkEnd =
            Math.min(
                manifest.size - 1,
                chunkStart +
                    manifest.chunkSize -
                    1
            );

        const actualStart =
            Math.max(
                start,
                chunkStart
            );

        const actualEnd =
            Math.min(
                end,
                chunkEnd
            );

        /*
         * 注意：
         *
         * seek cache 只缓存实际 seek 附近的数据。
         */
        const result =
            await getSeekBuffer({

                manifest,

                requestedStart:
                    actualStart,

                requestedEnd:
                    actualEnd,

                signal
            });

        if (
            signal.aborted ||
            response.destroyed
        ) {

            return;
        }

        if (
            !response.write(
                result.buffer
            )
        ) {

            await new Promise(
                resolve => {

                    response.once(
                        'drain',
                        resolve
                    );
                }
            );
        }
    }

    if (
        !signal.aborted &&
        !response.destroyed &&
        !response.writableEnded
    ) {

        response.end();
    }
}

/*
|--------------------------------------------------------------------------
| File URL
|--------------------------------------------------------------------------
*/

function buildFileUrl(
    manifest
) {

    return (
        `/file/${manifest.id}${
            manifest.extension || ''
        }`
    );
}

/*
|--------------------------------------------------------------------------
| Create
|--------------------------------------------------------------------------
*/

app.post(
    '/api/videos',
    async (
        req,
        res
    ) => {

        try {

            const {
                filename,
                size,
                contentType
            } =
                req.body;

            if (
                typeof filename !==
                    'string' ||
                !filename.trim()
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            'filename 参数错误'
                    });
            }

            if (
                !Number.isSafeInteger(
                    size
                ) ||
                size <= 0
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            'size 参数错误'
                    });
            }

            const id =
                crypto.randomUUID();

            const manifest =
                createManifest({

                    id,

                    filename,

                    size,

                    contentType
                });

            await saveManifest(
                manifest
            );

            console.log(
                `[CREATE] ${
                    manifest.filename
                } | ${
                    manifest.size
                } bytes | ${
                    manifest.contentType
                }`
            );

            return res.json({

                success:
                    true,

                id,

                filename:
                    manifest.filename,

                extension:
                    manifest.extension,

                contentType:
                    manifest.contentType,

                size:
                    manifest.size,

                chunkSize:
                    manifest.chunkSize,

                chunkCount:
                    manifest.chunkCount
            });

        } catch (error) {

            console.error(
                '[CREATE ERROR]',
                error
            );

            return res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        error.message
                });
        }
    }
);

/*
|--------------------------------------------------------------------------
| Query
|--------------------------------------------------------------------------
*/

app.get(
    '/api/videos/:id',
    async (
        req,
        res
    ) => {

        const manifest =
            await getManifest(
                req.params.id
            );

        if (!manifest) {

            return res
                .status(404)
                .json({

                    success:
                        false,

                    error:
                        '文件不存在'
                });
        }

        const uploadedChunks =
            Object.keys(
                manifest.chunks
            )
                .map(Number)
                .sort(
                    (a, b) =>
                        a - b
                );

        return res.json({

            success:
                true,

            id:
                manifest.id,

            filename:
                manifest.filename,

            extension:
                manifest.extension,

            contentType:
                manifest.contentType,

            size:
                manifest.size,

            chunkSize:
                manifest.chunkSize,

            chunkCount:
                manifest.chunkCount,

            status:
                manifest.status,

            uploadedChunks
        });
    }
);

/*
|--------------------------------------------------------------------------
| Upload chunk
|--------------------------------------------------------------------------
*/

app.post(
    '/api/videos/:id/chunks/:index',
    upload.single(
        'picFile'
    ),
    async (
        req,
        res
    ) => {

        let tempFile =
            req.file?.path;

        try {

            const id =
                req.params.id;

            const index =
                Number(
                    req.params.index
                );

            if (!req.file) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            '没有收到 picFile'
                    });
            }

            const manifest =
                await getManifest(
                    id
                );

            if (!manifest) {

                return res
                    .status(404)
                    .json({

                        success:
                            false,

                        error:
                            '文件不存在'
                    });
            }

            if (
                !Number.isInteger(
                    index
                ) ||
                index < 0 ||
                index >=
                    manifest.chunkCount
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            'chunk index 错误'
                    });
            }

            const expectedSize =
                index ===
                    manifest.chunkCount - 1

                    ?

                    manifest.size -
                    index *
                        manifest.chunkSize

                    :

                    manifest.chunkSize;

            if (
                req.file.size !==
                expectedSize
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            `chunk 大小错误：期望 ${
                                expectedSize
                            }，实际 ${
                                req.file.size
                            }`
                    });
            }

            /*
             * 已经上传。
             */
            if (
                manifest.chunks[index]
            ) {

                const existing =
                    manifest.chunks[
                        index
                    ];

                try {

                    await fs.unlink(
                        tempFile
                    );

                } catch {}

                tempFile =
                    null;

                return res.json({

                    success:
                        true,

                    index,

                    size:
                        existing.size,

                    url:
                        existing.url,

                    alreadyUploaded:
                        true
                });
            }

            console.log(
                `[UPLOAD] ${
                    manifest.filename
                } | chunk ${
                    index
                }/${
                    manifest.chunkCount - 1
                } | ${
                    req.file.size
                } bytes`
            );

            /*
             * DingTalk 文件名。
             *
             * 保持内部上传接口要求的方式，
             * 但 MIME 不再强制 JPEG。
             */
            const dingFilename =
                `chunk_${
                    String(index)
                        .padStart(
                            8,
                            '0'
                        )
                }${
                    manifest.extension ||
                    '.bin'
                }`;

            const result =
                await uploadChunkToDingTalk({

                    filePath:
                        tempFile,

                    filename:
                        dingFilename,

                    contentType:
                        manifest.contentType
                });

            manifest.chunks[
                index
            ] = {

                index,

                size:
                    req.file.size,

                url:
                    result.url,

                uploadedAt:
                    new Date()
                        .toISOString()
            };

            await saveManifest(
                manifest
            );

            try {

                await fs.unlink(
                    tempFile
                );

            } catch {}

            tempFile =
                null;

            return res.json({

                success:
                    true,

                index,

                size:
                    req.file.size,

                url:
                    result.url
            });

        } catch (error) {

            console.error(
                '[CHUNK ERROR]',
                error
            );

            if (
                tempFile
            ) {

                try {

                    await fs.unlink(
                        tempFile
                    );

                } catch {}
            }

            return res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        error.message
                });
        }
    }
);

/*
|--------------------------------------------------------------------------
| Complete
|--------------------------------------------------------------------------
*/

app.post(
    '/api/videos/:id/complete',
    async (
        req,
        res
    ) => {

        try {

            const manifest =
                await getManifest(
                    req.params.id
                );

            if (!manifest) {

                return res
                    .status(404)
                    .json({

                        success:
                            false,

                        error:
                            '文件不存在'
                    });
            }

            const missing = [];

            for (
                let i = 0;
                i <
                    manifest.chunkCount;
                i++
            ) {

                if (
                    !manifest.chunks[i]
                ) {

                    missing.push(
                        i
                    );
                }
            }

            if (
                missing.length
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            '还有 chunk 未上传',

                        missing
                    });
            }

            manifest.status =
                'ready';

            manifest.completedAt =
                new Date()
                    .toISOString();

            await saveManifest(
                manifest
            );

            const fileUrl =
                buildFileUrl(
                    manifest
                );

            console.log(
                `[READY] ${
                    manifest.filename
                } | ${
                    manifest.size
                } bytes | ${
                    manifest.contentType
                }`
            );

            return res.json({

                success:
                    true,

                id:
                    manifest.id,

                filename:
                    manifest.filename,

                extension:
                    manifest.extension,

                contentType:
                    manifest.contentType,

                size:
                    manifest.size,

                fileUrl,

                videoUrl:
                    fileUrl,

                /*
                 * 旧接口兼容。
                 */
                legacyUrl:
                    `/video/${manifest.id}`
            });

        } catch (error) {

            console.error(
                '[COMPLETE ERROR]',
                error
            );

            return res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        error.message
                });
        }
    }
);

/*
|--------------------------------------------------------------------------
| Parse /file/xxx.ext
|--------------------------------------------------------------------------
*/

async function getManifestFromFileRequest(
    req
) {

    let filename =
        req.path || '';

    filename =
        filename.replace(
            /^\/+/,
            ''
        );

    if (
        !filename ||
        filename.includes('/') ||
        filename.includes('\\')
    ) {

        return null;
    }

    try {

        filename =
            decodeURIComponent(
                filename
            );

    } catch {

        return null;
    }

    let id =
        filename;

    const dot =
        filename.lastIndexOf(
            '.'
        );

    if (
        dot > 0
    ) {

        id =
            filename.slice(
                0,
                dot
            );
    }

    if (
        !isValidId(
            id
        )
    ) {

        return null;
    }

    return getManifest(
        id
    );
}

/*
|--------------------------------------------------------------------------
| Common response headers
|--------------------------------------------------------------------------
*/

function getFileHeaders(
    manifest
) {

    const filename =
        sanitizeFilename(
            manifest.filename
        );

    const encodedFilename =
        encodeURIComponent(
            filename
        );

    return {

        'Content-Type':
            manifest.contentType ||
            'application/octet-stream',

        'Accept-Ranges':
            'bytes',

        'Content-Disposition':
            `inline; filename*=UTF-8''${encodedFilename}`,

        'X-Content-Type-Options':
            'nosniff',

        /*
         * 不禁止浏览器本身的媒体缓冲。
         */
        'Cache-Control':
            'public, max-age=3600'
    };
}

/*
|--------------------------------------------------------------------------
| Main file handler
|--------------------------------------------------------------------------
|
| /file/xxx.mp4
| /video/uuid
|
| 都走这里。
|
|--------------------------------------------------------------------------
*/

async function handleFileRequest(
    req,
    res,
    manifest
) {

    if (
        !manifest
    ) {

        return res
            .status(404)
            .end();
    }

    if (
        manifest.status !==
        'ready'
    ) {

        return res
            .status(409)
            .json({

                success:
                    false,

                error:
                    'File is not ready'
            });
    }

    /*
     * HEAD
     */
    if (
        req.method ===
        'HEAD'
    ) {

        return res
            .status(200)
            .set({

                ...getFileHeaders(
                    manifest
                ),

                'Content-Length':
                    String(
                        manifest.size
                    )
            })
            .end();
    }

    /*
     * Client abort controller.
     */
    const controller =
        new AbortController();

    let finished =
        false;

    const onClose =
        () => {

            /*
             * response close 可能在正常 end 后触发。
             */
            if (
                !finished &&
                !res.writableEnded
            ) {

                controller.abort();
            }
        };

    res.once(
        'close',
        onClose
    );

    try {

        let range;

        try {

            range =
                parseRange(
                    req.headers.range,
                    manifest.size
                );

        } catch {

            return res
                .status(416)
                .set(
                    'Content-Range',
                    `bytes */${manifest.size}`
                )
                .end();
        }

        /*
         * ------------------------------------------------------------
         * 没有 Range
         * ------------------------------------------------------------
         *
         * 完整文件直接流式。
         *
         * 这不是把整个文件一次性下载。
         */
        if (
            !range
        ) {

            res
                .status(200)
                .set({

                    ...getFileHeaders(
                        manifest
                    ),

                    'Content-Length':
                        String(
                            manifest.size
                        )
                });

            await streamRangeDirect({

                manifest,

                start:
                    0,

                end:
                    manifest.size - 1,

                response:
                    res,

                signal:
                    controller.signal
            });

            finished =
                true;

            return;
        }

        /*
         * ------------------------------------------------------------
         * Range
         * ------------------------------------------------------------
         */

        res
            .status(206)
            .set({

                ...getFileHeaders(
                    manifest
                ),

                'Content-Length':
                    String(
                        range.length
                    ),

                'Content-Range':
                    `bytes ${
                        range.start
                    }-${
                        range.end
                    }/${
                        manifest.size
                    }`
            });

        /*
         * 重要：
         *
         * 不再使用：
         *
         *     range.start > 0
         *       === seek
         *
         * 因为浏览器首次打开视频时，
         * 完全可能直接请求非 0 Range。
         *
         * 所以：
         *
         * 默认所有 Range 都直接流。
         *
         * 只有明确满足“短 Range seek”
         * 时才允许 cache。
         *
         * 这里用一个非常保守的条件：
         *
         * start > 0
         * && 请求长度 <= SEEK_BUFFER_SIZE
         *
         * 这样普通播放的大 Range 不会进入 Buffer。
         */
        const useSeekCache =
            SEEK_CACHE_ENABLED &&
            range.start > 0 &&
            range.length <=
                SEEK_BUFFER_SIZE;

        console.log(
            `[RANGE] ${
                manifest.filename
            } | ${
                range.start
            }-${
                range.end
            } | ${
                range.length
            } bytes | ${
                useSeekCache
                    ? 'SEEK-CACHE'
                    : 'DIRECT'
            }`
        );

        if (
            useSeekCache
        ) {

            await streamSeekRange({

                manifest,

                start:
                    range.start,

                end:
                    range.end,

                response:
                    res,

                signal:
                    controller.signal
            });

        } else {

            /*
             * 首次播放最重要的路径：
             *
             * 不缓存。
             * 不 Buffer。
             * 不等待。
             *
             * 直接：
             *
             * DingTalk → Node → Browser
             */
            await streamRangeDirect({

                manifest,

                start:
                    range.start,

                end:
                    range.end,

                response:
                    res,

                signal:
                    controller.signal
            });
        }

        finished =
            true;

    } catch (error) {

        if (
            controller.signal.aborted
        ) {

            return;
        }

        console.error(
            '[FILE ERROR]',
            error
        );

        if (
            !res.headersSent
        ) {

            return res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        error.message ||
                        'Internal Server Error'
                });
        }

        if (
            !res.destroyed
        ) {

            try {

                res.destroy(
                    error
                );

            } catch {}
        }

    } finally {

        res.off(
            'close',
            onClose
        );
    }
}

/*
|--------------------------------------------------------------------------
| /file
|--------------------------------------------------------------------------
*/

app.use(
    '/file',
    async (
        req,
        res
    ) => {

        if (
            req.method !== 'GET' &&
            req.method !== 'HEAD'
        ) {

            res.set(
                'Allow',
                'GET, HEAD'
            );

            return res
                .status(405)
                .end();
        }

        const manifest =
            await getManifestFromFileRequest(
                req
            );

        return handleFileRequest(
            req,
            res,
            manifest
        );
    }
);

/*
|--------------------------------------------------------------------------
| Legacy /video/:id
|--------------------------------------------------------------------------
*/

app.get(
    '/video/:id',
    async (
        req,
        res
    ) => {

        const manifest =
            await getManifest(
                req.params.id
            );

        return handleFileRequest(
            req,
            res,
            manifest
        );
    }
);

app.head(
    '/video/:id',
    async (
        req,
        res
    ) => {

        const manifest =
            await getManifest(
                req.params.id
            );

        return handleFileRequest(
            req,
            res,
            manifest
        );
    }
);

/*
|--------------------------------------------------------------------------
| Status
|--------------------------------------------------------------------------
*/

app.get(
    '/api/status',
    (
        req,
        res
    ) => {

        const memory =
            process.memoryUsage();

        return res.json({

            success:
                true,

            architecture: {

                upload:
                    'CHUNKED',

                storage:
                    'MANIFEST_ONLY',

                firstOpen:
                    'DIRECT_STREAM',

                range:
                    'DIRECT_STREAM',

                seek:
                    'OPTIONAL_SMALL_MEMORY_CACHE',

                diskCache:
                    false,

                fullFileMemoryCache:
                    false,

                remoteRange:
                    '206_ONLY'
            },

            chunkSize:
                CHUNK_SIZE,

            seekCacheEnabled:
                SEEK_CACHE_ENABLED,

            seekPrefetchSize:
                SEEK_PREFETCH_SIZE,

            seekBufferSize:
                SEEK_BUFFER_SIZE,

            maxSeekCacheBytes:
                MAX_SEEK_CACHE_BYTES,

            maxSeekCachePerFile:
                MAX_SEEK_CACHE_PER_FILE,

            seekCacheBytes,

            seekCacheItems:
                seekCache.size,

            globalRemoteConcurrency:
                GLOBAL_REMOTE_CONCURRENCY,

            globalRemoteActive:
                globalRemoteActive,

            globalRemoteQueued:
                globalRemoteQueue.length,

            memory: {

                rss:
                    memory.rss,

                heapUsed:
                    memory.heapUsed,

                heapTotal:
                    memory.heapTotal,

                external:
                    memory.external,

                arrayBuffers:
                    memory.arrayBuffers
            }
        });
    }
);

/*
|--------------------------------------------------------------------------
| Root
|--------------------------------------------------------------------------
*/

app.get(
    '/',
    (
        req,
        res
    ) => {

        return res.sendFile(
            path.resolve(
                './public/index.html'
            )
        );
    }
);

/*
|--------------------------------------------------------------------------
| 404
|--------------------------------------------------------------------------
*/

app.use(
    (
        req,
        res
    ) => {

        return res
            .status(404)
            .json({

                success:
                    false,

                error:
                    'Not Found'
            });
    }
);

/*
|--------------------------------------------------------------------------
| Global error
|--------------------------------------------------------------------------
*/

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        console.error(
            '[GLOBAL ERROR]',
            error
        );

        if (
            res.headersSent
        ) {

            return next(
                error
            );
        }

        return res
            .status(500)
            .json({

                success:
                    false,

                error:
                    error.message ||
                    'Internal Server Error'
            });
    }
);

/*
|--------------------------------------------------------------------------
| Cache monitor
|--------------------------------------------------------------------------
*/

setInterval(
    () => {

        if (
            seekCache.size === 0
        ) {

            return;
        }

        console.log(

            `[CACHE] items=${
                seekCache.size
            } | memory=${
                (
                    seekCacheBytes /
                    1024 /
                    1024
                ).toFixed(2)
            }MB / ${
                (
                    MAX_SEEK_CACHE_BYTES /
                    1024 /
                    1024
                ).toFixed(0)
            }MB`

        );

    },
    30000
);

/*
|--------------------------------------------------------------------------
| Start
|--------------------------------------------------------------------------
*/

app.listen(
    PORT,
    () => {

        console.log('');

        console.log(
            '=========================================='
        );

        console.log(
            ' Universal File Streaming Server'
        );

        console.log(
            '=========================================='
        );

        console.log(
            `Server: http://0.0.0.0:${PORT}`
        );

        console.log(
            `Node: ${process.version}`
        );

        console.log(
            `Chunk Size: ${
                (
                    CHUNK_SIZE /
                    1024 /
                    1024
                ).toFixed(2)
            } MB`
        );

        console.log(
            `Remote Concurrency: ${
                GLOBAL_REMOTE_CONCURRENCY
            }`
        );

        console.log(
            `Remote Timeout: ${
                REMOTE_TIMEOUT_MS
            } ms`
        );

        console.log(
            `Seek Cache: ${
                SEEK_CACHE_ENABLED
                    ? 'ON'
                    : 'OFF'
            }`
        );

        console.log(
            `Seek Buffer: ${
                (
                    SEEK_BUFFER_SIZE /
                    1024 /
                    1024
                ).toFixed(2)
            } MB`
        );

        console.log(
            `Seek Prefetch: ${
                (
                    SEEK_PREFETCH_SIZE /
                    1024 /
                    1024
                ).toFixed(2)
            } MB`
        );

        console.log(
            `Max Seek Cache: ${
                (
                    MAX_SEEK_CACHE_BYTES /
                    1024 /
                    1024
                ).toFixed(0)
            } MB`
        );

        console.log(
            'First Open: DIRECT STREAM'
        );

        console.log(
            'Range: DIRECT STREAM'
        );

        console.log(
            'Disk Cache: OFF'
        );

        console.log(
            'Full File Memory Cache: OFF'
        );

        console.log(
            'DingTalk Range: 206 ONLY'
        );

        console.log(
            'All File Formats: ON'
        );

        console.log(
            '=========================================='
        );

        console.log('');
    }
);// update Thu Sep 10 11:44:28 PM CST 2026
