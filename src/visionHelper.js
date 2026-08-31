/**
 * AZURA Vision Media Extraction & Context Resolution Module (Enhanced)
 * Handles: Images, Photos, Screenshots, High-Res Discord Stickers, Video Attachments (MP4, MOV, WEBM, MKV), Tenor/Giphy GIF embeds.
 */

const https = require('https');
const http = require('http');
const { isVideoMedia, processVideoAttachment } = require('./videoVision');

/**
 * Extract all visual media (Images, Videos, Stickers, GIFs, Embeds) and visual context from a Discord message.
 * @param {import('discord.js').Message} message 
 * @returns {Promise<{ imageUrls: string[], visualContextPrompt: string, hasVisualMedia: boolean }>}
 */
async function extractVisualMedia(message) {
  const imageUrls = [];
  const contextNotes = [];

  // ── 1. Image, Photo & Video Attachments ──
  if (message.attachments && message.attachments.size > 0) {
    for (const att of message.attachments.values()) {
      const isVideo = isVideoMedia(att.name || att.url, att.contentType || '');
      const isImg = att.contentType && att.contentType.startsWith('image/');
      const isImgExt = /\.(png|jpe?g|gif|webp|bmp|svg|tiff)(\?|$)/i.test(att.name || att.url);

      if (isVideo) {
        // Process Video Attachment into timeline keyframes + audio transcription
        try {
          const videoRes = await processVideoAttachment(att.url, att.name || 'video.mp4');
          if (videoRes.success && videoRes.frames.length > 0) {
            for (const f of videoRes.frames) {
              imageUrls.push(f.dataUrl);
            }
            contextNotes.push(videoRes.videoPrompt);
          } else {
            contextNotes.push(videoRes.videoPrompt || `[Pengguna mengunggah video: "${att.name}"]`);
          }
        } catch (vErr) {
          console.warn('[VisionHelper]: Video processing error:', vErr.message);
          contextNotes.push(`[Pengguna mengunggah video: "${att.name || 'video.mp4'}"].`);
        }
      } else if (isImg || isImgExt) {
        imageUrls.push(att.url);
        if (/\.gif(\?|$)/i.test(att.name || att.url) || att.contentType === 'image/gif') {
          contextNotes.push(`[Pengguna mengunggah file GIF animasi: "${att.name || 'animation.gif'}"]. Analisis gerakan, karakter, dan konteks visual animasinya secara detail!`);
        } else {
          contextNotes.push(
            `[PENGGUNA MENGUNGGAH GAMBAR / FOTO: "${att.name || 'image.png'}"]\n` +
            `Analisis gambar ini dengan ketajaman tinggi (High-Definition Vision): perhatikan objek, ekspresi wajah, teks tertulis (OCR), suasana, gaya seni, detail kode/grafik jika ada, dan berikan tanggapan yang sangat akurat dan mendalam!`
          );
        }
      }
    }
  }

  // ── 2. Discord Stickers (PNG, APNG, Lottie JSON, GIF) ──
  if (message.stickers && message.stickers.size > 0) {
    for (const sticker of message.stickers.values()) {
      const sName = sticker.name || 'Stiker';
      const sDesc = sticker.description ? ` (${sticker.description})` : '';
      const sTags = sticker.tags ? ` [Tag/Emoji: ${sticker.tags}]` : '';
      const isLottie = sticker.format === 3 || (sticker.url && sticker.url.endsWith('.json'));

      if (isLottie) {
        // Lottie vector JSON
        contextNotes.push(
          `[PENGGUNA MENGIRIM STIKER ANIMASI DISCORD: "${sName}"${sDesc}${sTags} | Tipe: Animasi Bergerak Default Discord]. ` +
          `Tanggapi ekspresi/gerakan stiker animasi ini secara visual dan responsif seolah kamu melihat animasinya langsung!`
        );
      } else {
        // PNG, APNG, GIF stickers
        let stickerUrl = sticker.url;
        if (!stickerUrl && sticker.id) {
          const ext = sticker.format === 4 ? 'gif' : 'png';
          stickerUrl = `https://cdn.discordapp.com/stickers/${sticker.id}.${ext}?size=320`;
        }
        if (stickerUrl && !stickerUrl.endsWith('.json')) {
          imageUrls.push(stickerUrl);
        }
        contextNotes.push(
          `[PENGGUNA MENGIRIM STIKER DISCORD: "${sName}"${sDesc}${sTags}]. ` +
          `Lihat gambar stiker ini secara visual dan tanggapi ekspresi/reaksinya!`
        );
      }
    }
  }

  // ── 3. Check Discord Embeds (Tenor GIFs, Giphy, Web Previews) ──
  let targetMsg = message;

  // If message contains a Tenor / Giphy link or image link but embeds haven't loaded yet, wait briefly and refetch
  const hasMediaUrl = /(?:tenor\.com|giphy\.com|media\.tenor\.com|\.(?:png|jpe?g|gif|webp))/i.test(message.content);
  if (hasMediaUrl && (!message.embeds || message.embeds.length === 0)) {
    try {
      await new Promise(r => setTimeout(r, 700));
      const refetched = await message.fetch().catch(() => null);
      if (refetched) {
        targetMsg = refetched;
      }
    } catch (_) {}
  }

  if (targetMsg.embeds && targetMsg.embeds.length > 0) {
    for (const embed of targetMsg.embeds) {
      // Direct image in embed (Tenor GIF, Giphy GIF, Twitter/X image, etc.)
      const embedImgUrl = embed.image?.url || embed.image?.proxyURL || embed.thumbnail?.url || embed.thumbnail?.proxyURL;
      if (embedImgUrl && !imageUrls.includes(embedImgUrl) && !embedImgUrl.endsWith('.json')) {
        imageUrls.push(embedImgUrl);
        const provider = embed.provider?.name || (embed.url?.includes('tenor') ? 'Tenor GIF' : 'GIF');
        const title = embed.title ? ` "${embed.title}"` : '';
        contextNotes.push(`[Pengguna mengirim ${provider}${title}. Analisis gambar/GIF animasi ini secara visual dan tanggapi konteks/reaksi/leluconnya!]`);
      }
    }
  }

  // ── 4. Direct Image/GIF URLs in Message Content (Fallback) ──
  const urlMatches = message.content.match(/https?:\/\/[^\s<>"']+\.(?:png|jpe?g|gif|webp)(?:\?[^\s<>"']*)?/gi);
  if (urlMatches) {
    for (const url of urlMatches) {
      if (!imageUrls.includes(url) && !url.endsWith('.json')) {
        imageUrls.push(url);
      }
    }
  }

  const visualContextPrompt = contextNotes.join('\n\n');

  return {
    imageUrls,
    visualContextPrompt,
    hasVisualMedia: imageUrls.length > 0 || contextNotes.length > 0
  };
}

module.exports = {
  extractVisualMedia
};
