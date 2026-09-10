import 'dotenv/config';

import express from 'express';
import multer from 'multer';

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';


/*
|--------------------------------------------------------------------------
| 基础配置
|--------------------------------------------------------------------------
*/

const PORT = Number(
    process.env.PORT || 3000
);

const CHUNK_SIZE = Number(
    process.env.CHUNK_SIZE ||
    5 * 1024 * 1024
);

const DINGTALK_UPLOAD_URL =
    process.env.DINGTALK_UPLOAD_URL ||
    'https://h5.dingtalk.com/common/picUpload';


/*
|--------------------------------------------------------------------------
| 存储目录
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


/*
|--------------------------------------------------------------------------
| 初始化目录
|--------------------------------------------------------------------------
*/

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
| Express
|--------------------------------------------------------------------------
*/

const app = express();


app.use(
    express.json({
        limit: '2mb'
    })
);


/*
|--------------------------------------------------------------------------
| 前端静态文件
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
|
| chunk 先保存到临时文件。
|
| 不直接把 5MB 文件长期放在内存。
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
| Manifest 文件
|--------------------------------------------------------------------------
|
| 不使用数据库。
|
| 一个视频对应一个 JSON 文件。
|--------------------------------------------------------------------------
*/

function getManifestPath(id) {

    return path.join(
        MANIFEST_DIR,
        `${id}.json`
    );

}


/*
|--------------------------------------------------------------------------
| 保存 Manifest
|--------------------------------------------------------------------------
*/

async function saveManifest(
    manifest
) {

    const target =
        getManifestPath(
            manifest.id
        );

    const temp =
        `${target}.tmp`;


    await fs.writeFile(

        temp,

        JSON.stringify(
            manifest,
            null,
            2
        ),

        'utf8'

    );


    /*
     * 原子替换。
     *
     * 避免写 JSON 时服务器突然崩溃
     * 导致原文件损坏。
     */
    await fs.rename(
        temp,
        target
    );

}


/*
|--------------------------------------------------------------------------
| 获取 Manifest
|--------------------------------------------------------------------------
*/

async function getManifest(id) {

    try {

        const file =
            getManifestPath(id);


        const data =
            await fs.readFile(
                file,
                'utf8'
            );


        return JSON.parse(data);

    } catch {

        return null;

    }

}


/*
|--------------------------------------------------------------------------
| 创建 Manifest
|--------------------------------------------------------------------------
*/

