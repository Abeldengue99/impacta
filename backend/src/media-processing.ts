import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import sharp from 'sharp';

export const MEDIA_DIRECTORY = resolve(process.env.IMPACTA_MEDIA_DIR ?? resolve(__dirname, '../storage/media'));
export const POST_MEDIA_DIRECTORY = resolve(MEDIA_DIRECTORY, 'posts');
export const COMMUNITY_CHAT_MEDIA_DIRECTORY = resolve(MEDIA_DIRECTORY, 'community-chat');
export const DIRECT_MESSAGE_MEDIA_DIRECTORY = resolve(MEDIA_DIRECTORY, 'direct-messages');
export const CHALLENGE_EVIDENCE_DIRECTORY = resolve(MEDIA_DIRECTORY, 'challenge-evidence');
export const PROMOTION_MEDIA_DIRECTORY = resolve(MEDIA_DIRECTORY, 'promotions');
export const MAX_POST_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_POST_IMAGE_OUTPUT_BYTES = 8 * 1024 * 1024;
export const MAX_POST_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_POST_VIDEO_OUTPUT_BYTES = 50 * 1024 * 1024;
export const MAX_POST_VIDEO_SECONDS = 90;
export const MAX_DIRECT_MESSAGE_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_DIRECT_MESSAGE_IMAGE_OUTPUT_BYTES = 4 * 1024 * 1024;
export const MAX_DIRECT_MESSAGE_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_DIRECT_MESSAGE_VIDEO_OUTPUT_BYTES = 20 * 1024 * 1024;
export const MAX_DIRECT_MESSAGE_VIDEO_SECONDS = 60;
const MAX_IMAGE_PIXELS = 40_000_000;
// Accept both UHD (3840×2160) and DCI 4K (4096×2160) source video.
const MAX_VIDEO_WIDTH = 4096;
const MAX_VIDEO_HEIGHT = 4096;
const MAX_VIDEO_PIXELS = 4096 * 2160;
const VIDEO_PROCESS_TIMEOUT_MS = 180_000;
const PROBE_TIMEOUT_MS = 8_000;
const MAX_CONCURRENT_VIDEO_PROCESSING = (() => {
    const configured = process.env.IMPACTA_MAX_CONCURRENT_VIDEO_PROCESSING ?? '1';
    if (!/^[1-4]$/.test(configured)) {
        throw new Error('IMPACTA_MAX_CONCURRENT_VIDEO_PROCESSING must be an integer from 1 to 4');
    }
    return Number(configured);
})();
let activeVideoProcessing = 0;

export function acquireVideoProcessingSlot(): (() => void) | null {
    if (activeVideoProcessing >= MAX_CONCURRENT_VIDEO_PROCESSING) return null;
    activeVideoProcessing += 1;
    let released = false;
    return () => {
        if (released) return;
        released = true;
        activeVideoProcessing = Math.max(0, activeVideoProcessing - 1);
    };
}

export type PostMediaType = 'image' | 'video';
export interface ProcessedPostMedia {
    bytes: Buffer;
    mediaType: PostMediaType;
    mimeType: 'image/webp' | 'video/mp4';
    extension: 'webp' | 'mp4';
}

export class MediaProcessingError extends Error {
    constructor(readonly code: string, readonly statusCode: number) {
        super(code);
        this.name = 'MediaProcessingError';
    }
}

export async function optimizeProfileAvatar(input: Buffer): Promise<Buffer> {
    try {
        const metadata = await sharp(input, { limitInputPixels: 16_000_000, failOn: 'error' }).metadata();
        if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || !metadata.width || !metadata.height
            || metadata.width > 4096 || metadata.height > 4096 || (metadata.pages ?? 1) > 1) {
            throw new MediaProcessingError('invalid_avatar_image', 400);
        }
        const bytes = await sharp(input, { limitInputPixels: 16_000_000, failOn: 'error' })
            .rotate()
            .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 86, effort: 4, smartSubsample: true })
            .toBuffer();
        if (!bytes.length || bytes.length > 1536 * 1024) {
            throw new MediaProcessingError('avatar_too_large', 413);
        }
        return bytes;
    } catch (error) {
        if (error instanceof MediaProcessingError) throw error;
        throw new MediaProcessingError('invalid_avatar_image', 400);
    }
}

