export type CommunityPolicyViolation = 'pornographic_content' | 'sexual_exploitation';
export type FeedPolicyViolation = CommunityPolicyViolation | 'hate_or_violent_incitation';

function compactForPolicy(text: string): string {
    return text.normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[013457]/g, (character) => ({ '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't' })[character] ?? character)
        .replace(/[^a-z0-9]/g, '');
}

/**
 * A conservative pre-publication text screen for community names, descriptions and chat.
 * It only blocks high-confidence explicit sexual content; it does not scan images/videos
 * and does not replace reports or human review.
 */
export function findCommunityPolicyViolation(text: string): CommunityPolicyViolation | null {
    const normalized = text.normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[013457]/g, (character) => ({ '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't' })[character] ?? character)
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    const compact = compactForPolicy(text);
    if (!compact) return null;

    const exploitationTerms = [
        'pornografiainfantil', 'pornografiajuvenil', 'exploracaosexualinfantil', 'abusosexualinfantil',
        'childsexualabuse', 'childpornography', 'childporn', 'sexualexploitationofchildren',
        'pedofilia', 'pedofilo', 'pedofilos', 'pedophile', 'pedophilia'
    ];
    if (exploitationTerms.some((term) => compact.includes(term))) {
        return 'sexual_exploitation';
    }
    const educationalContext = /\b(saude|educacao|prevencao|consentimento|apoio|denuncia|violencia sexual|seguranca)\b/.test(normalized);
    const explicitPornography = /\b(porn|pornografia|pornografico|pornografica|xxx)\b/.test(normalized);
    const sexualMaterial = /\b(nudes?|conteudo adulto|material sexual)\b/;
    const solicitation = /\b(troca|venda|partilha|manda|envia|publica|distribui)\b/;
    if ((explicitPornography && !educationalContext)
        || (solicitation.test(normalized) && sexualMaterial.test(normalized))) {
        return 'pornographic_content';
    }
    return null;
}

/**
 * High-confidence text checks for public feed content. Contextual wording is used
 * for threats and calls to violence so that reporting on discrimination, health,
 * education or violence is not blocked merely for mentioning those subjects.
 * This is a first-line filter, not a substitute for reports and human review.
 */
export function findFeedPolicyViolation(text: string): FeedPolicyViolation | null {
    const sexualViolation = findCommunityPolicyViolation(text);
    if (sexualViolation) return sexualViolation;

    const normalized = text.normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[013457]/g, (character) => ({ '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't' })[character] ?? character)
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    if (!normalized) return null;

    const directThreats = [
        /\b(vou|vamos|iremos|quero|queremos|devemos|temos de|e preciso)\s+(matar|assassinar|agredir|atacar|queimar|espancar|eliminar)\b/,
        /\b(morte a|morte aos|morte as|morte para|matem|assassinem|ataquem|expulsem|eliminem|exterminem)\b/,
        /\b(vou|vamos|iremos)\s+(te|vos|lhe|lhes)\s+(matar|agredir|atacar|espancar)\b/,
        /\b(mereces|merecem|merece)\s+(morrer|ser morto|ser morta|serem mortos|serem mortas)\b/
    ];
    const protectedGroups = /\b(negros?|pretos?|brancos?|albinos?|estrangeiros?|imigrantes?|refugiados?|muculmanos?|cristaos?|judeus?|hindus?|homossexuais?|gays?|lesbicas?|transgeneros?|pessoas trans|deficientes?|pessoas com deficiencia|mulheres|homens|angolanos?|congoleses?|portugueses?)\b/;
    const callsToAction = /\b(vamos|devemos|temos de|e preciso|mandem|matem|ataquem|expulsem|eliminem|exterminem|morte a|morte aos|morte as|morte para)\b/;
    const dehumanization = /\b(odeio|odiamos|odeiam|inferiores|subhumanos?|animais?|pragas?|nao sao humanos?|nao merecem viver|should die|hate all)\b/;

    if (directThreats.some((pattern) => pattern.test(normalized))) {
        return 'hate_or_violent_incitation';
    }

    const hasProtectedGroup = protectedGroups.test(normalized);
    if (hasProtectedGroup && (callsToAction.test(normalized) || dehumanization.test(normalized))) {
        return 'hate_or_violent_incitation';
    }

    return null;
}
