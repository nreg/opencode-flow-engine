import type { ToolDefinition } from '@opencode-ai/plugin';
import { z } from 'zod';

export function createAgnesTools(): Record<string, ToolDefinition> {
  return {
    agnes_image_generate: {
      description: 'Generate an image using agnesmore provider. Supports text-to-image, image-to-image, and multi-image composition. Requires agnesmore plugin installed and configured.',
      args: {
        prompt: z.string().describe('Text description of the image to generate. Use format: [subject] + [scene] + [style] + [lighting] + [composition]'),
        output_path: z.string().optional().describe('Relative path to save the image (e.g. "public/images/hero.png"). Defaults to src/assets/images/<timestamp>.png'),
        size: z.string().optional().describe('Output image size. Precise format: "1024x768", "1024x1024", "768x1024". Tier format for use with ratio: "1K", "2K", "3K", "4K". Default: "1024x768".'),
        ratio: z.string().optional().describe('Aspect ratio for tier-based size. Only used when size is in tier format (1K/2K/3K/4K). Supported: 1:1, 3:4, 4:3, 16:9, 9:16, 2:3, 3:2, 21:9. Default: 1:1.'),
        image_paths: z.array(z.string()).optional().describe('Paths to reference images for image-to-image style transfer or multi-image composition. Single path for style transfer, multiple paths for composition.'),
      },
      execute: async (args: { prompt: string; output_path?: string; size?: string; ratio?: string; image_paths?: string[] }, context) => {
        const changeDir = context.directory || process.cwd();
        try {
          const { readFile, writeFile, mkdir } = await import('node:fs/promises');
          const { homedir } = await import('node:os');
          const { join, dirname, extname, isAbsolute } = await import('node:path');

          let apiKey: string;
          try {
            const authContent = await readFile(join(homedir(), '.agnesmore', 'auth.json'), 'utf-8');
            const auth = JSON.parse(authContent);
            apiKey = auth.keys?.[0] || '';
            if (!apiKey) throw new Error('No API key found');
          } catch {
            return { title: 'Agnes Image Gen', output: JSON.stringify({ success: false, error: 'Agnesmore auth not found or invalid. Run /connect in OpenCode to configure agnesmore first.' }, null, 2) };
          }

          const size = args.size || '1024x768';
          const ratio = args.ratio || '1:1';

          // Convert local image paths to base64 data URIs for image-to-image / multi-image composition
          let imageUrls: string[] | undefined;
          if (Array.isArray(args.image_paths) && args.image_paths.length > 0) {
            imageUrls = await Promise.all(args.image_paths.map(async (imgPath: string) => {
              const fullImgPath = isAbsolute(imgPath) ? imgPath : join(changeDir, imgPath);
              const imgExt = extname(imgPath).toLowerCase();
              const mimeMap: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
              const mime = mimeMap[imgExt] || 'image/png';
              const imgBuffer = await readFile(fullImgPath);
              return `data:${mime};base64,${imgBuffer.toString('base64')}`;
            }));
          }

          const response = await fetch('https://apihub.agnes-ai.com/v1/images/generations', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            signal: AbortSignal.timeout(300_000),
            body: JSON.stringify({
              model: 'agnes-image-2.1-flash',
              prompt: args.prompt,
              size,
              ratio,
              extra_body: {
                ...(imageUrls ? { image: imageUrls } : {}),
                response_format: 'url',
              },
            }),
          });

          if (!response.ok) {
            const errText = await response.text();
            return { title: 'Agnes Image Gen', output: JSON.stringify({ success: false, error: `API error ${response.status}: ${errText}` }, null, 2) };
          }

          const data = await response.json() as { data?: Array<{ url?: string }> };
          const imageUrl = data?.data?.[0]?.url;
          if (!imageUrl) {
            return { title: 'Agnes Image Gen', output: JSON.stringify({ success: false, error: 'No image URL in response' }, null, 2) };
          }

          const imgResponse = await fetch(imageUrl, { signal: AbortSignal.timeout(60_000) });
          if (!imgResponse.ok) {
            return { title: 'Agnes Image Gen', output: JSON.stringify({ success: false, error: `Failed to download image: ${imgResponse.status}` }, null, 2) };
          }
          const imgBuffer = await imgResponse.arrayBuffer();

          const outputPath = args.output_path || `src/assets/images/gen-${Date.now()}.png`;
          const fullPath = join(changeDir, outputPath);
          await mkdir(dirname(fullPath), { recursive: true });
          await writeFile(fullPath, Buffer.from(imgBuffer));

          return {
            title: 'Agnes Image Gen',
            output: JSON.stringify({
              success: true,
              prompt: args.prompt,
              size,
              ratio,
              output_path: outputPath,
              image_url: imageUrl,
            }, null, 2),
          };
        } catch (error) {
          return {
            title: 'Agnes Image Gen',
            output: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          };
        }
      },
    },

    agnes_video_generate: {
      description: 'Generate a video using agnesmore provider. Requires agnesmore plugin installed and configured.',
      args: {
        prompt: z.string().describe('Text description of the video. Use format: [subject] + [action] + [scene] + [camera movement] + [style]'),
        output_path: z.string().optional().describe('Relative path to save the video (e.g. "public/videos/hero.mp4"). Defaults to src/assets/videos/<timestamp>.mp4'),
        width: z.number().optional().describe('Video width (default: 1152)'),
        height: z.number().optional().describe('Video height (default: 768)'),
        num_frames: z.number().optional().describe('Number of frames (max 441, must be 8n+1). Default: 121 (~5s at 24fps)'),
        frame_rate: z.number().optional().describe('Frame rate 1-60 (default: 24)'),
      },
      execute: async (args: { prompt: string; output_path?: string; width?: number; height?: number; num_frames?: number; frame_rate?: number }, context) => {
        const changeDir = context.directory || process.cwd();
        try {
          const { readFile, writeFile, mkdir } = await import('node:fs/promises');
          const { homedir } = await import('node:os');
          const { join, dirname } = await import('node:path');

          let apiKey: string;
          try {
            const authContent = await readFile(join(homedir(), '.agnesmore', 'auth.json'), 'utf-8');
            const auth = JSON.parse(authContent);
            apiKey = auth.keys?.[0] || '';
            if (!apiKey) throw new Error('No API key found');
          } catch {
            return { title: 'Agnes Video Gen', output: JSON.stringify({ success: false, error: 'Agnesmore auth not found or invalid. Run /connect in OpenCode to configure agnesmore first.' }, null, 2) };
          }

          const createResponse = await fetch('https://apihub.agnes-ai.com/v1/videos', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            signal: AbortSignal.timeout(90_000),
            body: JSON.stringify({
              model: 'agnes-video-v2.0',
              prompt: args.prompt,
              width: Number(args.width) || 1152,
              height: Number(args.height) || 768,
              num_frames: Number(args.num_frames) || 121,
              frame_rate: Number(args.frame_rate) || 24,
            }),
          });

          if (!createResponse.ok) {
            const errText = await createResponse.text();
            return { title: 'Agnes Video Gen', output: JSON.stringify({ success: false, error: `Create task error ${createResponse.status}: ${errText}` }, null, 2) };
          }

          const taskData = await createResponse.json() as { video_id?: string; task_id?: string; status?: string };
          const videoId = taskData.video_id || taskData.task_id || '';
          if (!videoId) {
            return { title: 'Agnes Video Gen', output: JSON.stringify({ success: false, error: 'No video/task ID in response' }, null, 2) };
          }

          const maxAttempts = 60;
          const pollIntervalMs = 5000;
          let videoUrl = '';
          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            await new Promise(r => setTimeout(r, pollIntervalMs));
            const pollResponse = await fetch(`https://apihub.agnes-ai.com/agnesapi?video_id=${videoId}`, {
              headers: { 'Authorization': `Bearer ${apiKey}` },
            });
            if (!pollResponse.ok) continue;
            const pollData = await pollResponse.json() as { status?: string; url?: string };
            if (pollData.status === 'completed' && pollData.url) {
              videoUrl = pollData.url;
              break;
            }
            if (pollData.status === 'failed') {
              return { title: 'Agnes Video Gen', output: JSON.stringify({ success: false, error: 'Video generation failed' }, null, 2) };
            }
          }

          if (!videoUrl) {
            return { title: 'Agnes Video Gen', output: JSON.stringify({ success: false, error: 'Video generation timed out after 5 minutes' }, null, 2) };
          }

          const videoResponse = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
          if (!videoResponse.ok) {
            return { title: 'Agnes Video Gen', output: JSON.stringify({ success: false, error: `Failed to download video: ${videoResponse.status}` }, null, 2) };
          }
          const videoBuffer = await videoResponse.arrayBuffer();

          const outputPath = args.output_path || `src/assets/videos/gen-${Date.now()}.mp4`;
          const fullPath = join(changeDir, outputPath);
          await mkdir(dirname(fullPath), { recursive: true });
          await writeFile(fullPath, Buffer.from(videoBuffer));

          return {
            title: 'Agnes Video Gen',
            output: JSON.stringify({
              success: true,
              prompt: args.prompt,
              output_path: outputPath,
              video_url: videoUrl,
            }, null, 2),
          };
        } catch (error) {
          return {
            title: 'Agnes Video Gen',
            output: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          };
        }
      },
    },

    agnes_image_understand: {
      description: 'Analyze an image using agnesmore multimodal model. Requires agnesmore plugin installed and configured.',
      args: {
        image_path: z.string().describe('Path to the image file to analyze (e.g. "screenshots/page.png")'),
        prompt: z.string().optional().describe('Question or instruction about the image (default: "请详细描述这张图片的内容")'),
      },
      execute: async (args: { image_path: string; prompt?: string }, context) => {
        const changeDir = context.directory || process.cwd();
        try {
          const { readFile } = await import('node:fs/promises');
          const { homedir } = await import('node:os');
          const { join, extname, isAbsolute } = await import('node:path');

          let apiKey: string;
          try {
            const authContent = await readFile(join(homedir(), '.agnesmore', 'auth.json'), 'utf-8');
            const auth = JSON.parse(authContent);
            apiKey = auth.keys?.[0] || '';
            if (!apiKey) throw new Error('No API key found');
          } catch {
            return { title: 'Agnes Image Understand', output: JSON.stringify({ success: false, error: 'Agnesmore auth not found or invalid. Run /connect in OpenCode to configure agnesmore first.' }, null, 2) };
          }

          const imagePath = isAbsolute(args.image_path) ? args.image_path : join(changeDir, args.image_path);
          const ext = extname(args.image_path).toLowerCase();
          const mimeMap: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
          const mime = mimeMap[ext] || 'image/png';

          const imageBuffer = await readFile(imagePath);
          const base64 = imageBuffer.toString('base64');

          const response = await fetch('https://apihub.agnes-ai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            signal: AbortSignal.timeout(60_000),
            body: JSON.stringify({
              model: 'agnes-2.0-flash',
              messages: [{
                role: 'user',
                content: [
                  { type: 'text', text: args.prompt || '请详细描述这张图片的内容' },
                  { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
                ],
              }],
            }),
          });

          if (!response.ok) {
            const errText = await response.text();
            return { title: 'Agnes Image Understand', output: JSON.stringify({ success: false, error: `API error ${response.status}: ${errText}` }, null, 2) };
          }

          const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
          const content = data?.choices?.[0]?.message?.content || '(empty response)';

          return {
            title: 'Agnes Image Understand',
            output: JSON.stringify({
              success: true,
              image: args.image_path,
              prompt: args.prompt || '请详细描述这张图片的内容',
              analysis: content,
            }, null, 2),
          };
        } catch (error) {
          return {
            title: 'Agnes Image Understand',
            output: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          };
        }
      },
    },

    sense_image_generate: {
      description: 'Generate an image using SenseNova U1 Fast model. Text-to-image only (no image input). Image URL expires in 1 hour — tool auto-downloads it immediately. Requires agnesmore auth configured.',
      args: {
        prompt: z.string().describe('Text description of the image to generate. Max 4096 tokens. Use format: [subject] + [scene] + [style] + [lighting] + [composition]'),
        output_path: z.string().optional().describe('Relative path to save the image (e.g. "public/images/hero.png"). Defaults to src/assets/images/sense-<timestamp>.png'),
        ratio: z.string().optional().describe('Aspect ratio. Supported: 16:9 (default), 9:16, 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 21:9, 9:21'),
        n: z.number().optional().describe('Number of images to generate (default: 1). Only the first image is saved when n > 1.'),
      },
      execute: async (args: { prompt: string; output_path?: string; ratio?: string; n?: number }, context) => {
        const changeDir = context.directory || process.cwd();
        try {
          const { readFile, writeFile, mkdir } = await import('node:fs/promises');
          const { homedir } = await import('node:os');
          const { join, dirname } = await import('node:path');

          let apiKey: string;
          try {
            const authContent = await readFile(join(homedir(), '.sensemore', 'auth.json'), 'utf-8');
            const auth = JSON.parse(authContent);
            apiKey = auth.keys?.[0] || '';
            if (!apiKey) throw new Error('No API key found');
          } catch {
            return { title: 'Sense Image Gen', output: JSON.stringify({ success: false, error: 'SenseNova auth not found at ~/.sensemore/auth.json. Configure via OpenCode sensemore provider first.' }, null, 2) };
          }

          // SenseNova U1 Fast fixed resolutions per aspect ratio
          const RATIO_SIZE_MAP: Record<string, string> = {
            '2:3': '1664x2496',
            '3:2': '2496x1664',
            '3:4': '1760x2368',
            '4:3': '2368x1760',
            '4:5': '1824x2272',
            '5:4': '2272x1824',
            '1:1': '2048x2048',
            '16:9': '2752x1536',
            '9:16': '1536x2752',
            '21:9': '3072x1376',
            '9:21': '1344x3136',
          };
          const ratio = args.ratio || '16:9';
          const size = RATIO_SIZE_MAP[ratio];
          if (!size) {
            return { title: 'Sense Image Gen', output: JSON.stringify({ success: false, error: `Unsupported ratio "${ratio}". Supported: ${Object.keys(RATIO_SIZE_MAP).join(', ')}` }, null, 2) };
          }

          const response = await fetch('https://token.sensenova.cn/v1/images/generations', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            signal: AbortSignal.timeout(300_000),
            body: JSON.stringify({
              model: 'sensenova-u1-fast',
              prompt: args.prompt,
              size,
              n: args.n || 1,
            }),
          });

          if (!response.ok) {
            const errText = await response.text();
            return { title: 'Sense Image Gen', output: JSON.stringify({ success: false, error: `API error ${response.status}: ${errText}` }, null, 2) };
          }

          const data = await response.json() as { created?: number; data?: Array<{ url?: string }> };
          const imageUrl = data?.data?.[0]?.url;
          if (!imageUrl) {
            return { title: 'Sense Image Gen', output: JSON.stringify({ success: false, error: 'No image URL in response' }, null, 2) };
          }

          // Image URL expires in 1 hour — download immediately
          const imgResponse = await fetch(imageUrl, { signal: AbortSignal.timeout(120_000) });
          if (!imgResponse.ok) {
            return { title: 'Sense Image Gen', output: JSON.stringify({ success: false, error: `Failed to download image: ${imgResponse.status}` }, null, 2) };
          }
          const imgBuffer = await imgResponse.arrayBuffer();

          const outputPath = args.output_path || `src/assets/images/sense-${Date.now()}.png`;
          const fullPath = join(changeDir, outputPath);
          await mkdir(dirname(fullPath), { recursive: true });
          await writeFile(fullPath, Buffer.from(imgBuffer));

          return {
            title: 'Sense Image Gen',
            output: JSON.stringify({
              success: true,
              prompt: args.prompt,
              ratio,
              size,
              output_path: outputPath,
              image_url: imageUrl,
            }, null, 2),
          };
        } catch (error) {
          return {
            title: 'Sense Image Gen',
            output: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          };
        }
      },
    },
  };
}
