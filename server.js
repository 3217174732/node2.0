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
    process.env.PORT || 8020
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
 * 单个 DingTalk Range 请求超时。
 *
 * 注意：
 *
 * 这是单个 HTTP 请求的超时时间，
 * 不是整个视频播放的超时时间。
 *
 * 只要请求本身没有超时，
 * 数据可以持续流式返回。
 */
const REMOTE_TIMEOUT_MS = Math.max(
    3000,
    Number(
        process.env.REMOTE_TIMEOUT_MS ||
        30000
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

    /*
     * 当前代理只支持单 Range。
     *
     * 例如：
     *
     * bytes=0-999
     * bytes=1000-
     * bytes=-1000
     */
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
     *
     * 最后 500 bytes。
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

            if (
                !Number.isSafeInteger(
                    end
                )
            ) {

                throw new Error(
                    'Invalid Range'
                );
            }
        }
    }

    if (
        start >= totalSize ||
        end < start
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
| Direct DingTalk Range
|--------------------------------------------------------------------------
|
| 这里是整个项目最重要的部分。
|
| 浏览器：
|
|     Range: bytes=100-999
|
| Node：
|
|     Range: bytes=100-999
|
| DingTalk：
|
|     206 Partial Content
|
| Node：
|
|     立即把 body 流给浏览器。
|
| 不缓存。
| 不共享。
| 不合并。
| 不排队。
|
|--------------------------------------------------------------------------
*/

async function fetchDingTalkRange({
    url,
    start,
    end,
    signal
}) {

    const controller =
        new AbortController();

    let timer = null;

    let aborted =
        false;

    const onAbort =
        () => {

            aborted =
                true;

            try {

                controller.abort();

            } catch {}
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
                    once:
                        true
                }
            );
        }
    }

    timer =
        setTimeout(
            () => {

                try {

                    controller.abort();

                } catch {}

            },
            REMOTE_TIMEOUT_MS
        );

    try {

        /*
         * 每个用户请求独立创建一个 fetch。
         */
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

        if (
            aborted
        ) {

            throw new Error(
                'Client disconnected'
            );
        }

        /*
         * Range 请求必须得到 206。
         *
         * 不能把 200 当成 206。
         */
        if (
            response.status !== 206
        ) {

            /*
             * 尽量读取少量错误内容，
             * 方便日志排查。
             */
            let detail = '';

            try {

                detail =
                    await response.text();

                detail =
                    detail.slice(
                        0,
                        500
                    );

            } catch {}

            throw new Error(
                `DingTalk Range 请求失败：HTTP ${
                    response.status
                }，期望 206${
                    detail
                        ? ` | ${detail}`
                        : ''
                }`
            );
        }

        /*
         * 必须存在 body。
         */
        if (
            !response.body
        ) {

            throw new Error(
                'DingTalk response body 不存在'
            );
        }

        return {

            response,

            controller
        };

    } finally {

        if (timer) {

            clearTimeout(
                timer
            );
        }

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
| Direct Stream
|--------------------------------------------------------------------------
|
| 将 DingTalk response body 直接流给当前用户。
|
| 注意：
|
| 不使用：
|
|     arrayBuffer()
|
| 不使用：
|
|     Buffer.concat()
|
| 不保存整个 Range。
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

    const reader =
        remote.response
            .body
            .getReader();

    let total =
        0;

    try {

        while (true) {

            /*
             * 当前浏览器已经关闭。
             */
            if (
                signal.aborted ||
                response.destroyed
            ) {

                try {

                    await reader.cancel();

                } catch {}

                try {

                    remote.controller.abort();

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

            /*
             * 防止上游返回超过 Range
             * 的数据。
             */
            const remaining =
                expectedLength -
                total;

            if (
                remaining <= 0
            ) {

                break;
            }

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

            /*
             * 立即发给当前用户。
             */
            if (
                !response.write(
                    buffer
                )
            ) {

                /*
                 * 浏览器 / Node 下游速度较慢，
                 * 暂停读取上游。
                 *
                 * 这就是正常的 backpressure。
                 */
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

        /*
         * 上游少发数据，
         * 不能认为成功。
         */
        if (
            total !==
                expectedLength &&
            !signal.aborted &&
            !response.destroyed
        ) {

            throw new Error(
                `DingTalk Range 数据长度异常：期望 ${
                    expectedLength
                }，实际 ${
                    total
                }`
            );
        }

    } finally {

        try {

            reader.releaseLock();

        } catch {}

        /*
         * 如果客户端已经断开，
         * 确保上游 fetch 一起取消。
         */
        if (
            signal.aborted ||
            response.destroyed
        ) {

            try {

                remote.controller.abort();

            } catch {}
        }
    }
}

/*
|--------------------------------------------------------------------------
| Direct File Stream
|--------------------------------------------------------------------------
|
| 一个用户的请求可能跨越多个 DingTalk chunk。
|
| 例如：
|
| Browser：
|
|     bytes=7000000-10000000
|
| 而我们的文件：
|
|     chunk 0 = 0-8388607
|     chunk 1 = 8388608-16777215
|
| 那么：
|
|     DingTalk chunk 0
|         7000000-8388607
|
|     然后
|
|     DingTalk chunk 1
|         0-1611392
|
| 两个请求依次直接发送。
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

        /*
         * 转换成 DingTalk 这个 chunk
         * 内部的 Range。
         */
        const remoteStart =
            actualStart -
            chunkStart;

        const remoteEnd =
            actualEnd -
            chunkStart;

        const expectedLength =
            actualEnd -
            actualStart +
            1;

        console.log(
            `[REMOTE] ${
                manifest.filename
            } | client=${
                start
            }-${
                end
            } | chunk=${
                index
            } | remote=${
                remoteStart
            }-${
                remoteEnd
            }`
        );

        /*
         * 当前 chunk：
         *
         * DingTalk → Node → 当前用户
         */
        await streamRemoteRange({

            url:
                chunk.url,

            remoteStart,

            remoteEnd,

            response,

            expectedLength,

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
| Create Video
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
                        error.message ||
                        'Internal Server Error'
                });
        }
    }
);

/*
|--------------------------------------------------------------------------
| Query Video
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
| Upload Chunk
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
                        error.message ||
                        'Internal Server Error'
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
                        error.message ||
                        'Internal Server Error'
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
| Response Headers
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
         * 明确不让 Node / 浏览器把这个代理
         * 当成我们的缓存。
         *
         * 注意：
         * 这不会禁止 video 标签自身的播放缓冲。
         */
        'Cache-Control':
            'no-store, no-cache, must-revalidate, proxy-revalidate',

        'Pragma':
            'no-cache',

        'Expires':
            '0'
    };
}