function createManifest({

    id,

    filename,

    size,

    contentType

}) {

    const chunkCount =
        Math.ceil(
            size /
            CHUNK_SIZE
        );


    return {

        id,

        filename,

        size,

        contentType:
            contentType ||
            'video/mp4',

        chunkSize:
            CHUNK_SIZE,

        chunkCount,

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
| 递归寻找 URL
|--------------------------------------------------------------------------
|
| 钉钉返回格式如果有变化，
| 尽可能自动寻找 URL。
|--------------------------------------------------------------------------
*/

function findUrl(value) {

    /*
     * 本身就是字符串
     */
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


    /*
     * 非对象
     */
    if (
        !value ||
        typeof value !== 'object'
    ) {

        return null;

    }


    /*
     * 优先检查常见字段
     */
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

        value.result?.url,

        value.result?.src,

        value.result?.imageUrl,

        value.result?.imgUrl

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


    /*
     * 如果上面没找到，
     * 递归整个对象。
     */
    for (
        const child of Object.values(value)
    ) {

        const result =
            findUrl(child);


        if (result) {

            return result;

        }

    }


    return null;

}


/*
|--------------------------------------------------------------------------
| 上传 chunk 到钉钉
|--------------------------------------------------------------------------
*/

async function uploadChunkToDingTalk({

    filePath,

    filename

}) {

    /*
     * 读取当前 5MB chunk。
     *
     * 注意：
     *
     * 这里没有对二进制内容进行任何处理。
     */
    const buffer =
        await fs.readFile(
            filePath
        );


    /*
     * 伪装成 JPEG。
     *
     * 实际内容仍然是视频二进制。
     */
    const blob =
        new Blob(

            [buffer],

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


    /*
     * 请求头
     */
    const headers = {

        'User-Agent':
            'Mozilla/5.0',

        'Referer':
            'https://www.dingtalk.com'

    };


    /*
     * 可选 Cookie
     */
    if (
        process.env.DINGTALK_COOKIE
    ) {

        headers.Cookie =
            process.env.DINGTALK_COOKIE;

    }


    /*
     * 可选 Token
     */
    if (
        process.env.DINGTALK_TOKEN
    ) {

        headers.Authorization =
            `Bearer ${
                process.env.DINGTALK_TOKEN
            }`;

    }


    console.log(
        '[DINGTALK] 上传:',
        filename
    );


    /*
     * 请求钉钉
     */
    const response =
        await fetch(

            DINGTALK_UPLOAD_URL,

            {

                method:
                    'POST',

                headers,

                body:
                    form,

                redirect:
                    'follow'

            }

        );


    const text =
        await response.text();


    /*
     * HTTP 错误
     */
    if (
        !response.ok
    ) {

        throw new Error(

            `钉钉 HTTP ${
                response.status
            }: ${text}`

        );

    }


    /*
     * 解析 JSON
     */
    let data;


    try {

        data =
            JSON.parse(text);

    } catch {

        throw new Error(

            `钉钉返回的不是 JSON: ${text}`

        );

    }


    /*
     * 找 URL
     */
    const url =
        findUrl(data);


    if (!url) {

        throw new Error(

            `钉钉返回数据中没有找到 URL: ${
                text
            }`

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
| Range 解析
|--------------------------------------------------------------------------
|
| 例如：
|
| bytes=0-999
| bytes=1000-2000
| bytes=1000-
| bytes=-1000
|--------------------------------------------------------------------------
*/

function parseRange(
    header,
    totalSize
) {

    /*
     * 浏览器没有 Range。
     */
    if (!header) {

        return null;

    }


    const match =
        header.match(
            /^bytes=(\d*)-(\d*)$/
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
     * 表示最后 500 个字节。
     */
    if (!startText) {

        const length =
            Number(endText);


        if (
            !Number.isInteger(length) ||
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

        /*
         * bytes=500-
         */
        start =
            Number(startText);


        /*
         * bytes=500-1000
         */
        if (endText) {

            end =
                Number(endText);

        } else {

            end =
                totalSize - 1;

        }

    }


    /*
     * 验证
     */
    if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
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
            end - start + 1

    };

}


/*
|--------------------------------------------------------------------------
| 等待 Node.js Response drain
|--------------------------------------------------------------------------
*/

function waitDrain(
    response
) {

    return new Promise(
        resolve => {

            response.once(
                'drain',
                resolve
            );

        }
    );

}


/*
|--------------------------------------------------------------------------
| 获取远程 chunk
|--------------------------------------------------------------------------
*/

async function fetchRemoteChunk(
    url
) {

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


    const response =
        await fetch(

            url,

            {

                method:
                    'GET',

                headers,

                redirect:
                    'follow'

            }

        );


    if (!response.ok) {

        throw new Error(

            `远程 chunk HTTP ${
                response.status
            }`

        );

    }


    if (!response.body) {

        throw new Error(
            '远程服务器没有返回数据'
        );

    }


    return response.body;

}


/*
|--------------------------------------------------------------------------
| 输出远程 Stream 的指定部分
|--------------------------------------------------------------------------
|
| 假设远程 chunk 是：
|
| [-------------------- 5MB --------------------]
|
| 但是浏览器只需要：
|
|          [--------- 某一段 --------]
|
| skip 就是需要跳过多少字节。
|--------------------------------------------------------------------------
*/

async function pipePartialStream({

    body,

    skip,

    length,

    response

}) {

    const reader =
        body.getReader();


    let skipped = 0;

    let sent = 0;


    try {

        while (true) {

            /*
             * 浏览器已经断开。
             */
            if (
                response.destroyed
            ) {

                await reader.cancel();

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


            if (!value) {

                continue;

            }


            let offset = 0;


            /*
             * 跳过前面的字节
             */
            if (
                skipped < skip
            ) {

                const skipNow =
                    Math.min(

                        value.length,

                        skip -
                        skipped

                    );


                skipped +=
                    skipNow;


                offset =
                    skipNow;

            }


            /*
             * 输出需要的数据
             */
            if (
                sent < length &&
                offset < value.length
            ) {

                const remaining =
                    length -
                    sent;


                const available =
                    value.length -
                    offset;


                const count =
                    Math.min(

                        remaining,

                        available

                    );


                const chunk =
                    value.subarray(

                        offset,

                        offset +
                        count

                    );


                const ok =
                    response.write(
                        chunk
                    );


                sent +=
                    count;


                /*
                 * Node.js 缓冲区满了，
                 * 等待 drain。
                 */
                if (!ok) {

                    await waitDrain(
                        response
                    );

                }

            }


            /*
             * 当前 chunk 所需部分已经发送完。
             */
            if (
                sent >= length
            ) {

                await reader.cancel();

                return;

            }

        }

    } finally {

        reader.releaseLock();

    }

}


/*
|--------------------------------------------------------------------------
| 虚拟文件读取
|--------------------------------------------------------------------------
|
| 这是最重要的函数。
|
| 它把：
|
| URL0
| URL1
| URL2
| URL3
|
| 在逻辑上拼成：
|
| video.mp4
|--------------------------------------------------------------------------
*/

async function streamVirtualFile({

    manifest,

    start,

    end,

    response

}) {

    const chunkSize =
        manifest.chunkSize;


    /*
     * 第一个 chunk
     */
    const firstChunk =
        Math.floor(
            start /
            chunkSize
        );


    /*
     * 最后一个 chunk
     */
    const lastChunk =
        Math.floor(
            end /
            chunkSize
        );


    console.log(

        `[STREAM] ` +
        `${start}-${end} ` +
        `chunks ${firstChunk}-${lastChunk}`

    );


    /*
     * 依次处理 chunk。
     */
    for (

        let index =
            firstChunk;

        index <= lastChunk;

        index++

    ) {

        /*
         * 浏览器已经取消请求。
         */
        if (
            response.destroyed
        ) {

            return;

        }


        const chunk =
            manifest.chunks[index];


        if (!chunk) {

            throw new Error(

                `Chunk ${index} 不存在`

            );

        }


        /*
         * 当前 chunk 在虚拟文件中的起始位置。
         */
        const chunkStart =
            index *
            chunkSize;


        /*
         * 当前 chunk 在虚拟文件中的结束位置。
         */
        const chunkEnd =
            chunkStart +
            chunk.size -
            1;


        /*
         * 当前 Range 和 chunk 的交集。
         */
        const readStart =
            Math.max(

                start,

                chunkStart

            );


        const readEnd =
            Math.min(

                end,

                chunkEnd

            );


        /*
         * 转换为当前 chunk 内部偏移。
         */
        const remoteStart =
            readStart -
            chunkStart;


        const remoteEnd =
            readEnd -
            chunkStart;


        const length =
            remoteEnd -
            remoteStart +
            1;


        console.log(

            `[STREAM] ` +
            `chunk=${index} ` +
            `remote=${remoteStart}-${remoteEnd}`

        );


        /*
         * 下载这个远程 chunk。
         */
        const body =
            await fetchRemoteChunk(
                chunk.url
            );


        /*
         * 只输出需要的部分。
         */
        await pipePartialStream({

            body,

            skip:
                remoteStart,

            length,

            response

        });

    }


    /*
     * 所有 chunk 都输出完成。
     */
    if (
        !response.destroyed
    ) {

        response.end();

    }

}


/*
|--------------------------------------------------------------------------
| API：创建视频
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
            } =
                req.body;


            /*
             * 参数验证
             */
            if (
                typeof filename !== 'string' ||
                !filename ||
                !Number.isInteger(size) ||
                size <= 0
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            'filename 或 size 参数错误'

                    });

            }


            /*
             * 创建唯一 ID
             */
            const id =
                crypto.randomUUID();


            /*
             * 创建 manifest
             */
            const manifest =
                createManifest({

                    id,

                    filename,

                    size,

                    contentType

                });


            /*
             * 保存 JSON
             */
            await saveManifest(
                manifest
            );


            console.log(
                `[CREATE] ${id} ${filename}`
            );


            res.json({

                success:
                    true,

                id,

                filename,

                size,

                chunkSize:
                    CHUNK_SIZE,

                chunkCount:
                    manifest.chunkCount

            });

        } catch (error) {

            console.error(
                '[CREATE ERROR]',
                error
            );


            res
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
| API：查询视频上传状态
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
                        '视频不存在'

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


        res.json({

            success:
                true,

            id:
                manifest.id,

            filename:
                manifest.filename,

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
| API：上传 chunk
|--------------------------------------------------------------------------
|
| POST:
|
| /api/videos/:id/chunks/:index
|
| FormData:
|
| picFile
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


            /*
             * 检查文件
             */
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


            /*
             * 获取 manifest
             */
            const manifest =
                await getManifest(id);


            if (!manifest) {

                return res
                    .status(404)
                    .json({

                        success:
                            false,

                        error:
                            '视频不存在'

                    });

            }


            /*
             * 验证 index
             */
            if (
                !Number.isInteger(index) ||
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


            /*
             * 计算当前 chunk 应该有多大。
             *
             * 除了最后一个 chunk，
             * 其他全部必须是 5MB。
             */
            const expectedSize =

                index ===
                manifest.chunkCount - 1

                    ?

                    manifest.size -
                    index *
                    manifest.chunkSize

                    :

                    manifest.chunkSize;


            /*
             * 检查大小。
             */
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
                            `chunk 大小错误，` +
                            `期望 ${expectedSize}，` +
                            `实际 ${req.file.size}`

                    });

            }


            /*
             * 生成伪装文件名。
             *
             * 注意：
             *
             * 内容仍然是原始视频数据。
             */
            const fakeFilename =

                `chunk_${
                    String(index)
                        .padStart(8, '0')
                }.jpg`;


            console.log(
                `[UPLOAD] ${id} chunk=${index}`
            );


            /*
             * 上传到钉钉。
             */
            const result =
                await uploadChunkToDingTalk({

                    filePath:
                        tempFile,

                    filename:
                        fakeFilename

                });


            /*
             * 保存远程 URL。
             */
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


            /*
             * 保存 manifest。
             */
            await saveManifest(
                manifest
            );


            /*
             * 删除临时 chunk。
             */
            await fs.unlink(
                tempFile
            );


            tempFile = null;


            res.json({

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


            /*
             * 出错时清理临时文件。
             */
            if (tempFile) {

                try {

                    await fs.unlink(
                        tempFile
                    );

                } catch {}

            }


            res
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
| API：完成视频
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
                            '视频不存在'

                    });

            }


            /*
             * 检查所有 chunk。
             */
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

                    missing.push(i);

                }

            }


            /*
             * 有缺失 chunk。
             */
            if (
                missing.length > 0
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            '还有 chunk 没上传',

                        missing

                    });

            }


            /*
             * 标记完成。
             */
            manifest.status =
                'ready';


            manifest.completedAt =
                new Date()
                    .toISOString();


            await saveManifest(
                manifest
            );


            /*
             * 返回虚拟文件 URL。
             */
            res.json({

                success:
                    true,

                id:
                    manifest.id,

                filename:
                    manifest.filename,

                size:
                    manifest.size,

                videoUrl:
                    `/video/${manifest.id}`

            });


        } catch (error) {

            console.error(
                '[COMPLETE ERROR]',
                error
            );


            res
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
| 虚拟视频文件
|--------------------------------------------------------------------------
|
| 访问：
|
| /video/:id
|
| 对浏览器来说：
|
| 它就是一个完整 MP4。
|
| 实际上：
|
| Node.js -> 钉钉 URL0
|          -> 钉钉 URL1
|          -> 钉钉 URL2
|          -> ...
|--------------------------------------------------------------------------
*/

app.get(
    '/video/:id',
    async (req, res) => {

        try {

            const manifest =
                await getManifest(
                    req.params.id
                );


            /*
             * 不存在
             */
            if (!manifest) {

                return res
                    .status(404)
                    .end();

            }


            /*
             * 尚未完成
             */
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
                            '视频尚未上传完成'

                    });

            }


            /*
             * 解析 Range。
             */
            const range =
                parseRange(

                    req.headers.range,

                    manifest.size

                );


            /*
             * 没有 Range。
             *
             * 返回整个虚拟文件。
             */
            if (!range) {

                res.status(200);


                res.set({

                    'Content-Type':
                        manifest.contentType,

                    'Content-Length':
                        String(
                            manifest.size
                        ),

                    'Accept-Ranges':
                        'bytes',

                    'Content-Disposition':
                        `inline; filename="${encodeURIComponent(
                            manifest.filename
                        )}"`

                });


                await streamVirtualFile({

                    manifest,

                    start:
                        0,

                    end:
                        manifest.size - 1,

                    response:
                        res

                });


                return;

            }


            /*
             * Range 请求。
             *
             * 必须返回 206。
             */
            res.status(206);


            res.set({

                'Content-Type':
                    manifest.contentType,

                'Content-Length':
                    String(
                        range.length
                    ),

                'Content-Range':
                    `bytes ${range.start}-${range.end}/${manifest.size}`,

                'Accept-Ranges':
                    'bytes',

                'Content-Disposition':
                    `inline; filename="${encodeURIComponent(
                        manifest.filename
                    )}"`

            });


            /*
             * 开始虚拟读取。
             */
            await streamVirtualFile({

                manifest,

                start:
                    range.start,

                end:
                    range.end,

                response:
                    res

            });

        } catch (error) {

            console.error(
                '[VIDEO ERROR]',
                error
            );


            /*
             * 如果 Header 还没有发送，
             * 返回 416。
             */
            if (
                !res.headersSent
            ) {

                res
                    .status(416)
                    .set(
                        'Content-Range',
                        'bytes */*'
                    )
                    .end();

            } else {

                /*
                 * Header 已经发送，
                 * 只能断开连接。
                 */
                res.destroy(
                    error
                );

            }

        }

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

        res.sendFile(
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

        res
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
| 启动服务器
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
            '       Virtual Video Server'
        );

        console.log(
            '=========================================='
        );

        console.log(
            `Server: http://localhost:${PORT}`
        );

        console.log(
            `Chunk: ${
                CHUNK_SIZE /
                1024 /
                1024
            } MB`
        );

        console.log(
            `DingTalk: ${
                DINGTALK_UPLOAD_URL
            }`
        );

        console.log(
            '=========================================='
        );

        console.log('');

    }
);