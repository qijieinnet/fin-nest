// 上传给识图模型前的本地压缩：统一转 JPEG、限制尺寸。
//
// 账单截图的信息全在文字上，尺寸限制按「文字还看得清」来定，而不是按长边一刀切：
// 手机截图宽约 1080~1290，长截图高度可达数千像素，若把长边压到 2000 文字就糊了。
// 所以限宽 1440、限高 4096（多数上游单边上限 8192，再高也会被上游自己缩小）。
// 同时顺带把 HEIC 等服务端不收的格式转成 JPEG（浏览器能解码的前提下）。

const MAX_WIDTH = 1440;
const MAX_HEIGHT = 4096;
const JPEG_QUALITY = 0.85;

async function decode(file: Blob): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // 部分浏览器不支持 options 或该格式，退回 <img> 解码。
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/** 压缩为 JPEG；浏览器无法解码时抛出可直接展示给用户的错误。 */
export async function compressImageForUpload(file: Blob): Promise<Blob> {
  let decoded;
  try {
    decoded = await decode(file);
  } catch {
    throw new Error("无法读取这张图片，请换成 JPG / PNG 截图");
  }
  try {
    const scale = Math.min(1, MAX_WIDTH / decoded.width, MAX_HEIGHT / decoded.height);
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("图片处理失败，请重试");
    // 透明 PNG 转 JPEG 时透明区域会变黑，先铺白底。
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(decoded.source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob) throw new Error("图片处理失败，请重试");
    return blob;
  } finally {
    decoded.release();
  }
}
