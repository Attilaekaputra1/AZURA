/**
 * AZURA Vision Media Extraction & Context Resolution Module
 * Handles: Attachments, Discord Stickers, Tenor/Giphy GIF embeds, and Direct Image URLs.
 */

const https = require('https');
const http = require('http');

/**
 * Extract all visual media (Images, Stickers, GIFs, Embeds) and visual context from a Discord message.
 * @param {import('discord.js').Message} message 
 * @returns {Promise<{ imageUrls: string[], visualContextPrompt: string, hasVisualMedia: boolean }>}
 */
async function extractVisualMedia(message) {
  const imageUrls = [];
  const contextNotes = [];

  // ── 1. Image & GIF Attachments ──
  if (message.attachments && message.attachments.size > 0) {
    for (const att of message.attachments.values()) {
      const isImg = att.contentType && (att.contentType.startsWith('image/') || att.contentType.startsWith('video/'));
      const isImgExt = /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(att.name || att.url);
      if (isImg || isImgExt) {
        imageUrls.push(att.url);
        if (/\.gif(\?|$)/i.test(att.name || att.url) || att.contentType === 'image/gif') {
          contextNotes.push(`[Pengguna mengunggah file GIF animasi: "${att.name || 'animation.gif'}"]`);
        } else {
          contextNotes.push(`[Pengguna mengunggah gambar lampiran: "${att.name || 'image.png'}"]`);
        }
      }
    }
  }

  // ── 2. Discord Stickers (PNG, APNG, GIF) ──
  if (message.stickers && message.stickers.size > 0) {
    for (const sticker of message.stickers.values()) {
      // Discord sticker CDN URL (format: PNG or GIF)
      let stickerUrl = sticker.url;
      if (!stickerUrl && sticker.id) {
        stickerUrl = `https://cdn.discordapp.com/stickers/${sticker.id}.png?size=320`;
      }
      if (stickerUrl) {
        imageUrls.push(stickerUrl);
      }
      const sName = sticker.name || 'Stiker';
      const sDesc = sticker.description ? ` (${sticker.description})` : '';
      const sTags = sticker.tags ? ` [Tag: ${sticker.tags}]` : '';
      contextNotes.push(`[Pengguna mengirim Stiker Discord: "${sName}"${sDesc}${sTags}. Lihat gambar stiker ini secara visual untuk memahami ekspresi/maksud pengguna]`);
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
      if (embedImgUrl && !imageUrls.includes(embedImgUrl)) {
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
      if (!imageUrls.includes(url)) {
        imageUrls.push(url);
      }
    }
  }

  const visualContextPrompt = contextNotes.join('\n');

  return {
    imageUrls,
    visualContextPrompt,
    hasVisualMedia: imageUrls.length > 0
  };
}

module.exports = {
  extractVisualMedia
};
