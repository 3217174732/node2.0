import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

/*
|--------------------------------------------------------------------------
| 配置
|--------------------------------------------------------------------------
*/

const PORT = Number(process.env.PORT || 8080);

/*
 * 文件逻辑 chunk。
 * 上传时每个 chunk 的大小。
 */
const CHUNK_SIZE = Number(
    process.env.CHUNK_SIZE || 8 * 1024 * 1024
);

/*
 * 钉钉同时进行的最大 Range 请求数。
 * 防止多人播放时连接数失控。
 */
const GLOBAL_REMOTE_CONCURRENCY = Math.max(
    1,
    Number(process.env.GLOBAL_REMOTE_CONCURRENCY || 32)
);

/*
|--------------------------------------------------------------------------
| 拖拽 Range 缓冲
|--------------------------------------------------------------------------
|
| 首次打开：
|   完全不使用这个缓存。
|
| 拖拽：
|   才启用。
|
|--------------------------------------------------------------------------
*/

/*
 * 每次拖拽向钉钉扩大的读取范围。
 *
 * 例如浏览器只要：
 *
 *   400000000-400100000
 *
 * Node 会向钉钉请求附近更大的区域。
 */
const SEEK_PREFETCH_SIZE = Number(
    process.env.SEEK_PREFETCH_SIZE || 8 * 1024 * 1024
);

/*
 * 单个缓冲块最大大小。
 */
const SEEK_BUFFER_SIZE = Number(
    process.env.SEEK_BUFFER_SIZE || 8 * 1024 * 1024
);

/*
 * 整个服务器所有拖拽缓冲允许使用的最大内存。
 *
 * 默认 128MB。
 *
 * 超过以后自动淘汰旧缓存。
 */
const MAX_SEEK_CACHE_BYTES = Number(
    process.env.MAX_SEEK_CACHE_BYTES ||
    128 * 1024 * 1024
);

/*
 * 单个文件最多占用多少拖拽缓存。
 */
const MAX_SEEK_CACHE_PER_FILE = Number(
    process.env.MAX_SEEK_CACHE_PER_FILE ||
    16 * 1024 * 1024
);

/*
 * 是否允许拖拽缓冲。
 */
const SEEK_CACHE_ENABLED =
    String(
        process.env.SEEK_CACHE_ENABLED || 'true'
    ).toLowerCase() === 'true';

/*
 * 钉钉请求超时。
 */
const REMOTE_TIMEOUT_MS = Number(
    process.env.REMOTE_TIMEOUT_MS || 15000
);

/*
 * 钉钉上传地址。
 */
const DINGTALK_UPLOAD_URL =
    process.env.DINGTALK_UPLOAD_URL ||
    'https://h5.dingtalk.com/common/picUpload';

/*
|--------------------------------------------------------------------------
| 目录
|--------------------------------------------------------------------------
*/

const STORAGE_DIR = path.resolve('./storage');

const MANIFEST_DIR =
    path.join(STORAGE_DIR, 'manifests');

const UPLOAD_DIR =
    path.join(STORAGE_DIR, 'uploads');

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
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.opus': 'audio/opus',
    '.m4a': 'audio/mp4',
    '.wma': 'audio/x-ms-wma',

    '.mp4': 'video/mp4',
    '.m4v': 'video/x-m4v',
    '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
    '.avi': 'video/x-msvideo',
    '.wmv': 'video/x-ms-wmv',
    '.flv': 'video/x-flv',
    '.ts': 'video/mp2t',
    '.mts': 'video/mp2t',
    '.m2ts': 'video/mp2t',
    '.3gp': 'video/3gpp',
    '.3g2': 'video/3gpp2',
    '.ogv': 'video/ogg',

    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.avif': 'image/avif',

    '.pdf': 'application/pdf',

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
        'application/x-iso9660-image',

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
        'application/wasm'
};

/*
|--------------------------------------------------------------------------
| Express
|--------------------------------------------------------------------------
*/

const app = express();

app.disable('x-powered-by');

app.use(
    express.json({
        limit: '2mb'
    })
);

