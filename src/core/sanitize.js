const SAFE_URL_RE = /^(https?:\/\/|mailto:|\/)/i;
const SAFE_DATA_IMG_RE = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i;
const SAFE_DATA_VIDEO_RE = /^data:video\/(mp4|webm|ogg);base64,/i;
const SAFE_EMBED_RE = /^https:\/\/(www\.youtube\.com\/embed\/|player\.vimeo\.com\/video\/)/i;

/**
 * Sanitiza HTML enriquecido en el backend antes de persistirlo en la base de datos.
 * Elimina etiquetas ejecutables (<script>, <style>, <object>, <embed>), iframes no confiables,
 * atributos de eventos (on*), estilos inline y URLs peligrosas (javascript:, data:text/html).
 */
export function sanitizeRichHtml(html) {
  if (!html) return '';
  let s = String(html);

  // Eliminar bloques peligrosos completos
  s = s.replace(/<\s*(script|style|object|embed|applet|base|meta|link)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  s = s.replace(/<\s*(script|style|object|embed|applet|base|meta|link)\b[^>]*\/?>/gi, '');

  // Filtrar iframes: solo permitir embeds de YouTube o Vimeo
  s = s.replace(/<\s*iframe\b([^>]*)>[\s\S]*?<\s*\/\s*iframe\s*>/gi, (full, attrs) => {
    const srcMatch = attrs.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const src = (srcMatch && (srcMatch[1] ?? srcMatch[2] ?? srcMatch[3])) || '';
    return SAFE_EMBED_RE.test(src.trim()) ? full : '';
  });

  // Limpiar atributos peligrosos en cualquier etiqueta
  s = s.replace(/<([a-zA-Z][a-zA-Z0-9-]*)(\s+[^>]*)?>/g, (full, tag, rawAttrs) => {
    if (!rawAttrs) return full;
    let attrs = rawAttrs;
    // Remover event handlers on* y style inline
    attrs = attrs.replace(/\s+on[a-zA-Z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    attrs = attrs.replace(/\s+style\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

    const lowerTag = tag.toLowerCase();
    // Validar href en <a>
    if (lowerTag === 'a') {
      attrs = attrs.replace(/\s+href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (_, v1, v2, v3) => {
        const val = (v1 ?? v2 ?? v3 ?? '').trim();
        if (SAFE_URL_RE.test(val) || (/^data:/i.test(val) && !/^data:text\/html/i.test(val))) {
          return ` href="${val.replace(/"/g, '&quot;')}"`;
        }
        return '';
      });
    }
    // Validar src en <img> y <video>
    if (lowerTag === 'img' || lowerTag === 'video') {
      attrs = attrs.replace(/\s+src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (_, v1, v2, v3) => {
        const val = (v1 ?? v2 ?? v3 ?? '').trim();
        const ok = SAFE_URL_RE.test(val)
          || (lowerTag === 'img' && SAFE_DATA_IMG_RE.test(val))
          || (lowerTag === 'video' && SAFE_DATA_VIDEO_RE.test(val));
        return ok ? ` src="${val.replace(/"/g, '&quot;')}"` : '';
      });
    }
    return `<${tag}${attrs}>`;
  });

  return s.trim();
}