/*
|--------------------------------------------------------------------------
| Main File Handler
|--------------------------------------------------------------------------
*/

async function handleFileRequest(
    req,
    res,
    manifest
) {

    if (!manifest) {

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
     * 每一个浏览器请求拥有自己的
     * AbortController。
     */
    const controller =
        new AbortController();

    let finished =
        false;

    const onClose =
        () => {

            /*
             * 正常 response.end() 后的 close
             * 不应该再次 abort。
             */
            if (
                !finished &&
                !res.writableEnded
            ) {

                console.log(
                    `[CLIENT CLOSE] ${
                        manifest.filename
                    }`
                );

                try {

                    controller.abort();

                } catch {}
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

        } catch (error) {

            console.warn(
                `[RANGE 416] ${
                    manifest.filename
                } | ${
                    req.headers.range || ''
                } | ${
                    error.message
                }`
            );

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
         * 仍然按照 DingTalk chunk 一个一个转发。
         *
         * 不会把整个文件读进内存。
         */
        if (!range) {

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

            console.log(
                `[FULL] ${
                    manifest.filename
                } | ${
                    manifest.size
                } bytes | DIRECT`
            );

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

        console.log(
            `[RANGE] ${
                manifest.filename
            } | ${
                range.start
            }-${
                range.end
            } | ${
                range.length
            } bytes | DIRECT`
        );

        /*
         * ------------------------------------------------------------
         * 核心：
         *
         * 所有 Range 都直接代理。
         *
         * 没有：
         *
         *     seek cache
         *     shared cache
         *     prefetch
         *     inflight merge
         *     global queue
         *
         * 一个用户一个请求。
         * 一个请求一个 DingTalk fetch。
         * ------------------------------------------------------------
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

        finished =
            true;

    } catch (error) {

        /*
         * 用户自己关闭页面。
         */
        if (
            controller.signal.aborted
        ) {

            return;
        }

        console.error(
            '[FILE ERROR]',
            error
        );

        /*
         * 还没有发送 HTTP header。
         */
        if (
            !res.headersSent
        ) {

            return res
                .status(502)
                .json({

                    success:
                        false,

                    error:
                        error.message ||
                        'Upstream streaming error'
                });
        }

        /*
         * 已经开始发送视频数据，
         * 此时不能再修改 HTTP 状态码。
         *
         * 直接关闭当前连接。
         */
        if (
            !res.destroyed
        ) {

            try {

                res.destroy();

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
                    'DIRECT_STREAM',

                sharedCache:
                    false,

                seekCache:
                    false,

                diskCache:
                    false,

                fullFileMemoryCache:
                    false,

                globalRemoteQueue:
                    false,

                globalRemoteConcurrencyLimit:
                    false,

                remoteRange:
                    '206_ONLY'
            },

            chunkSize:
                CHUNK_SIZE,

            remoteTimeout:
                REMOTE_TIMEOUT_MS,

            /*
             * 当前 Node 没有主动限制
             * DingTalk 播放并发。
             *
             * 每个 HTTP 请求独立 fetch。
             */
            remoteProxyMode:
                'ONE_REQUEST_TO_ONE_UPSTREAM_REQUEST',

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
            ' Direct Range Proxy Mode'
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
            `Remote Timeout: ${
                REMOTE_TIMEOUT_MS
            } ms`
        );

        console.log(
            'Shared Cache: OFF'
        );

        console.log(
            'Seek Cache: OFF'
        );

        console.log(
            'Prefetch: OFF'
        );

        console.log(
            'Global Remote Queue: OFF'
        );

        console.log(
            'Remote Concurrency Limit: OFF'
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
);