/*
|--------------------------------------------------------------------------
| Public
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

const upload = multer({
    dest: UPLOAD_DIR,

    limits: {
        fileSize: CHUNK_SIZE
    }
});

/*
|--------------------------------------------------------------------------
| 工具
|--------------------------------------------------------------------------
*/

function sanitizeFilename(filename) {

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
            result.slice(0, 255);
    }

    return result;
}

function getExtension(filename) {

    const safe =
        sanitizeFilename(filename);

    return (
        path.extname(safe) ||
        ''
    ).toLowerCase();
}

function getMimeType(
    filename,
    browserType
) {

    const ext =
        getExtension(filename);

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

function isValidId(id) {

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

function getManifestPath(id) {

    return path.join(
        MANIFEST_DIR,
        `${id}.json`
    );
}

async function saveManifest(manifest) {

    const target =
        getManifestPath(manifest.id);

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

async function getManifest(id) {

    if (
        !isValidId(id)
    ) {
        return null;
    }

    try {

        const data =
            await fs.readFile(
                getManifestPath(id),
                'utf8'
            );

        return JSON.parse(data);

    } catch {

        return null;

    }
}

/*
|--------------------------------------------------------------------------
| Manifest 创建
|--------------------------------------------------------------------------
*/

function createManifest({
    id,
    filename,
    size,
    contentType
}) {

    const safeFilename =
        sanitizeFilename(filename);

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
            new Date().toISOString()
    };
}

/*
|--------------------------------------------------------------------------
| URL 提取
|--------------------------------------------------------------------------
*/

function findUrl(value) {

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

    const candidates = [

        value.url,
        value.src,
        value.imageUrl,
        value.imgUrl,
        value.picUrl,
        value.downloadUrl,

        value.data?.url,
        value.data?.src,
        value.data?.imageUrl,
        value.data?.imgUrl,
        value.data?.picUrl,

        value.result?.url,
        value.result?.src,
        value.result?.imageUrl,
        value.result?.imgUrl,
        value.result?.picUrl
    ];

    for (
        const candidate of candidates
    ) {

        if (
            typeof candidate === 'string' &&
            /^https?:\/\//i.test(candidate)
        ) {
            return candidate;
        }
    }

    for (
        const child of Object.values(value)
    ) {

        const url =
            findUrl(child);

        if (url) {
            return url;
        }
    }

    return null;
}

/*
|--------------------------------------------------------------------------
| 钉钉 Header
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
| 上传到钉钉
|--------------------------------------------------------------------------
*/

async function uploadChunkToDingTalk({
    filePath,
    filename
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
                    'image/jpeg'
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
                text.slice(0, 1000)
            }`
        );
    }

    let data;

    try {

        data =
            JSON.parse(text);

    } catch {

        throw new Error(
            `DingTalk 返回非 JSON: ${
                text.slice(0, 1000)
            }`
        );
    }

    const url =
        findUrl(data);

    if (!url) {

        throw new Error(
            'DingTalk 返回结果中没有 URL'
        );
    }

    return {
        url,
        raw: data
    };
}

/*
|--------------------------------------------------------------------------
| 全局远程并发
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
| Range
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
            .exec(header);

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

    if (
        startText === ''
    ) {

        const length =
            Number(endText);

        if (
            !Number.isSafeInteger(length) ||
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
            Number(startText);

        if (
            !Number.isSafeInteger(start) ||
            start < 0
        ) {
            throw new Error(
                'Invalid Range'
            );
        }

        if (
            endText === ''
        ) {

            end =
                totalSize - 1;

        } else {

            end =
                Number(endText);
        }
    }

    if (
        !Number.isSafeInteger(end) ||
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
            end - start + 1
    };
}

/*
|--------------------------------------------------------------------------
| 钉钉 Range
|--------------------------------------------------------------------------
|
| 固定按 206。
|
| 不做 200 fallback。
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

    const release = () => {

        if (released) {
            return;
        }

        released = true;

        releaseRemoteSlot();
    };

    const onAbort = () => {

        controller.abort();
    };

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
                    once: true
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
         * 钉钉源已经确认固定返回 206。
         */
        if (
            response.status !== 206
        ) {

            release();

            throw new Error(
                `DingTalk Range 请求异常：HTTP ${
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

        clearTimeout(timer);

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
| 读取远程 Range 到 Buffer
|--------------------------------------------------------------------------
|
| 只用于“拖拽缓存”。
|
| 首次播放绝不会调用这个函数。
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

        let total = 0;

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
                    value.byteLength
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

        return Buffer.concat(
            parts,
            total
        );

    } finally {

        remote.release();
    }
}

/*
|--------------------------------------------------------------------------
| Range 缓冲区
|--------------------------------------------------------------------------
|
| LRU：
|
| 最近使用的放后面。
|
|--------------------------------------------------------------------------
*/

const seekCache = new Map();

/*
 * 总缓存字节数。
 */
let seekCacheBytes = 0;

/*
 * 缓存对象：
 *
 * {
 *   key,
 *   fileId,
 *   start,
 *   end,
 *   buffer,
 *   createdAt,
 *   lastUsed
 * }
 */

/*
|--------------------------------------------------------------------------
| Cache Key
|--------------------------------------------------------------------------
*/

function makeSeekCacheKey(
    fileId,
    start,
    end
) {

    return `${fileId}:${start}:${end}`;
}

/*
|--------------------------------------------------------------------------
| 查找覆盖当前 Range 的缓存
|--------------------------------------------------------------------------
*/

function findCoveringSeekCache(
    fileId,
    start,
    end
) {

    let found = null;

    for (
        const entry of seekCache.values()
    ) {

        if (
            entry.fileId !== fileId
        ) {
            continue;
        }

        if (
            entry.start <= start &&
            entry.end >= end
        ) {

            if (
                !found ||
                entry.lastUsed <
                    found.lastUsed
            ) {

                found = entry;
            }
        }
    }

    if (found) {

        found.lastUsed =
            Date.now();

        /*
         * LRU 移到最后。
         */
        seekCache.delete(
            found.key
        );

        seekCache.set(
            found.key,
            found
        );
    }

    return found;
}

/*
|--------------------------------------------------------------------------
| 删除缓存
|--------------------------------------------------------------------------
*/

function removeSeekCache(
    key
) {

    const entry =
        seekCache.get(key);

    if (!entry) {
        return;
    }

    seekCache.delete(key);

    seekCacheBytes =
        Math.max(
            0,
            seekCacheBytes -
                entry.buffer.length
        );
}

/*
|--------------------------------------------------------------------------
| 清理 LRU
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

        const first =
            seekCache.entries()
                .next();

        if (
            first.done
        ) {
            break;
        }

        const [
            key
        ] =
            first.value;

        removeSeekCache(
            key
        );
    }
}

/*
|--------------------------------------------------------------------------
| 当前文件缓存清理
|--------------------------------------------------------------------------
*/

function getFileSeekCacheBytes(
    fileId
) {

    let total = 0;

    for (
        const entry of seekCache.values()
    ) {

        if (
            entry.fileId === fileId
        ) {

            total +=
                entry.buffer.length;
        }
    }

    return total;
}

function evictFileSeekCache(
    fileId,
    requiredBytes = 0
) {

    while (
        getFileSeekCacheBytes(fileId) +
            requiredBytes >
            MAX_SEEK_CACHE_PER_FILE
    ) {

        let oldest = null;

        for (
            const entry of seekCache.values()
        ) {

            if (
                entry.fileId !== fileId
            ) {
                continue;
            }

            if (
                !oldest ||
                entry.lastUsed <
                    oldest.lastUsed
            ) {

                oldest = entry;
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
| 写入拖拽缓存
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
        !buffer ||
        buffer.length <= 0
    ) {
        return;
    }

    /*
     * 单个缓存不能超过限制。
     */
    if (
        buffer.length >
        SEEK_BUFFER_SIZE
    ) {

        return;
    }

    /*
     * 全局淘汰。
     */
    evictSeekCache(
        buffer.length
    );

    /*
     * 当前文件淘汰。
     */
    evictFileSeekCache(
        fileId,
        buffer.length
    );

    const key =
        makeSeekCacheKey(
            fileId,
            start,
            end
        );

    /*
     * 如果已经存在同范围，
     * 先删除旧对象。
     */
    if (
        seekCache.has(key)
    ) {

        removeSeekCache(
            key
        );
    }

    const entry = {

        key,

        fileId,

        start,

        end,

        buffer,

        createdAt:
            Date.now(),

        lastUsed:
            Date.now()
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
| 从缓存取出指定 Range
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
| 获取拖拽缓存
|--------------------------------------------------------------------------
|
| 如果命中：
|
|   直接返回。
|
| 如果没命中：
|
|   向钉钉扩大范围请求。
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
     * 先查缓存。
     */
    const hit =
        findCoveringSeekCache(
            manifest.id,
            requestedStart,
            requestedEnd
        );

    if (hit) {

        return {

            buffer:
                sliceSeekCache(
                    hit,
                    requestedStart,
                    requestedEnd
                ),

            fromCache:
                true
        };
    }

    /*
     * 以请求位置为中心/起点扩大范围。
     *
     * 不从文件头开始。
     */
    let fetchStart =
        Math.floor(
            requestedStart /
            SEEK_PREFETCH_SIZE
        ) *
        SEEK_PREFETCH_SIZE;

    /*
     * 至少覆盖用户请求。
     */
    fetchStart =
        Math.min(
            fetchStart,
            requestedStart
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
            fetchEnd,
            manifest.size - 1
        );

    /*
     * 控制单次缓冲大小。
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

    /*
     * chunk 内部偏移。
     */
    const chunkStart =
        chunkIndex *
        manifest.chunkSize;

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
     * 缓存的是“当前 chunk 的文件绝对位置”。
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
     * 找刚才写入的缓存。
     */
    const newHit =
        findCoveringSeekCache(
            manifest.id,
            requestedStart,
            requestedEnd
        );

    if (!newHit) {

        /*
         * 理论上只有缓存被限制淘汰才会发生。
         *
         * 直接切 Buffer。
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

    return {

        buffer:
            sliceSeekCache(
                newHit,
                requestedStart,
                requestedEnd
            ),

        fromCache:
            false
    };
}

/*
|--------------------------------------------------------------------------
| 直接流式发送 Range
|--------------------------------------------------------------------------
|
| 首开使用。
|
| 绝不进入 seek cache。
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

        let total = 0;

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
                    value.byteLength === 0
                ) {
                    continue;
                }

                const remaining =
                    expectedLength -
                    total;

                const length =
                    Math.min(
                        remaining,
                        value.byteLength
                    );

                const buffer =
                    Buffer.from(
                        value.buffer,
                        value.byteOffset,
                        length
                    );

                total +=
                    length;

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
            total !== expectedLength &&
            !signal.aborted
        ) {

            throw new Error(
                `DingTalk Range 数据长度异常：` +
                `期望 ${expectedLength}，` +
                `实际 ${total}`
            );
        }

    } finally {

        remote.release();
    }
}

/*
|--------------------------------------------------------------------------
| 跨 chunk 流式
|--------------------------------------------------------------------------
|
| 首开/正常播放：
|
| 仍然只请求实际需要的数据。
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
| 拖拽专用流
|--------------------------------------------------------------------------
|
| 与首开完全不同。
|
| 这里允许使用短期内存缓存。
|
|--------------------------------------------------------------------------
*/

async function streamSeekRange({
    manifest,
    start,
    end,
    response,
    signal
}) {

    /*
     * 当前拖拽范围尽量在一个 chunk 内处理。
     */
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

    /*
     * 如果跨 chunk：
     *
     * 每一个 chunk 分开处理。
     *
     * 不把多个 chunk 全部放进 RAM。
     */
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
         * 只有真正拖拽才走缓存。
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
| 文件 URL
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
| 创建文件
|--------------------------------------------------------------------------
*/

app.post(
    '/api/videos',
    async (req, res) => {

        try {

            const {
                filename,
                size,
                contentType
            } = req.body;

            if (
                typeof filename !== 'string' ||
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
                !Number.isSafeInteger(size) ||
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
                `[CREATE] ${manifest.filename} | ${manifest.size} bytes`
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
| 查询文件
|--------------------------------------------------------------------------
*/

app.get(
    '/api/videos/:id',
    async (req, res) => {

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
                    (a, b) => a - b
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
| 上传 chunk
|--------------------------------------------------------------------------
*/

app.post(
    '/api/videos/:id/chunks/:index',
    upload.single('picFile'),
    async (req, res) => {

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
                await getManifest(id);

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
                !Number.isInteger(index) ||
                index < 0 ||
                index >= manifest.chunkCount
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
                req.file.size !== expectedSize
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            `chunk 大小错误：期望 ${expectedSize}，实际 ${req.file.size}`
                    });
            }

            if (
                manifest.chunks[index]
            ) {

                const existing =
                    manifest.chunks[index];

                try {
                    await fs.unlink(
                        tempFile
                    );
                } catch {}

                tempFile = null;

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
                `[UPLOAD] ${manifest.filename} | chunk ${index}/${manifest.chunkCount - 1} | ${req.file.size} bytes`
            );

            /*
             * 上传到钉钉内部仍然是 jpg。
             *
             * 原始文件扩展名只用于我们自己的 /file/ URL。
             */
            const dingFilename =
                `chunk_${
                    String(index)
                        .padStart(8, '0')
                }.jpg`;

            const result =
                await uploadChunkToDingTalk({

                    filePath:
                        tempFile,

                    filename:
                        dingFilename
                });

            manifest.chunks[index] = {

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

            tempFile = null;

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

            if (tempFile) {

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
| 完成上传
|--------------------------------------------------------------------------
*/

app.post(
    '/api/videos/:id/complete',
    async (req, res) => {

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
                i < manifest.chunkCount;
                i++
            ) {

                if (
                    !manifest.chunks[i]
                ) {

                    missing.push(i);
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
| 从 /file/xxx.ext 获取 manifest
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
        filename.lastIndexOf('.');

    if (dot > 0) {

        id =
            filename.slice(
                0,
                dot
            );
    }

    if (
        !isValidId(id)
    ) {

        return null;
    }

    return getManifest(id);
}

/*
|--------------------------------------------------------------------------
| 文件请求
|--------------------------------------------------------------------------
*/

async function handleFileRequest(
    req,
    res
) {

    const manifest =
        await getManifestFromFileRequest(
            req
        );

    if (!manifest) {

        return res
            .status(404)
            .json({

                success:
                    false,

                error:
                    'Not Found'
            });
    }

    if (
        manifest.status !== 'ready'
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

    if (
        req.method === 'HEAD'
    ) {

        return res
            .status(200)
            .set({

                'Content-Type':
                    manifest.contentType,

                'Content-Length':
                    String(
                        manifest.size
                    ),

                'Accept-Ranges':
                    'bytes',

                'Cache-Control':
                    'no-cache'
            })
            .end();
    }

    const controller =
        new AbortController();

    const onClose =
        () => {

            if (
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

        const filename =
            sanitizeFilename(
                manifest.filename
            );

        const encodedFilename =
            encodeURIComponent(
                filename
            );

        const contentType =
            manifest.contentType ||
            'application/octet-stream';

        const baseHeaders = {

            'Content-Type':
                contentType,

            'Accept-Ranges':
                'bytes',

            'Content-Disposition':
                `inline; filename*=UTF-8''${encodedFilename}`,

            'X-Content-Type-Options':
                'nosniff',

            'Cache-Control':
                'no-cache, no-store, must-revalidate',

            'Pragma':
                'no-cache',

            'Expires':
                '0'
        };

        /*
         * 没有 Range。
         *
         * 直接完整流式。
         */
        if (!range) {

            res
                .status(200)
                .set({

                    ...baseHeaders,

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

            return;
        }

        /*
         * 判断是不是“拖拽/seek”。
         *
         * 首次打开一般从 0 开始。
         *
         * 只有：
         *
         * 1. start > 0
         *
         * 或
         *
         * 2. Range 明显跳跃
         *
         * 才使用 seek cache。
         *
         * 这样首开不会触碰缓存系统。
         */
        const isSeekRequest =
            range.start > 0;

        res
            .status(206)
            .set({

                ...baseHeaders,

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
                isSeekRequest
                    ? 'SEEK'
                    : 'START'
            }`
        );

        /*
         * 首次 Range：
         *
         * 直接流式。
         *
         * 不缓存。
         */
        if (
            !isSeekRequest ||
            !SEEK_CACHE_ENABLED
        ) {

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

            return;
        }

        /*
         * 拖拽：
         *
         * 专用 Range 缓冲。
         */
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

            res.destroy(
                error
            );
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
    async (req, res) => {

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

        return handleFileRequest(
            req,
            res
        );
    }
);

/*
|--------------------------------------------------------------------------
| 兼容旧 /video/:id
|--------------------------------------------------------------------------
*/

async function handleLegacyVideo(
    req,
    res
) {

    const manifest =
        await getManifest(
            req.params.id
        );

    if (!manifest) {

        return res
            .status(404)
            .end();
    }

    if (
        manifest.status !== 'ready'
    ) {

        return res
            .status(409)
            .end();
    }

    const controller =
        new AbortController();

    const onClose =
        () => {

            if (
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

        if (!range) {

            res
                .status(200)
                .set({

                    'Content-Type':
                        manifest.contentType,

                    'Content-Length':
                        String(
                            manifest.size
                        ),

                    'Accept-Ranges':
                        'bytes',

                    'Cache-Control':
                        'no-cache'
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

            return;
        }

        res
            .status(206)
            .set({

                'Content-Type':
                    manifest.contentType,

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
                    }`,

                'Accept-Ranges':
                    'bytes',

                'Cache-Control':
                    'no-cache'
            });

        if (
            range.start > 0 &&
            SEEK_CACHE_ENABLED
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

    } catch (error) {

        if (
            controller.signal.aborted
        ) {

            return;
        }

        console.error(
            '[VIDEO ERROR]',
            error
        );

        if (
            !res.headersSent
        ) {

            res
                .status(500)
                .end();

        } else if (
            !res.destroyed
        ) {

            res.destroy(error);
        }

    } finally {

        res.off(
            'close',
            onClose
        );
    }
}

app.get(
    '/video/:id',
    handleLegacyVideo
);

app.head(
    '/video/:id',
    async (req, res) => {

        const manifest =
            await getManifest(
                req.params.id
            );

        if (!manifest) {

            return res
                .status(404)
                .end();
        }

        return res
            .status(200)
            .set({

                'Content-Type':
                    manifest.contentType,

                'Content-Length':
                    String(
                        manifest.size
                    ),

                'Accept-Ranges':
                    'bytes'
            })
            .end();
    }
);

/*
|--------------------------------------------------------------------------
| 状态
|--------------------------------------------------------------------------
*/

app.get(
    '/api/status',
    (req, res) => {

        const memory =
            process.memoryUsage();

        return res.json({

            success:
                true,

            architecture: {

                firstOpen:
                    'DIRECT_STREAM',

                seek:
                    'RANGE_MEMORY_BUFFER',

                diskCache:
                    false,

                fullFileMemoryCache:
                    false,

                range:
                    true,

                status206:
                    true,

                directStreaming:
                    true
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
| 首页
|--------------------------------------------------------------------------
*/

app.get(
    '/',
    (req, res) => {

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
    (req, res) => {

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
| 全局错误
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

            return next(error);
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
| 定期打印缓存状态
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
| 启动
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
            '   Universal Range Streaming Server'
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
            `Max Cache / File: ${
                (
                    MAX_SEEK_CACHE_PER_FILE /
                    1024 /
                    1024
                ).toFixed(0)
            } MB`
        );

        console.log(
            `Remote Concurrency: ${
                GLOBAL_REMOTE_CONCURRENCY
            }`
        );

        console.log(
            `Seek Cache: ${
                SEEK_CACHE_ENABLED
                    ? 'ON'
                    : 'OFF'
            }`
        );

        console.log(
            'First Open: DIRECT STREAM'
        );

        console.log(
            'Seek: MEMORY RANGE BUFFER'
        );

        console.log(
            'Disk Cache: OFF'
        );

        console.log(
            'Full File Cache: OFF'
        );

        console.log(
            'DingTalk Range: 206 ONLY'
        );

        console.log(
            'Original Extension: ON'
        );

        console.log(
            '=========================================='
        );

        console.log('');
    }
);