export async function optimizeProfileCover(input: Buffer): Promise<Buffer> {
    const maxPixels = 40_000_000;
    try {
        const metadata = await sharp(input, { limitInputPixels: maxPixels, failOn: 'error' }).metadata();
        if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || !metadata.width || !metadata.height
            || metadata.width > 8192 || metadata.height > 8192 || metadata.width * metadata.height > maxPixels
            || (metadata.pages ?? 1) > 1) {
            throw new MediaProcessingError('invalid_cover_image', 400);
        }
        const bytes = await sharp(input, { limitInputPixels: maxPixels, failOn: 'error' })
            .rotate()
            .resize({ width: 2400, height: 1200, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 84, effort: 5, smartSubsample: true })
            .toBuffer();
        if (!bytes.length || bytes.length > 5 * 1024 * 1024) {
            throw new MediaProcessingError('cover_image_too_large', 413);
        }
        return bytes;
    } catch (error) {
        if (error instanceof MediaProcessingError) throw error;
        throw new MediaProcessingError('invalid_cover_image', 400);
    }
}

export async function optimizePostImage(input: Buffer): Promise<ProcessedPostMedia> {
    try {
        const metadata = await sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' }).metadata();
        if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || !metadata.width || !metadata.height
            || metadata.width > 8192 || metadata.height > 8192 || metadata.width * metadata.height > MAX_IMAGE_PIXELS
            || (metadata.pages ?? 1) > 1) {
            throw new MediaProcessingError('invalid_post_image', 400);
        }

        const bytes = await sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' })
            .rotate()
            .resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 86, effort: 5, smartSubsample: true })
            .toBuffer();
        if (!bytes.length || bytes.length > MAX_POST_IMAGE_OUTPUT_BYTES) {
            throw new MediaProcessingError('processed_media_too_large', 413);
        }
        return { bytes, mediaType: 'image', mimeType: 'image/webp', extension: 'webp' };
    } catch (error) {
        if (error instanceof MediaProcessingError) throw error;
        throw new MediaProcessingError('invalid_post_image', 400);
    }
}

export async function optimizeDirectMessageImage(input: Buffer): Promise<ProcessedPostMedia> {
    try {
        const metadata = await sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' }).metadata();
        if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || !metadata.width || !metadata.height
            || metadata.width > 8192 || metadata.height > 8192 || metadata.width * metadata.height > MAX_IMAGE_PIXELS
            || (metadata.pages ?? 1) > 1) {
            throw new MediaProcessingError('invalid_direct_message_image', 400);
        }

        const bytes = await sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' })
            .rotate()
            .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 78, effort: 5, smartSubsample: true })
            .toBuffer();
        if (!bytes.length || bytes.length > MAX_DIRECT_MESSAGE_IMAGE_OUTPUT_BYTES) {
            throw new MediaProcessingError('processed_media_too_large', 413);
        }
        return { bytes, mediaType: 'image', mimeType: 'image/webp', extension: 'webp' };
    } catch (error) {
        if (error instanceof MediaProcessingError) throw error;
        throw new MediaProcessingError('invalid_direct_message_image', 400);
    }
}

interface ProbeResult {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>;
}

