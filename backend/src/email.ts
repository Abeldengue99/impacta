import nodemailer from 'nodemailer';

interface VerificationEmailInput {
    email: string;
    code: string;
}

interface PasswordResetEmailInput {
    email: string;
    resetUrl: string;
}

export function isEmailDeliveryConfigured(): boolean {
    const port = Number(process.env.SMTP_PORT ?? '587');
    return Number.isInteger(port) && port > 0 && port <= 65535
        && Boolean(process.env.SMTP_USER && process.env.SMTP_PASSWORD && process.env.SMTP_FROM_EMAIL);
}

export async function sendVerificationEmail({ email, code }: VerificationEmailInput): Promise<void> {
    const host = process.env.SMTP_HOST ?? 'smtp-relay.brevo.com';
    const port = Number(process.env.SMTP_PORT ?? '587');
    const user = process.env.SMTP_USER;
    const password = process.env.SMTP_PASSWORD;
    const fromEmail = process.env.SMTP_FROM_EMAIL;
    const fromName = process.env.SMTP_FROM_NAME ?? 'IMPACTA';

    if (!isEmailDeliveryConfigured() || !user || !password || !fromEmail) {
        throw new Error('smtp_configuration_missing');
    }

    const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        requireTLS: port !== 465,
        auth: { user, pass: password },
        tls: { minVersion: 'TLSv1.2' },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000
    });

    try {
        await transporter.sendMail({
            from: { name: fromName, address: fromEmail },
            to: email,
            subject: 'Código de verificação IMPACTA',
            text: `O teu código de verificação IMPACTA é ${code}. Expira em 10 minutos. Se não pediste este código, ignora esta mensagem.`,
            html: `<!doctype html><html lang="pt"><body style="margin:0;background:#f4f6f1;font-family:Arial,sans-serif;color:#10231d"><main style="max-width:520px;margin:36px auto;padding:32px;background:#fff;border-radius:12px"><p style="font-size:13px;font-weight:bold;letter-spacing:.12em;color:#167353">IMPACTA</p><h1 style="font-size:24px">Confirma o teu endereço de email</h1><p>Introduz este código para ativar a tua conta:</p><p style="margin:24px 0;padding:18px;background:#f1f5ef;border-radius:8px;text-align:center;font-size:32px;font-weight:bold;letter-spacing:.28em">${code}</p><p style="color:#64756b;font-size:14px">O código expira em 10 minutos. Se não pediste este código, ignora esta mensagem.</p></main></body></html>`
        });
    } finally {
        transporter.close();
    }
}

export async function sendPasswordResetEmail({ email, resetUrl }: PasswordResetEmailInput): Promise<void> {
    const host = process.env.SMTP_HOST ?? 'smtp-relay.brevo.com';
    const port = Number(process.env.SMTP_PORT ?? '587');
    const user = process.env.SMTP_USER;
    const password = process.env.SMTP_PASSWORD;
    const fromEmail = process.env.SMTP_FROM_EMAIL;
    const fromName = process.env.SMTP_FROM_NAME ?? 'IMPACTA';

    if (!isEmailDeliveryConfigured() || !user || !password || !fromEmail) {
        throw new Error('smtp_configuration_missing');
    }

    const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        requireTLS: port !== 465,
        auth: { user, pass: password },
        tls: { minVersion: 'TLSv1.2' },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000
    });
    const safeUrl = resetUrl.replaceAll('&', '&amp;').replaceAll('"', '&quot;');

    try {
        await transporter.sendMail({
            from: { name: fromName, address: fromEmail },
            to: email,
            subject: 'Recuperar o acesso à conta IMPACTA',
            text: `Recebemos um pedido para alterar a palavra-passe da tua conta IMPACTA. Abre este link para escolher uma nova palavra-passe: ${resetUrl} O link expira em 30 minutos e só pode ser usado uma vez. Se não fizeste este pedido, ignora esta mensagem.`,
            html: `<!doctype html><html lang="pt"><body style="margin:0;background:#f4f6f1;font-family:Arial,sans-serif;color:#10231d"><main style="max-width:520px;margin:36px auto;padding:32px;background:#fff;border-radius:12px"><p style="font-size:13px;font-weight:bold;letter-spacing:.12em;color:#167353">IMPACTA</p><h1 style="font-size:24px">Recupera o acesso à tua conta</h1><p>Recebemos um pedido para alterar a palavra-passe da tua conta. Usa o botão para escolher uma nova:</p><p style="margin:24px 0"><a href="${safeUrl}" style="display:inline-block;padding:14px 22px;background:#167353;border-radius:6px;color:#fff;text-decoration:none;font-weight:bold">Criar nova palavra-passe</a></p><p style="color:#64756b;font-size:14px">Este link expira em 30 minutos e só pode ser usado uma vez. Se não fizeste este pedido, ignora esta mensagem.</p></main></body></html>`
        });
    } finally {
        transporter.close();
    }
}
