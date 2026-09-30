/**
 * Precedencia "las reglas del usuario ganan" para el Auto Organizer.
 *
 * El organizer solo AGREGA una etiqueta sugerida; si una regla habilitada del usuario ya decide sobre este correo
 * (agrega etiquetas o cambia la carpeta), el organizer se abstiene. Modulo puro: se prueba sin BD.
 */
import { evaluateRules, type Rule, type RuleEmail } from './engine';

export function rulesOwnEmail(rules: Rule[], email: RuleEmail): boolean {
    if (!rules || rules.length === 0) return false;
    const fx = evaluateRules(email, rules);
    return fx.addLabelIds.length > 0 || fx.folder !== null;
}