function runTool(executable: string, args: string[], timeoutMs: number): Promise<string> {
    return new Promise((resolveOutput, reject) => {
        const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const finishError = (error: MediaProcessingError) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(error);
        };
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => { stdout = `${stdout}${chunk}`.slice(-256_000); });
        child.stderr.on('data', (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-32_000); });
        child.once('error', (error: NodeJS.ErrnoException) => {
            finishError(error.code === 'ENOENT'
                ? new MediaProcessingError('video_processor_unavailable', 503)
                : new MediaProcessingError('video_processing_failed', 422));
        });
        child.once('close', (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (code === 0) resolveOutput(stdout);
            else {
                const missingTool = stderr.toLowerCase().includes('no such file');
                reject(new MediaProcessingError(
                    missingTool ? 'video_processor_unavailable'
                        : executable.toLowerCase().includes('ffmpeg') ? 'video_processing_failed' : 'invalid_post_video',
                    missingTool ? 503 : executable.toLowerCase().includes('ffmpeg') ? 422 : 400
                ));
            }
        });
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            finishError(new MediaProcessingError('video_processing_timeout', 422));
        }, timeoutMs);
    });
}

async function findWinGetFfmpegTool(name: 'ffmpeg' | 'ffprobe'): Promise<string | null> {
    if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return null;

    const packagesRoot = resolve(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages');
    const packages = await readdir(packagesRoot, { withFileTypes: true }).catch(() => []);
    const ffmpegPackages = packages
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('Gyan.FFmpeg.Shared_'))
        .sort((left, right) => right.name.localeCompare(left.name));

    for (const packageEntry of ffmpegPackages) {
        const packagePath = resolve(packagesRoot, packageEntry.name);
        const versions = await readdir(packagePath, { withFileTypes: true }).catch(() => []);
        const installs = versions
            .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith('ffmpeg-'))
            .sort((left, right) => right.name.localeCompare(left.name));

        for (const install of installs) {
            const executable = resolve(packagePath, install.name, 'bin', `${name}.exe`);
            try {
                if ((await stat(executable)).isFile()) return executable;
            } catch {
                // Keep looking if this package version does not contain the executable.
            }
        }
    }
    return null;
}

async function runVideoTool(
    name: 'ffmpeg' | 'ffprobe', configuredPath: string | undefined, args: string[], timeoutMs: number
): Promise<string> {
    const executable = configuredPath || name;
    try {
        return await runTool(executable, args, timeoutMs);
    } catch (error) {
        if (configuredPath || !(error instanceof MediaProcessingError)
            || error.code !== 'video_processor_unavailable') throw error;
        const installedExecutable = await findWinGetFfmpegTool(name);
        if (!installedExecutable) throw error;
        return runTool(installedExecutable, args, timeoutMs);
    }
}

interface VideoOptimizationOptions {
    maxDurationSeconds: number;
    maxOutputBytes: number;
    outputDimension: number;
    crf: number;
    audioBitrate: string;
}

