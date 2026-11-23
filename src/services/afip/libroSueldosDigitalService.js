import { BaseRepository } from '../../core/BaseRepository.js';
import { MODELS } from '../../db/models.js';
import { getLiquidacionById, listConceptos } from '../rrhh/nominaService.js';

const empresaRepo = new BaseRepository({ model: MODELS.empresa_config });

function padLeftZero(val, len) {
  return String(val ?? '').replace(/\D+/g, '').slice(0, len).padStart(len, '0');
}

function padRightSpace(val, len) {
  return String(val ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, len)
    .padEnd(len, ' ');
}

function fmtAmountFixed(amount, len = 15) {
  const cents = Math.round(Math.max(0, Number(amount || 0)) * 100);
  return String(cents).slice(0, len).padStart(len, '0');
}

function mapTipoLiqLsd(tipo) {
  const t = String(tipo || '').toLowerCase();
  if (t.includes('quincena')) return 'Q';
  if (t.includes('sac') || t.includes('aguinaldo')) return 'S';
  if (t.includes('final')) return 'F';
  return 'M';
}

function mapFormaPagoLsd(forma) {
  const f = String(forma || '').toLowerCase();
  if (f.includes('efectivo')) return '2';
  if (f.includes('cheque')) return '3';
  return '1';
}

/**
 * Genera el archivo TXT posicional de Parametrización de Conceptos para Libro de Sueldos Digital (ARCA).
 */
export function exportarConceptosLsdTxt() {
  const conceptos = listConceptos({ soloActivos: true });
  const lines = conceptos.map(c => [
    padLeftZero(c.codigo_afip_lsd || '110000', 6),
    padRightSpace(c.codigo_interno, 10),
    padRightSpace(c.descripcion, 150),
    c.aporta_sipa ? '1' : '0',
    c.aporta_inssjp ? '1' : '0',
    c.aporta_os ? '1' : '0',
    c.aporta_fsr ? '1' : '0',
    c.aporta_lrt ? '1' : '0',
    c.base_sac ? '1' : '0',
    '1',
  ].join(''));
  return lines.join('\r\n');
}

/**
 * Genera el archivo TXT posicional de Liquidación (Registros 01, 02, 03 y 04)
 * según especificación Libro de Sueldos Digital ARCA (RG 3669 / RG 5249).
 */
export function exportarLiquidacionLsdTxt(liquidacionId) {
  const det = getLiquidacionById(liquidacionId);
  if (!det) throw new Error('Liquidación no encontrada');
  const { liquidacion: liq, recibos } = det;
  const emp = empresaRepo.query().where('id', 1).get() || {};
  const cuitEmpleador = padLeftZero(emp.cuit || '00000000000', 11);
  const periodoAAAAMM = String(liq.periodo || '').replace(/\D+/g, '').slice(0, 6).padEnd(6, '0');
  const fechaPagoAAAAMMDD = String(liq.fecha_pago || liq.fecha_liquidacion || '').replace(/\D+/g, '').slice(0, 8).padEnd(8, '0');

  const lines = [];

  // Registro 01: Cabecera de Liquidación
  lines.push([
    '01',
    cuitEmpleador,
    'SJ',
    periodoAAAAMM,
    mapTipoLiqLsd(liq.tipo_liquidacion),
    padLeftZero(liq.id, 5),
    '30',
    padLeftZero(recibos.length, 6),
  ].join(''));

  for (const r of recibos) {
    const cuilDigits = padLeftZero(r.cuil || '00000000000', 11);

    // Registro 02: Datos Referenciales del Trabajador
    lines.push([
      '02',
      cuilDigits,
      padRightSpace(r.legajo || String(r.empleado_id), 10),
      padRightSpace(r.sector || 'Producción', 50),
      padLeftZero(r.cbu || '', 22),
      '030',
      fechaPagoAAAAMMDD,
      '        ',
      mapFormaPagoLsd(r.forma_pago),
      padLeftZero(r.situacion_revista_afip || '01', 2),
      padLeftZero(r.condicion_afip || '01', 2),
      padLeftZero(r.actividad_afip || '049', 3),
      padLeftZero(r.obra_social_codigo || '104309', 6),
      padLeftZero(r.obra_social_adherentes || 0, 2),
      padLeftZero(r.modalidad_contrato_afip || '008', 3),
      padLeftZero(r.dias_trabajados ?? 30, 2),
    ].join(''));

    // Registro 03: Detalle de Conceptos Liquidados
    for (const l of (r.lineas || [])) {
      const esHaber = Number(l.importe_haber || 0) > 0;
      const esDesc = Number(l.importe_descuento || 0) > 0;
      const esContrib = Number(l.importe_contribucion || 0) > 0;
      const importe = esHaber ? l.importe_haber : (esDesc ? l.importe_descuento : l.importe_contribucion);
      if (!(Number(importe) > 0)) continue;

      lines.push([
        '03',
        cuilDigits,
        padRightSpace(l.codigo_interno || l.codigo_afip_lsd || '110000', 10),
        fmtAmountFixed(l.cantidad ?? 1, 5),
        ' ',
        fmtAmountFixed(importe, 15),
        esHaber ? 'C' : (esContrib ? 'C' : 'D'),
        '      ',
      ].join(''));
    }

    // Registro 04: Bases Imponibles SICOSS / F.931 (Base 1 a Base 9)
    lines.push([
      '04',
      cuilDigits,
      '0',
      '00',
      r.convenio_cct && !String(r.convenio_cct).toLowerCase().includes('fuera') ? '1' : '0',
      '1',
      '0',
      '1',
      '0',
      padLeftZero(r.situacion_revista_afip || '01', 2),
      padLeftZero(r.condicion_afip || '01', 2),
      padLeftZero(r.actividad_afip || '049', 3),
      padLeftZero(r.modalidad_contrato_afip || '008', 3),
      '00',
      '01',
      fmtAmountFixed(r.base_imponible_1, 15),
      fmtAmountFixed(r.base_imponible_2, 15),
      fmtAmountFixed(r.base_imponible_3, 15),
      fmtAmountFixed(r.base_imponible_4, 15),
      fmtAmountFixed(r.base_imponible_5, 15),
      fmtAmountFixed(r.base_imponible_6, 15),
      fmtAmountFixed(r.base_imponible_7, 15),
      fmtAmountFixed(r.base_imponible_8, 15),
      fmtAmountFixed(r.base_imponible_9, 15),
    ].join(''));
  }

  return lines.join('\r\n');
}

