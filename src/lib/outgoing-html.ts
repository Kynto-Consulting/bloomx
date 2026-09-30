/**
 * HTML que realmente viaja en un correo enviado desde el redactor.
 *
 * Los overlays/formularios de las extensiones (Zoom, Meet, GIF...) viven FUERA del arbol del editor (React/portales) y
 * se marcan con `data-bx-ui`; aun asi, por seguridad, todo cuerpo que sale del redactor (envio, programado, sellado,
 * borrador) y todo HTML que una extension inserta pasa por `cleanOutgoingHtml`, que elimina esos marcadores, los
 * <button>/<input>/<select>/<textarea>/<form>/<dialog> sueltos y los restos con clases de overlay. Los botones dentro
 * de un enlace se conservan (son contenido del enlace).
 */
import { stripInteractiveRemnants } from '@/lib/sanitizeHtml';

/** Atributo con el que las extensiones marcan cualquier UI propia que no debe serializarse en el correo. */
export const COMPOSER_UI_ATTR = 'data-bx-ui';

export function cleanOutgoingHtml(html: string): string {
    if (!html || typeof document === 'undefined') return html;
    if (!/<(button|input|select|textarea|form|dialog|fieldset)\b|data-bx-|\b(?:bx|bloomx)-/i.test(html) && !/role\s*=\s*["'](?:button|dialog)/i.test(html)) return html;
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    stripInteractiveRemnants(tpl.content);
    return tpl.innerHTML;
}