async function optimizeVideo(input: Buffer, options: VideoOptimizationOptions): Promise<ProcessedPostMedia> {
    const temporaryDirectory = resolve(MEDIA_DIRECTORY, '.processing');
    const id = randomUUID();
    const inputPath = resolve(temporaryDirectory, `${id}.input.mp4`);
    const outputPath = resolve(temporaryDirectory, `${id}.output.mp4`);
    await mkdir(temporaryDirectory, { recursive: true, mode: 0o700 });
    try {
        await writeFile(inputPath, input, { flag: 'wx', mode: 0o600 });
        const probeText = await runVideoTool('ffprobe', process.env.IMPACTA_FFPROBE_PATH, [
            '-v', 'error', '-protocol_whitelist', 'file,crypto,data', '-f', 'mov',
            '-show_entries', 'format=duration:stream=codec_type,width,height,duration',
            '-of', 'json', inputPath
        ], PROBE_TIMEOUT_MS);

        let probe: ProbeResult;
        try { probe = JSON.parse(probeText) as ProbeResult; } catch {
            throw new MediaProcessingError('invalid_post_video', 400);
        }
        const video = probe.streams?.find((stream) => stream.codec_type === 'video');
        const width = Number(video?.width);
        const height = Number(video?.height);
        const duration = [probe.format?.duration, video?.duration]
            .map((value) => Number(value))
            .find((value) => Number.isFinite(value) && value > 0);
        if (!video || duration === undefined || !Number.isInteger(width) || !Number.isInteger(height)
            || width <= 0 || height <= 0) {
            throw new MediaProcessingError('invalid_post_video', 400);
        }
        if (duration > options.maxDurationSeconds) {
            throw new MediaProcessingError(options.maxDurationSeconds === MAX_DIRECT_MESSAGE_VIDEO_SECONDS
                ? 'direct_message_video_too_long' : 'post_video_too_long', 400);
        }
        if (width > MAX_VIDEO_WIDTH || height > MAX_VIDEO_HEIGHT || width * height > MAX_VIDEO_PIXELS) {
            throw new MediaProcessingError('post_video_resolution_too_large', 400);
        }

        await runVideoTool('ffmpeg', process.env.IMPACTA_FFMPEG_PATH, [
            '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
            '-protocol_whitelist', 'file,crypto,data', '-f', 'mov', '-i', inputPath,
            '-map', '0:v:0', '-map', '0:a:0?',
            '-vf', `scale=w='min(${options.outputDimension},iw)':h='min(${options.outputDimension},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(options.crf), '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', options.audioBitrate, '-map_metadata', '-1', '-movflags', '+faststart',
            '-t', String(options.maxDurationSeconds), '-f', 'mp4', outputPath
        ], VIDEO_PROCESS_TIMEOUT_MS);

        const bytes = await readFile(outputPath);
        if (!bytes.length || bytes.length > options.maxOutputBytes) {
            throw new MediaProcessingError('processed_media_too_large', 413);
        }
        return { bytes, mediaType: 'video', mimeType: 'video/mp4', extension: 'mp4' };
    } finally {
        await Promise.all([unlink(inputPath).catch(() => undefined), unlink(outputPath).catch(() => undefined)]);
    }
}

export function optimizePostVideo(input: Buffer): Promise<ProcessedPostMedia> {
    return optimizeVideo(input, {
        maxDurationSeconds: MAX_POST_VIDEO_SECONDS,
        maxOutputBytes: MAX_POST_VIDEO_OUTPUT_BYTES,
        outputDimension: 1920,
        crf: 23,
        audioBitrate: '128k'
    });
}

export function optimizeDirectMessageVideo(input: Buffer): Promise<ProcessedPostMedia> {
    return optimizeVideo(input, {
        maxDurationSeconds: MAX_DIRECT_MESSAGE_VIDEO_SECONDS,
        maxOutputBytes: MAX_DIRECT_MESSAGE_VIDEO_OUTPUT_BYTES,
        outputDimension: 1280,
        crf: 28,
        audioBitrate: '96k'
    });
}

export function postMediaStoragePath(storageKey: string): string | null {
    if (!/^posts\/[a-f0-9-]{36}\.(?:webp|mp4)$/i.test(storageKey)) return null;
    return resolve(MEDIA_DIRECTORY, storageKey);
}

export function communityChatMediaStoragePath(storageKey: string): string | null {
    if (!/^community-chat\/[a-f0-9-]{36}\.(?:webp|mp4)$/i.test(storageKey)) return null;
    return resolve(MEDIA_DIRECTORY, storageKey);
}

export function directMessageMediaStoragePath(storageKey: string): string | null {
    if (!/^direct-messages\/[a-f0-9-]{36}\.(?:webp|mp4)$/i.test(storageKey)) return null;
    return resolve(MEDIA_DIRECTORY, storageKey);
}

export function challengeEvidenceStoragePath(storageKey: string): string | null {
    if (!/^challenge-evidence\/[a-f0-9-]{36}\.(?:webp|mp4)$/i.test(storageKey)) return null;
    return resolve(MEDIA_DIRECTORY, storageKey);
}

export function promotionMediaStoragePath(storageKey: string): string | null {
    if (!/^promotions\/[a-f0-9-]{36}\.webp$/i.test(storageKey)) return null;
    return resolve(MEDIA_DIRECTORY, storageKey);
}