/**
 * Papel de Trabajo F.931 consolidado para control previo a la declaración jurada en ARCA.
 */
export function getPapelTrabajoF931(liquidacionId) {
  const det = getLiquidacionById(liquidacionId);
  if (!det) throw new Error('Liquidación no encontrada');
  const { liquidacion: liq, recibos } = det;

  const bases = {
    base_1: 0, base_2: 0, base_3: 0, base_4: 0, base_5: 0,
    base_6: 0, base_7: 0, base_8: 0, base_9: 0,
  };
  const aportes = { jubilacion_sipa: 0, inssjp_pami: 0, obra_social: 0, sindicato: 0, otros: 0, total_aportes: 0 };
  const contribuciones = { sipa_inssjp_fne: 0, obra_social: 0, art_lrt_scvo: 0, total_contribuciones: 0 };

  for (const r of recibos) {
    for (let i = 1; i <= 9; i++) {
      bases[`base_${i}`] = Number((bases[`base_${i}`] + Number(r[`base_imponible_${i}`] || 0)).toFixed(2));
    }
    for (const l of (r.lineas || [])) {
      const cod = l.codigo_interno || '';
      const lsd = l.codigo_afip_lsd || '';
      const desc = Number(l.importe_descuento || 0);
      const cont = Number(l.importe_contribucion || 0);
      if (desc > 0) {
        if (cod === 'JUBILACION' || lsd === '810001') aportes.jubilacion_sipa += desc;
        else if (cod === 'PAMI' || lsd === '810002') aportes.inssjp_pami += desc;
        else if (cod === 'OBRA_SOCIAL' || lsd === '810003') aportes.obra_social += desc;
        else if (cod === 'SINDICATO' || lsd === '810004') aportes.sindicato += desc;
        else aportes.otros += desc;
        aportes.total_aportes += desc;
      }
      if (cont > 0) {
        if (cod === 'CONTRIB_SIPA' || lsd === '820001') contribuciones.sipa_inssjp_fne += cont;
        else if (cod === 'CONTRIB_OS' || lsd === '820002') contribuciones.obra_social += cont;
        else contribuciones.art_lrt_scvo += cont;
        contribuciones.total_contribuciones += cont;
      }
    }
  }

  for (const k of Object.keys(aportes)) aportes[k] = Number(aportes[k].toFixed(2));
  for (const k of Object.keys(contribuciones)) contribuciones[k] = Number(contribuciones[k].toFixed(2));

  const aportesF931 = Number((aportes.jubilacion_sipa + aportes.inssjp_pami + aportes.obra_social + aportes.otros).toFixed(2));
  const totalF931Arca = Number((aportesF931 + contribuciones.total_contribuciones).toFixed(2));

  return {
    liquidacion_id: liq.id,
    numero: liq.numero,
    periodo: liq.periodo,
    tipo_liquidacion: liq.tipo_liquidacion,
    cantidad_empleados: recibos.length,
    total_remunerativo: Number(liq.total_remunerativo || 0),
    total_no_remunerativo: Number(liq.total_no_remunerativo || 0),
    bases_totales: bases,
    aportes_trabajador: aportes,
    contribuciones_empleador: contribuciones,
    total_f931_arca: totalF931Arca,
    total_sindicato: aportes.sindicato,
  };
}
