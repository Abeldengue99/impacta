export interface AnnouncementReportDay {
    day: string;
    impressions: number;
    uniqueReach: number;
    clicks: number;
    uniqueClickers: number;
}

export interface AnnouncementReport {
    title: string;
    advertiserName: string;
    advertiserEmail: string;
    status: string;
    placement: string;
    targetUrl: string;
    from: string;
    to: string;
    impressions: number;
    uniqueReach: number;
    clicks: number;
    uniqueClickers: number;
    ctr: number;
    days: AnnouncementReportDay[];
}

const escapeXml = (value: unknown): string => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');

const escapeHtml = (value: unknown): string => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

function excelCell(value: string | number): string {
    const type = typeof value === 'number' ? 'Number' : 'String';
    return `<Cell><Data ss:Type="${type}">${escapeXml(value)}</Data></Cell>`;
}

function excelRow(...values: Array<string | number>): string {
    return `<Row>${values.map(excelCell).join('')}</Row>`;
}

export function buildExcelReport(report: AnnouncementReport): string {
    const summary = [
        excelRow('Relatório de métricas IMPACTA'),
        excelRow('Campanha', report.title),
        excelRow('Cliente', report.advertiserName || 'Não indicado'),
        excelRow('E-mail do cliente', report.advertiserEmail || 'Não indicado'),
        excelRow('Tipo', report.placement),
        excelRow('Estado', report.status),
        excelRow('Período', `${report.from} a ${report.to}`),
        excelRow('Impressões qualificadas', report.impressions),
        excelRow('Alcance estimado (navegadores únicos)', report.uniqueReach),
        excelRow('Cliques', report.clicks),
        excelRow('Pessoas/navegadores que clicaram', report.uniqueClickers),
        excelRow('CTR', `${report.ctr.toFixed(2)}%`),
        excelRow('Ligação de destino', report.targetUrl || 'Sem ligação'),
        excelRow('Como contamos', 'Impressão: pelo menos 50% do destaque visível durante 1 segundo. No máximo uma impressão por navegador anónimo, campanha e dia.'),
        excelRow('Limite do indicador', 'O alcance representa navegadores identificados por código aleatório e não corresponde ao número exacto de pessoas. Cliques automatizados podem influenciar os resultados.'),
    ].join('');
    const daily = [
        excelRow('Data', 'Impressões', 'Alcance diário estimado', 'Cliques', 'CTR diário', 'Clicadores únicos'),
        ...report.days.map((day) => excelRow(
            day.day,
            day.impressions,
            day.uniqueReach,
            day.clicks,
            `${day.impressions ? (day.clicks / day.impressions * 100).toFixed(2) : '0.00'}%`,
            day.uniqueClickers
        ))
    ].join('');

    return `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<DocumentProperties xmlns="urn:schemas-microsoft-com:office:office"><Title>Relatório de métricas IMPACTA</Title><Author>IMPACTA</Author></DocumentProperties>
<Worksheet ss:Name="Resumo"><Table>${summary}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane></WorksheetOptions></Worksheet>
<Worksheet ss:Name="Por dia"><Table>${daily}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane></WorksheetOptions></Worksheet>
</Workbook>`;
}

export function buildWordReport(report: AnnouncementReport): string {
    const metrics = [
        ['Impressões qualificadas', report.impressions],
        ['Alcance estimado (navegadores únicos)', report.uniqueReach],
        ['Cliques', report.clicks],
        ['Navegadores que clicaram', report.uniqueClickers],
        ['Taxa de cliques (CTR)', `${report.ctr.toFixed(2)}%`]
    ].map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join('');
    const rows = report.days.map((day) => `<tr><td>${escapeHtml(day.day)}</td><td>${day.impressions}</td><td>${day.uniqueReach}</td><td>${day.clicks}</td><td>${day.impressions ? (day.clicks / day.impressions * 100).toFixed(2) : '0.00'}%</td><td>${day.uniqueClickers}</td></tr>`).join('');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="ProgId" content="Word.Document"><title>Relatório de métricas IMPACTA</title><style>body{font-family:Arial,sans-serif;color:#193a2c;margin:32px}h1{color:#167353}p{line-height:1.5}.meta{color:#65776a}table{border-collapse:collapse;width:100%;margin:18px 0}th,td{border:1px solid #cddbd0;padding:8px;text-align:left;font-size:10pt}th{background:#edf5ef}h2{font-size:15pt;margin-top:24px}.note{font-size:9pt;color:#65776a}</style></head><body>
<h1>Relatório de métricas</h1><p class="meta">IMPACTA · publicidade e comunicação</p>
<table><tr><th>Campanha</th><td>${escapeHtml(report.title)}</td></tr><tr><th>Cliente</th><td>${escapeHtml(report.advertiserName || 'Não indicado')}</td></tr><tr><th>E-mail</th><td>${escapeHtml(report.advertiserEmail || 'Não indicado')}</td></tr><tr><th>Tipo / estado</th><td>${escapeHtml(report.placement)} · ${escapeHtml(report.status)}</td></tr><tr><th>Período</th><td>${escapeHtml(report.from)} a ${escapeHtml(report.to)}</td></tr><tr><th>Ligação</th><td>${escapeHtml(report.targetUrl || 'Sem ligação')}</td></tr></table>
<h2>Resumo</h2><table>${metrics}</table><h2>Resultados por dia</h2><table><thead><tr><th>Data</th><th>Impressões</th><th>Alcance diário</th><th>Cliques</th><th>CTR</th><th>Clicadores</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Metodologia</h2><p class="note">Uma impressão é registada quando pelo menos metade do destaque fica visível no ecrã durante 1 segundo. Cada navegador anónimo conta no máximo uma impressão por campanha por dia. O alcance é uma estimativa de navegadores únicos no período e não equivale ao número exacto de pessoas. Cliques automatizados podem influenciar os resultados. Os identificadores são aleatórios, anonimizados e não incluem endereço IP.</p>
</body></html>`;
}
